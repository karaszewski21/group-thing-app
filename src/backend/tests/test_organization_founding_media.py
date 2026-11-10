"""`POST /api/organizations/mine` copies the founder's visible profile media
(the public avatar and cover, the non-REJECTED gallery) to the new
Organization's own party: fresh rows and storage keys, the same files and
moderation status. A repeat POST returns the same Organization and copies
nothing."""

from __future__ import annotations

import io
import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.media.models import Media
from app.moderation.status import ModerationStatus
from tests.fake_storage import FakeStorage
from tests.test_term_item_listings import _auth, _register


def _png(seed: int) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (seed * 40 % 256, 120, 30)).save(buffer, "PNG")
    return buffer.getvalue()


async def _upload(client: AsyncClient, token: str, kind: str, seed: int) -> dict[str, Any]:
    response = await client.post(
        "/api/people/me/media",
        params={"kind": kind},
        files={"file": ("a.png", _png(seed), "image/png")},
        headers=_auth(token),
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def _rows(db_session: AsyncSession, owner_party_id: uuid.UUID) -> list[Media]:
    result = await db_session.scalars(
        select(Media)
        .where(Media.owner_party_id == owner_party_id)
        .order_by(Media.kind, Media.sort_order)
        .execution_options(populate_existing=True)
    )
    return list(result)


async def _found(client: AsyncClient, token: str) -> dict[str, Any]:
    response = await client.post(
        "/api/organizations/mine", json={"name": "Fundacja Kopia"}, headers=_auth(token)
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


async def test_createOrganization_copiesVisibleProfileMedia_freshKeysSameFilesAndStatus(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, person_party_id = await _register(client, "ORGANIZER", "found.copy@example.com")
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    await _upload(client, token, "AVATAR", 1)
    await _upload(client, token, "COVER", 2)
    await _upload(client, token, "GALLERY", 3)
    monkeypatch.setattr(settings, "moderation_image_enabled", True)
    pending_avatar = await _upload(client, token, "AVATAR", 4)
    await _upload(client, token, "GALLERY", 5)
    rejected = await _upload(client, token, "GALLERY", 6)
    await db_session.execute(
        update(Media)
        .where(Media.id == uuid.UUID(rejected["id"]))
        .values(status=ModerationStatus.REJECTED)
    )
    await db_session.commit()
    me = (await client.get("/api/people/me", headers=_auth(token))).json()
    sources = await _rows(db_session, person_party_id)

    organization = await _found(client, token)

    org_party_id = uuid.UUID(organization["party_id"])
    assert org_party_id != person_party_id
    copies = await _rows(db_session, org_party_id)
    copied_from = {
        source.content_sha256: source
        for source in sources
        if str(source.id) not in (pending_avatar["id"], rejected["id"])
    }
    assert [(row.kind.value, row.status.value, row.sort_order) for row in copies] == [
        ("AVATAR", "APPROVED", 0),
        ("COVER", "APPROVED", 0),
        ("GALLERY", "APPROVED", 0),
        ("GALLERY", "PENDING", 1),
    ]
    assert {row.content_sha256 for row in copies} == set(copied_from)
    for row in copies:
        source = copied_from[row.content_sha256]
        assert row.storage_key == f"media/{org_party_id}/{row.id}"
        assert row.id != source.id
        assert str(row.uploaded_by_user_id) == me["account_user_id"]
        for copy_key, source_key in (
            (row.large_key, source.large_key),
            (row.thumb_key, source.thumb_key),
        ):
            assert fake_storage.objects[copy_key].data == fake_storage.objects[source_key].data
            assert fake_storage.objects[copy_key].public is (
                row.status == ModerationStatus.APPROVED
            )
    assert len(await _rows(db_session, person_party_id)) == len(sources)
    public = await client.get(f"/api/public/organizations/{organization['slug']}")
    assert public.json()["avatar"]["url"] == f"https://cdn.test/{copies[0].large_key}"
    assert public.json()["cover"]["url"] == f"https://cdn.test/{copies[1].large_key}"
    assert [photo["url"] for photo in public.json()["gallery"]] == [
        f"https://cdn.test/{copies[2].large_key}"
    ]


async def test_createOrganization_repeatPost_copiesNothing(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_storage: FakeStorage,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "moderation_image_enabled", False)
    token, _ = await _register(client, "ORGANIZER", "found.repeat@example.com")
    await _upload(client, token, "AVATAR", 1)
    first = await _found(client, token)
    org_party_id = uuid.UUID(first["party_id"])
    rows_before = {row.id for row in await _rows(db_session, org_party_id)}
    stored_before = set(fake_storage.objects)

    second = await _found(client, token)

    assert second["id"] == first["id"]
    assert len(rows_before) == 1
    assert {row.id for row in await _rows(db_session, org_party_id)} == rows_before
    assert set(fake_storage.objects) == stored_before


async def test_createOrganization_noProfileMedia_startsEmpty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, _ = await _register(client, "ORGANIZER", "found.empty@example.com")

    organization = await _found(client, token)

    assert await _rows(db_session, uuid.UUID(organization["party_id"])) == []
    mine = await client.get("/api/organizations/mine", headers=_auth(token))
    assert mine.json()["media"] == []
