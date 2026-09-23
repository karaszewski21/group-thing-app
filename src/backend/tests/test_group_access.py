"""`GET /api/groups/public/{group_id}/access` — server-resolved caller
relationship to a Circle (is_member/is_organizer/can_view_content/can_join),
replacing the frontend's previous "any auth token = member view" heuristic.

Isolation via the `conftest.py` TestContainers + savepoint-rollback fixtures;
naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`).
"""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> str:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"]


async def _create_circle(client: AsyncClient, token: str, name: str, visibility: str = "PUBLIC") -> int:
    r = await client.post(
        "/api/groups/mine", json={"name": name}, headers=_auth(token)
    )
    assert r.status_code == 201
    group_id = r.json()["id"]
    if visibility != "PUBLIC":
        r2 = await client.patch(
            f"/api/groups/{group_id}",
            json={"name": name, "layout_mode": "CIRCLE", "visibility": visibility},
            headers=_auth(token),
        )
        assert r2.status_code == 200
    return group_id


async def test_getGroupAccess_publicGroupUnauthenticated_canViewNoMembership(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org1@example.com")
    group_id = await _create_circle(client, org_token, "Access Public Circle")

    response = await client.get(f"/api/groups/public/{group_id}/access")

    assert response.status_code == 200
    body = response.json()
    assert body["group"]["id"] == group_id
    assert body["access"] == {
        "is_member": False,
        "is_organizer": False,
        "can_view_content": True,
        "can_join": False,
        "is_attending": False,
    }


async def test_getGroupAccess_organizerOwnGroup_reportsOrganizerAndMember(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org2@example.com")
    group_id = await _create_circle(client, org_token, "Access Organizer Circle")

    response = await client.get(
        f"/api/groups/public/{group_id}/access", headers=_auth(org_token)
    )

    assert response.status_code == 200
    assert response.json()["access"] == {
        "is_member": True,
        "is_organizer": True,
        "can_view_content": True,
        "can_join": False,
        "is_attending": False,
    }


async def test_getGroupAccess_privateGroupUnrelatedLoggedInVisitor_cannotViewCanJoin(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org3@example.com")
    group_id = await _create_circle(client, org_token, "Access Private Circle", "PRIVATE")
    visitor_token = await _register(client, "GUEST", "access.visitor3@example.com")

    response = await client.get(
        f"/api/groups/public/{group_id}/access", headers=_auth(visitor_token)
    )

    assert response.status_code == 200
    assert response.json()["access"] == {
        "is_member": False,
        "is_organizer": False,
        "can_view_content": False,
        "can_join": True,
        "is_attending": False,
    }


async def test_getGroupAccess_privateGroupUnauthenticated_cannotViewCanJoin(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org4@example.com")
    group_id = await _create_circle(client, org_token, "Access Private Circle 4", "PRIVATE")

    response = await client.get(f"/api/groups/public/{group_id}/access")

    assert response.status_code == 200
    body = response.json()
    assert body["access"]["can_view_content"] is False
    assert body["access"]["can_join"] is True
    assert body["group"]["next_term"] is None
    assert body["group"]["guardians"] == []


async def test_getGroupAccess_loggedInAttendeeOfShownTerm_reportsAttending(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "access.org5@example.com")
    group_id = await _create_circle(client, org_token, "Access Attending Circle")
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    term_id = term.json()["id"]
    attendee_token = await _register(client, "GUEST", "access.attendee5@example.com")
    bystander_token = await _register(client, "GUEST", "access.bystander5@example.com")
    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored"},
        headers=_auth(attendee_token),
    )
    assert rsvp.status_code == 201

    attendee = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={term_id}", headers=_auth(attendee_token)
    )
    bystander = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={term_id}", headers=_auth(bystander_token)
    )

    assert attendee.json()["access"]["is_attending"] is True
    assert bystander.json()["access"]["is_attending"] is False
