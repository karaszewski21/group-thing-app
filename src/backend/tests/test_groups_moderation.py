"""`GET /api/groups/moderation` (ADMIN-only Circle moderation list) tests:
matrix-resolution, router-level permission gating, and the aggregated
organizer/member/term-count query in `app.groups.infrastructure.repository.
list_groups_for_moderation`.

Same `_authed_headers`/`_grant_admin`/`_grant_admin_and_relogin` pattern as
`test_category_module.py` — `POST /api/auth/register` only ever grants
READ+EDIT, so an ADMIN test grants the permission directly via
`user_permissions` after registering.
"""

from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.authorization_matrix import resolve_requirement

ADMIN = ("ADMIN",)


async def _authed_headers(client: AsyncClient, email: str, role: str = "GUEST") -> dict[str, str]:
    response = await client.post(
        "/api/auth/register",
        json={"role": role, "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['token']}"}


async def _grant_admin_and_relogin(
    client: AsyncClient, db_session: AsyncSession, email: str, password: str
) -> dict[str, str]:
    await db_session.execute(
        text(
            "INSERT INTO user_permissions (user_id, permission) "
            "SELECT u.id, 'ADMIN' FROM users u "
            "JOIN user_profiles p ON p.account_user_id = u.id "
            "WHERE p.email = :email"
        ),
        {"email": email},
    )
    await db_session.commit()
    response = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_resolveRequirement_getGroupsModeration_resolvesToAdmin() -> None:
    assert resolve_requirement("GET", "/api/groups/moderation") == ADMIN


async def test_listGroupsForModeration_nonAdminPrincipal_returns403(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "modnonadmin1@example.com")

    response = await client.get("/api/groups/moderation", headers=headers)

    assert response.status_code == 403


async def test_listGroupsForModeration_adminPrincipal_returnsOrganizerAndCounts(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_headers = await _authed_headers(
        client, "modorganizer1@example.com", role="ORGANIZER"
    )
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg Moderowany"}, headers=org_headers
    )
    assert circle.status_code == 201
    circle_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": circle_id, "occurs_on": date.today().isoformat()},
        headers=org_headers,
    )
    assert term.status_code == 201

    admin_headers = await _authed_headers(client, "modadmin1@example.com")
    admin_headers = await _grant_admin_and_relogin(
        client, db_session, "modadmin1@example.com", "secret123"
    )

    response = await client.get("/api/groups/moderation", headers=admin_headers)

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()}
    assert circle_id in rows
    row = rows[circle_id]
    assert row["name"] == "Krąg Moderowany"
    assert row["organizer_name"] == "Modorganizer1"
    assert row["organizer_email"] == "modorganizer1@example.com"
    assert row["member_count"] == 0
    assert row["term_count"] == 1


async def test_listGroupsForModeration_circleWithNoLeadership_organizerFieldsAreNone(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """A Circle created via `POST /api/groups` (not `/api/groups/mine`)
    never gets a `Leadership` row — the moderation list must degrade to
    `None` organizer fields rather than erroring (`outerjoin`, not `join`)."""
    edit_headers = await _authed_headers(client, "modeditor1@example.com")
    circle = await client.post(
        "/api/groups", json={"name": "Krąg Bez Lidera"}, headers=edit_headers
    )
    assert circle.status_code == 201
    circle_id = circle.json()["id"]

    admin_headers = await _authed_headers(client, "modadmin2@example.com")
    admin_headers = await _grant_admin_and_relogin(
        client, db_session, "modadmin2@example.com", "secret123"
    )

    response = await client.get("/api/groups/moderation", headers=admin_headers)

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()}
    assert circle_id in rows
    row = rows[circle_id]
    assert row["organizer_name"] is None
    assert row["organizer_email"] is None
    assert row["member_count"] == 0
    assert row["term_count"] == 0
