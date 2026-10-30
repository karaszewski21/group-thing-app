"""`app.system.public_preview` / the public-preview routes in
`app.system.router`: Open Graph/Twitter meta tags injected into
`index.html` for the same URL shapes the SPA owns client-side
(`/:slug`, `/:slug/group/:groupId`, `/:slug/group/:groupId/term/:termId`,
`/:slug/event/:eventId`).

Isolation via the `conftest.py` TestContainers + savepoint-rollback
fixtures; naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`)."""

from __future__ import annotations

import io
import uuid
from datetime import date, datetime, timedelta

from httpx import AsyncClient
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from tests.fake_storage import FakeStorage


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_circle(client: AsyncClient, token: str, name: str) -> int:
    circle = await client.post(
        "/api/groups/mine", json={"name": name}, headers=_auth_headers(token)
    )
    assert circle.status_code == 201
    return circle.json()["id"]


async def _create_term(
    client: AsyncClient, token: str, group_id: int, occurs_on: date, description: str | None = None
) -> int:
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": occurs_on.isoformat(),
            "description": description,
        },
        headers=_auth_headers(token),
    )
    assert term.status_code == 201
    return term.json()["id"]


async def test_publicTermPreview_realGroupAndTerm_injectsCircleNameAndDate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "preview.term1@example.com")
    group_id = await _create_circle(client, token, "Nutki dla starszaków")
    occurs_on = date.today() + timedelta(days=7)
    term_id = await _create_term(client, token, group_id, occurs_on, "Sala 12, godz. 17:00")

    response = await client.get(f"/any-slug/group/{group_id}/term/{term_id}")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    body = response.text
    assert '<meta property="og:title" content="Nutki dla starszaków">' in body
    assert occurs_on.strftime("%d.%m.%Y") in body
    assert "Sala 12, godz. 17:00" in body
    assert "<title>Nutki dla starszaków</title>" in body


async def test_publicCirclePreview_noTermIdInPath_usesNextTerm(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "preview.circle1@example.com")
    group_id = await _create_circle(client, token, "Krąg Skowronków")
    await _create_term(client, token, group_id, date.today() + timedelta(days=3))

    response = await client.get(f"/any-slug/group/{group_id}")

    assert response.status_code == 200
    assert 'content="Krąg Skowronków"' in response.text


async def test_publicTermPreview_unknownGroupId_fallsBackToPlainIndexNot404(
    client: AsyncClient,
) -> None:
    response = await client.get("/any-slug/group/999999999/term/1")

    assert response.status_code == 200
    assert "og:title" not in response.text


async def test_publicOrganizationPreview_realSlug_injectsOrganizationName(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "preview.org1@example.com")
    created = await client.post(
        "/api/organizations/mine", json={"name": "Muzyczne Skrzaty"}, headers=_auth_headers(token)
    )
    assert created.status_code == 201
    slug = created.json()["slug"]

    response = await client.get(f"/{slug}")

    assert response.status_code == 200
    assert '<meta property="og:title" content="Muzyczne Skrzaty">' in response.text
    assert "<title>Muzyczne Skrzaty</title>" in response.text


async def test_publicOrganizationPreview_reservedSlug_fallsBackToPlainIndex(
    client: AsyncClient,
) -> None:
    """`/login` etc. must keep serving the SPA shell unmodified — never a
    404, and never a "public organization" preview (`RESERVED_SLUGS`)."""
    response = await client.get("/login")

    assert response.status_code == 200
    assert "og:title" not in response.text


async def test_publicOrganizationPreview_dottedUnknownPath_returnsReal404(
    client: AsyncClient,
) -> None:
    response = await client.get("/favicon.ico")

    assert response.status_code == 404
    assert response.json()["error"] == "Not Found"


async def test_publicOrganizationPreview_nameWithHtml_isEscapedNotInjected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token = await _register_organizer(client, "preview.org2@example.com")
    created = await client.post(
        "/api/organizations/mine",
        json={"name": '<script>alert("x")</script>'},
        headers=_auth_headers(token),
    )
    assert created.status_code == 201
    slug = created.json()["slug"]

    response = await client.get(f"/{slug}")

    assert response.status_code == 200
    assert "<script>alert" not in response.text
    assert "&lt;script&gt;" in response.text


async def _create_event_with_place_and_banner(
    client: AsyncClient, token: str
) -> tuple[str, datetime]:
    place = await client.post(
        "/api/locations",
        json={"name": "Park Skaryszewski", "formatted_address": "Warszawa", "source": "MANUAL"},
        headers=_auth_headers(token),
    )
    assert place.status_code == 201, place.text
    starts_at = (clock.local_now() + timedelta(days=5)).replace(
        hour=14, minute=0, second=0, microsecond=0
    )
    event = await client.post(
        "/api/events",
        json={
            "name": "Piknik wymiany",
            "description": "Przynieś rzeczy do wymiany.",
            "starts_at": starts_at.isoformat(),
            "location_id": place.json()["id"],
        },
        headers=_auth_headers(token),
    )
    assert event.status_code == 201, event.text
    buffer = io.BytesIO()
    Image.new("RGB", (20, 20), (40, 30, 90)).save(buffer, "PNG")
    banner = await client.post(
        f"/api/events/{event.json()['id']}/banner",
        files={"file": ("b.png", buffer.getvalue(), "image/png")},
        headers=_auth_headers(token),
    )
    assert banner.status_code == 200, banner.text
    return str(event.json()["id"]), starts_at


async def test_eventPreview_rendersTitleAndOgImage(
    client: AsyncClient, fake_storage: FakeStorage
) -> None:
    token = await _register_organizer(client, "preview.event1@example.com")
    event_id, starts_at = await _create_event_with_place_and_banner(client, token)
    banner_url = (await client.get(f"/api/events/{event_id}")).json()["banner_url"]

    response = await client.get(f"/any-slug/event/{event_id}")

    assert response.status_code == 200
    body = response.text
    assert "<title>Piknik wymiany</title>" in body
    assert '<meta property="og:title" content="Piknik wymiany">' in body
    description = (
        f"{clock.format_term_when(starts_at)} · Park Skaryszewski Przynieś rzeczy do wymiany."
    )
    assert f'<meta property="og:description" content="{description}">' in body
    assert f'<meta property="og:image" content="{banner_url}">' in body


async def test_eventPreview_invalidUuid_returnsPlainIndex(client: AsyncClient) -> None:
    invalid = await client.get("/any-slug/event/not-a-uuid")
    unknown = await client.get(f"/any-slug/event/{uuid.uuid4()}")

    for response in (invalid, unknown):
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/html")
        assert "og:title" not in response.text


async def test_eventPreview_reservedFirstSegment_notServedByPreview(
    client: AsyncClient,
) -> None:
    api = await client.get(f"/api/event/{uuid.uuid4()}")
    reserved = await client.get(f"/login/event/{uuid.uuid4()}")

    assert api.status_code == 404
    assert api.json()["error"] == "Not Found"
    assert reserved.status_code == 200
    assert "og:title" not in reserved.text


async def test_eventPreview_nameWithBackslashAndGroupReference_rendersLiterally(
    client: AsyncClient,
) -> None:
    token = await _register_organizer(client, "preview.event2@example.com")
    starts_at = (clock.local_now() + timedelta(days=5)).replace(microsecond=0)
    created = await client.post(
        "/api/events",
        json={"name": r"Swap \o/ \1", "starts_at": starts_at.isoformat()},
        headers=_auth_headers(token),
    )
    assert created.status_code == 201, created.text

    response = await client.get(f"/any-slug/event/{created.json()['id']}")

    assert response.status_code == 200
    assert r"<title>Swap \o/ \1</title>" in response.text
    assert r'<meta property="og:title" content="Swap \o/ \1">' in response.text
