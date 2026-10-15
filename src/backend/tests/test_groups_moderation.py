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

    response = await client.get("/api/groups/moderation?size=100", headers=admin_headers)

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()["items"]}
    assert circle_id in rows
    row = rows[circle_id]
    assert row["name"] == "Krąg Moderowany"
    assert row["organizer_name"] == "Modorganizer1"
    assert row["organizer_email"] == "modorganizer1@example.com"
    assert row["member_count"] == 0
    assert row["term_count"] == 1


def test_resolveRequirement_getTermsModeration_resolvesToAdmin() -> None:
    assert resolve_requirement("GET", "/api/terms/moderation") == ADMIN


async def test_listTermsForModeration_nonAdminPrincipal_returns403(client: AsyncClient) -> None:
    headers = await _authed_headers(client, "modtermsnonadmin@example.com")

    response = await client.get("/api/terms/moderation", headers=headers)

    assert response.status_code == 403


async def test_listTermsForModeration_adminPrincipal_returnsGroupNameAndSignupCountsLatestFirst(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_headers = await _authed_headers(client, "modtermsorg@example.com", role="ORGANIZER")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg Terminów"}, headers=org_headers
    )
    circle_id = circle.json()["id"]
    earlier = await client.post(
        "/api/terms",
        json={"circle_group_id": circle_id, "occurs_on": "2026-11-02T10:00:00"},
        headers=org_headers,
    )
    later = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle_id,
            "occurs_on": "2026-11-09T10:00:00",
            "description": "Drugie spotkanie",
        },
        headers=org_headers,
    )
    rsvp = await client.post(
        f"/api/groups/public/{circle_id}/rsvp",
        json={"term_id": later.json()["id"], "guardian_name": "Ola", "child_count": 2},
    )
    assert rsvp.status_code == 201
    admin_headers = await _authed_headers(client, "modtermsadmin@example.com")
    admin_headers = await _grant_admin_and_relogin(
        client, db_session, "modtermsadmin@example.com", "secret123"
    )

    response = await client.get("/api/terms/moderation?size=100", headers=admin_headers)

    assert response.status_code == 200, response.text
    mine = [row for row in response.json()["items"] if row["circle_group_id"] == circle_id]
    assert [row["id"] for row in mine] == [later.json()["id"], earlier.json()["id"]]
    assert mine[0]["group_name"] == "Krąg Terminów"
    assert mine[0]["description"] == "Drugie spotkanie"
    assert (mine[0]["attendee_count"], mine[0]["child_count"]) == (1, 2)
    assert (mine[1]["attendee_count"], mine[1]["child_count"]) == (0, 0)


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

    response = await client.get("/api/groups/moderation?size=100", headers=admin_headers)

    assert response.status_code == 200
    rows = {row["id"]: row for row in response.json()["items"]}
    assert circle_id in rows
    row = rows[circle_id]
    assert row["organizer_name"] is None
    assert row["organizer_email"] is None
    assert row["member_count"] == 0
    assert row["term_count"] == 0


async def test_listModeration_deletedTrue_listsOnlyDeletedSortedWithActorAndTotal(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_headers = await _authed_headers(client, "moddeleted.org@example.com", role="ORGANIZER")
    names = ["Krąg Pierwszy", "Krąg Drugi", "Krąg Żywy"]
    ids = []
    for name in names:
        circle = await client.post("/api/groups/mine/new", json={"name": name}, headers=org_headers)
        assert circle.status_code == 201
        ids.append(circle.json()["id"])
    first_id, second_id, live_id = ids
    for group_id in (first_id, second_id):
        deleted = await client.delete(f"/api/groups/{group_id}", headers=org_headers)
        assert deleted.status_code == 204
    await _authed_headers(client, "moddeleted.admin@example.com")
    admin_headers = await _grant_admin_and_relogin(
        client, db_session, "moddeleted.admin@example.com", "secret123"
    )

    response = await client.get(
        "/api/groups/moderation?deleted=true&size=100", headers=admin_headers
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert [row["id"] for row in body["items"]] == [second_id, first_id]
    assert body["total"] == 2
    assert all(row["deleted_at"] is not None for row in body["items"])
    assert all(row["deleted_by_name"] == "Moddeleted Org" for row in body["items"])
    live = await client.get("/api/groups/moderation?size=100", headers=admin_headers)
    live_ids = {row["id"] for row in live.json()["items"]}
    assert live_id in live_ids
    assert first_id not in live_ids and second_id not in live_ids
    assert live.json()["total"] == len(live_ids)


async def test_restoreGroup_admin_returns204AndGroupReadableAgain(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_headers = await _authed_headers(client, "modrestore.org@example.com", role="ORGANIZER")
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg do przywrócenia"}, headers=org_headers
    )
    circle_id = circle.json()["id"]
    assert (await client.delete(f"/api/groups/{circle_id}", headers=org_headers)).status_code == 204
    await _authed_headers(client, "modrestore.admin@example.com")
    admin_headers = await _grant_admin_and_relogin(
        client, db_session, "modrestore.admin@example.com", "secret123"
    )

    non_admin = await client.post(f"/api/groups/{circle_id}/restore", headers=org_headers)
    response = await client.post(f"/api/groups/{circle_id}/restore", headers=admin_headers)

    assert non_admin.status_code == 403
    assert response.status_code == 204
    assert (await client.get(f"/api/groups/{circle_id}", headers=org_headers)).status_code == 200
    assert (await client.get(f"/api/groups/public/{circle_id}")).status_code == 200
    live = await client.post(f"/api/groups/{circle_id}/restore", headers=admin_headers)
    assert live.status_code == 409
    assert live.json()["message"] == "Grupa nie jest usunięta"
    unknown = await client.post(
        "/api/groups/00000000-0000-0000-0000-000000000000/restore", headers=admin_headers
    )
    assert unknown.status_code == 404
