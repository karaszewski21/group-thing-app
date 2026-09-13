"""`app.system.public_preview` / the three public-preview routes in
`app.system.router`: Open Graph/Twitter meta tags injected into
`index.html` for the same URL shapes the SPA owns client-side
(`/:slug`, `/:slug/grupa/:groupId`, `/:slug/grupa/:groupId/term/:termId`).

Isolation via the `conftest.py` TestContainers + savepoint-rollback
fixtures; naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`)."""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


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

    response = await client.get(f"/any-slug/grupa/{group_id}/term/{term_id}")

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

    response = await client.get(f"/any-slug/grupa/{group_id}")

    assert response.status_code == 200
    assert 'content="Krąg Skowronków"' in response.text


async def test_publicTermPreview_unknownGroupId_fallsBackToPlainIndexNot404(
    client: AsyncClient,
) -> None:
    response = await client.get("/any-slug/grupa/999999999/term/1")

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
