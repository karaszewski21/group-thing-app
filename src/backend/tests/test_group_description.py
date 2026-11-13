"""`groups.description`: accepted on every create path and on PATCH, stripped
(blank → `null`), at most 500 code points after the strip, checked for
contact info and by the synchronous text guard before any write, and exposed
on `GroupResponse` and at the top level of the organization group terms
page."""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import Group
from app.moderation.rules import CONTACT_INFO_MESSAGE
from tests.test_organizer_page import _organization_slug
from tests.test_text_moderation_org_group_term import (
    OFFENSIVE,
    FakeTextClassifier,
    classifier,  # noqa: F401
)

DESCRIPTION_MESSAGE = "Opis grupy narusza zasady społeczności. Zmień go i spróbuj ponownie."
CREATE_PATHS = ["/api/groups", "/api/groups/mine", "/api/groups/mine/new"]
# 500 code points, one of them an astral emoji (two UTF-16 units, one code point).
MAX_DESCRIPTION = "🎵" + "ż" * 499


async def _headers(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _own_circle(
    client: AsyncClient, headers: dict[str, str], description: str | None = None
) -> str:
    response = await client.post(
        "/api/groups/mine/new",
        json={"name": "Krąg Opisowy", "description": description},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


async def _group_count(db: AsyncSession) -> int:
    return (await db.execute(select(func.count()).select_from(Group))).scalar_one()


@pytest.mark.parametrize("path", CREATE_PATHS)
async def test_createGroup_500CodePointsAfterStrip_savedAndReturned(
    client: AsyncClient, path: str
) -> None:
    headers = await _headers(client, f"gd.create{path.count('/')}{len(path)}@example.com")

    created = await client.post(
        path, json={"name": "Krąg", "description": f"  {MAX_DESCRIPTION} \n"}, headers=headers
    )

    assert created.status_code == 201, created.text
    assert created.json()["description"] == MAX_DESCRIPTION
    read = await client.get(f"/api/groups/{created.json()['id']}", headers=headers)
    assert read.json()["description"] == MAX_DESCRIPTION


@pytest.mark.parametrize("path", CREATE_PATHS)
async def test_createGroup_501CodePointsOrBlank_400OrNull(
    client: AsyncClient, db_session: AsyncSession, path: str
) -> None:
    headers = await _headers(client, f"gd.long{path.count('/')}{len(path)}@example.com")
    before = await _group_count(db_session)

    too_long = await client.post(
        path, json={"name": "Krąg", "description": MAX_DESCRIPTION + "x"}, headers=headers
    )
    assert too_long.status_code == 400
    assert "description" in too_long.json()["fieldErrors"]
    assert await _group_count(db_session) == before

    blank = await client.post(path, json={"name": "Krąg", "description": "  \n "}, headers=headers)
    assert blank.status_code == 201
    assert blank.json()["description"] is None


async def test_updateGroup_description_omittedKeepsNullAndBlankClear_501Rejected(
    client: AsyncClient,
) -> None:
    headers = await _headers(client, "gd.patch@example.com")
    group_id = await _own_circle(client, headers, "Śpiewamy razem.")
    url = f"/api/groups/{group_id}"

    kept = await client.patch(url, json={"name": "Krąg Nowy"}, headers=headers)
    assert kept.status_code == 200
    assert kept.json()["description"] == "Śpiewamy razem."

    too_long = await client.patch(
        url, json={"name": "Krąg Nowy", "description": MAX_DESCRIPTION + "x"}, headers=headers
    )
    assert too_long.status_code == 400
    assert (await client.get(url, headers=headers)).json()["description"] == "Śpiewamy razem."

    changed = await client.patch(
        url, json={"name": "Krąg Nowy", "description": f" {MAX_DESCRIPTION} "}, headers=headers
    )
    assert changed.json()["description"] == MAX_DESCRIPTION

    cleared = await client.patch(
        url, json={"name": "Krąg Nowy", "description": None}, headers=headers
    )
    assert cleared.json()["description"] is None

    await client.patch(url, json={"name": "Krąg Nowy", "description": "Znowu"}, headers=headers)
    blank = await client.patch(
        url, json={"name": "Krąg Nowy", "description": "   "}, headers=headers
    )
    assert blank.json()["description"] is None


@pytest.mark.parametrize("path", CREATE_PATHS)
async def test_createGroup_offendingDescription_returns400AndPersistsNothing(
    client: AsyncClient,
    db_session: AsyncSession,
    classifier: FakeTextClassifier,  # noqa: F811
    path: str,
) -> None:
    headers = await _headers(client, f"gd.mod{path.count('/')}{len(path)}@example.com")
    before = await _group_count(db_session)

    response = await client.post(
        path, json={"name": "Krąg", "description": f"Opis {OFFENSIVE}"}, headers=headers
    )

    assert response.status_code == 400
    assert response.json()["message"] == DESCRIPTION_MESSAGE
    assert await _group_count(db_session) == before


async def test_updateGroup_offendingDescription_returns400_unchangedNotScored(
    client: AsyncClient,
    classifier: FakeTextClassifier,  # noqa: F811
) -> None:
    headers = await _headers(client, "gd.mod.patch@example.com")
    group_id = await _own_circle(client, headers, "Śpiewamy razem.")
    url = f"/api/groups/{group_id}"
    classifier.calls.clear()

    same = await client.patch(
        url, json={"name": "Krąg Opisowy", "description": "Śpiewamy  razem."}, headers=headers
    )
    assert same.status_code == 200
    assert classifier.calls == []

    offending = await client.patch(
        url, json={"name": "Krąg Opisowy", "description": OFFENSIVE}, headers=headers
    )
    assert offending.status_code == 400
    assert offending.json()["message"] == DESCRIPTION_MESSAGE
    assert (await client.get(url, headers=headers)).json()["description"] == "Śpiewamy  razem."


@pytest.mark.parametrize("path", CREATE_PATHS)
async def test_createOrUpdateGroup_contactInfoInDescription_returns400(
    client: AsyncClient, db_session: AsyncSession, path: str
) -> None:
    headers = await _headers(client, f"gd.contact{path.count('/')}{len(path)}@example.com")
    before = await _group_count(db_session)

    created = await client.post(
        path, json={"name": "Krąg", "description": "Pisz na jan@example.com"}, headers=headers
    )
    assert created.status_code == 400
    assert created.json()["message"] == CONTACT_INFO_MESSAGE
    assert await _group_count(db_session) == before

    group_id = await _own_circle(client, headers)
    patched = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": "Krąg Opisowy", "description": "Dzwoń 600 700 800"},
        headers=headers,
    )
    assert patched.status_code == 400
    assert patched.json()["message"] == CONTACT_INFO_MESSAGE


async def test_getOrganizationGroupTerms_description_topLevelOnly(client: AsyncClient) -> None:
    headers = await _headers(client, "gd.page@example.com")
    token = headers["Authorization"].removeprefix("Bearer ")
    slug = await _organization_slug(client, token, "Opisowe Nutki")
    group_id = uuid.UUID(await _own_circle(client, headers, "Rytmika dla maluchów."))

    response = await client.get(f"/api/public/organizations/{slug}/groups/{group_id}/terms")
    public = await client.get(f"/api/public/groups/{group_id}")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"owner", "group", "description", "terms"}
    assert body["description"] == "Rytmika dla maluchów."
    assert set(body["group"]) == {"id", "name", "layout_mode", "next_term", "upcoming_term_count"}
    assert "description" not in public.json()
