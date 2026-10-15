"""Group soft delete: an organizer's DELETE hides the Circle everywhere while
keeping its Leadership, and nobody can end someone else's Leadership."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import clock
from app.core.security import encode_login_token


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_circle(client: AsyncClient, token: str, name: str) -> str:
    response = await client.post("/api/groups/mine", json={"name": name}, headers=_auth_headers(token))
    assert response.status_code == 201
    return response.json()["id"]


async def test_deleteGroup_activeOrganizer_hidesGroupAndKeepsLeadership(client: AsyncClient) -> None:
    token = await _register_organizer(client, "softdel.owner@example.com")
    group_id = await _create_circle(client, token, "Krąg do usunięcia")
    leadership_before = await client.get(
        f"/api/groups/{group_id}/leadership", headers=_auth_headers(token)
    )
    assert leadership_before.status_code == 200

    response = await client.delete(f"/api/groups/{group_id}", headers=_auth_headers(token))

    assert response.status_code == 204
    assert (await client.get(f"/api/groups/public/{group_id}")).status_code == 404
    assert (await client.get(f"/api/groups/public/{group_id}/access")).status_code == 404
    assert (
        await client.get(f"/api/groups/{group_id}", headers=_auth_headers(token))
    ).status_code == 404


async def test_endLeadership_otherOrganizer_returns403(client: AsyncClient) -> None:
    owner_token = await _register_organizer(client, "softdel.lead.owner@example.com")
    group_id = await _create_circle(client, owner_token, "Cudzy krąg")
    leadership = await client.get(
        f"/api/groups/{group_id}/leadership", headers=_auth_headers(owner_token)
    )
    leadership_id = leadership.json()["id"]
    intruder_token = await _register_organizer(client, "softdel.lead.intruder@example.com")

    response = await client.post(
        f"/api/leaderships/{leadership_id}/end", headers=_auth_headers(intruder_token)
    )

    assert response.status_code == 403


async def _register_admin(client: AsyncClient, db_session: AsyncSession, email: str) -> str:
    await _register_organizer(client, email)
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
    response = await client.post("/api/auth/login", json={"email": email, "password": "secret123"})
    assert response.status_code == 200
    return response.json()["token"]


async def test_deleteGroup_nonOrganizer_returns403(client: AsyncClient) -> None:
    owner_token = await _register_organizer(client, "softdel.403.owner@example.com")
    group_id = await _create_circle(client, owner_token, "Nie twój krąg")
    intruder_token = await _register_organizer(client, "softdel.403.intruder@example.com")

    response = await client.delete(f"/api/groups/{group_id}", headers=_auth_headers(intruder_token))

    assert response.status_code == 403
    assert (
        await client.get(f"/api/groups/{group_id}", headers=_auth_headers(owner_token))
    ).status_code == 200


async def test_deleteGroup_admin_returns204AndRecordsAdminAsActor(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token = await _register_organizer(client, "softdel.admin.owner@example.com")
    group_id = await _create_circle(client, owner_token, "Krąg usuwany przez admina")
    admin_token = await _register_admin(client, db_session, "softdel.admin@example.com")

    response = await client.delete(f"/api/groups/{group_id}", headers=_auth_headers(admin_token))

    assert response.status_code == 204
    recorded_admin = (
        await db_session.execute(
            text(
                "SELECT g.deleted_at IS NOT NULL AND g.deleted_by_party_id = p.party_id "
                "FROM groups g, user_profiles p WHERE g.id = :group_id AND p.email = :email"
            ),
            {"group_id": group_id, "email": "softdel.admin@example.com"},
        )
    ).scalar_one()
    assert recorded_admin is True


async def test_deleteGroup_alreadyDeleted_returns404(client: AsyncClient) -> None:
    token = await _register_organizer(client, "softdel.twice@example.com")
    group_id = await _create_circle(client, token, "Krąg usuwany dwa razy")
    assert (
        await client.delete(f"/api/groups/{group_id}", headers=_auth_headers(token))
    ).status_code == 204

    response = await client.delete(f"/api/groups/{group_id}", headers=_auth_headers(token))

    assert response.status_code == 404


async def test_deleteGroup_upcomingTermWithActiveRsvp_returns409WithDate(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    freeze_local_now(datetime(2026, 11, 2, 9, 0))
    token = await _register_organizer(client, "softdel.409@example.com")
    group_id = await _create_circle(client, token, "Krąg z zapisami")
    occurs_on = clock.local_now() + timedelta(days=7)
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": group_id, "occurs_on": occurs_on.isoformat()},
        headers=_auth_headers(token),
    )
    assert term.status_code == 201
    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term.json()["id"], "guardian_name": "Ola", "child_count": 1},
    )
    assert rsvp.status_code == 201

    response = await client.delete(f"/api/groups/{group_id}", headers=_auth_headers(token))

    assert response.status_code == 409
    assert response.json()["message"] == (
        f"Grupy nie można usunąć — na termin {clock.format_term_day(occurs_on)} są zapisy. "
        "Spróbuj po tym terminie albo gdy uczestnicy się wypiszą."
    )


async def test_endLeadership_organizerOnDeletedGroup_returns200(client: AsyncClient) -> None:
    token = await _register_organizer(client, "softdel.end.owner@example.com")
    group_id = await _create_circle(client, token, "Usunięty krąg z liderem")
    leadership = await client.get(
        f"/api/groups/{group_id}/leadership", headers=_auth_headers(token)
    )
    leadership_id = leadership.json()["id"]
    assert (
        await client.delete(f"/api/groups/{group_id}", headers=_auth_headers(token))
    ).status_code == 204

    response = await client.post(
        f"/api/leaderships/{leadership_id}/end", headers=_auth_headers(token)
    )

    assert response.status_code == 200
    assert response.json()["valid_to"] is not None


async def test_assignLeadership_nonAdmin_returns403(client: AsyncClient) -> None:
    owner_token = await _register_organizer(client, "softdel.assign.owner@example.com")
    group_id = await _create_circle(client, owner_token, "Krąg do przejęcia")
    intruder = await client.post(
        "/api/auth/register",
        json={
            "role": "ORGANIZER",
            "email": "softdel.assign.intruder@example.com",
            "password": "secret123",
        },
    )
    assert intruder.status_code == 201

    response = await client.post(
        "/api/leaderships",
        json={
            "group_id": group_id,
            "organizer_party_id": intruder.json()["party_id"],
            "valid_from": "2026-10-14",
        },
        headers=_auth_headers(intruder.json()["token"]),
    )

    assert response.status_code == 403


def _profileless_admin_token() -> str:
    return encode_login_token(
        "softdel.ghost.admin@example.com",
        ["READ", "EDIT", "ADMIN"],
        settings.jwt_secret,
        settings.jwt_expiration_ms,
    )


async def test_deleteGroup_adminWithoutProfile_returns204AndActorUnknown(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    owner_token = await _register_organizer(client, "softdel.ghost.owner@example.com")
    group_id = await _create_circle(client, owner_token, "Krąg usuwany przez ducha")
    admin_headers = _auth_headers(_profileless_admin_token())

    response = await client.delete(f"/api/groups/{group_id}", headers=admin_headers)

    assert response.status_code == 204
    actor = (
        await db_session.execute(
            text("SELECT deleted_at IS NOT NULL, deleted_by_party_id FROM groups WHERE id = :id"),
            {"id": group_id},
        )
    ).one()
    assert tuple(actor) == (True, None)
    listed = await client.get("/api/groups/moderation?deleted=true&size=100", headers=admin_headers)
    row = next(row for row in listed.json()["items"] if row["id"] == group_id)
    assert row["deleted_by_name"] is None


async def test_endLeadership_adminWithoutProfileOnForeignGroup_returns200(
    client: AsyncClient,
) -> None:
    owner_token = await _register_organizer(client, "softdel.ghost.lead.owner@example.com")
    group_id = await _create_circle(client, owner_token, "Krąg kończony przez admina")
    leadership = await client.get(
        f"/api/groups/{group_id}/leadership", headers=_auth_headers(owner_token)
    )

    response = await client.post(
        f"/api/leaderships/{leadership.json()['id']}/end",
        headers=_auth_headers(_profileless_admin_token()),
    )

    assert response.status_code == 200, response.text
    assert response.json()["valid_to"] is not None
