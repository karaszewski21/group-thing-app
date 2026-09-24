"""Regression tests for PRIVATE-group access defects fixed alongside the
join-request flow:

- B13: an organizer (or member) of a PRIVATE group must get the full term
  content from `/access`, and a foreign/unknown `term_id` must 404 for them.
- B14: no endpoint may grant membership of a group without the organizer's
  approval (`POST /api/memberships`, `POST /api/groups/public/{id}/join`).

Naming follows `action_condition_expectedResult`
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


async def _create_private_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str
) -> tuple[int, int]:
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    private = await client.patch(
        f"/api/groups/{group_id}",
        json={"name": f"Krąg {prefix}", "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    assert private.status_code == 200
    return group_id, term.json()["id"]


async def _member_count(client: AsyncClient, org_token: str, group_id: int) -> int:
    memberships = await client.get(
        f"/api/groups/{group_id}/memberships", headers=_auth(org_token)
    )
    assert memberships.status_code == 200
    return len(memberships.json())


async def test_getGroupAccess_privateGroupOrganizer_returnsFullTermContent(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "b13.org1@example.com")
    group_id, term_id = await _create_private_circle_and_term(client, org_token, "b13a")

    response = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={term_id}", headers=_auth(org_token)
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access"]["can_view_content"] is True
    assert body["group"]["next_term"] is not None
    assert body["group"]["next_term"]["id"] == term_id


async def test_getGroupAccess_privateGroupOrganizerUnknownTermId_returns404(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "b13.org2@example.com")
    group_id, _term_id = await _create_private_circle_and_term(client, org_token, "b13b")

    response = await client.get(
        f"/api/groups/public/{group_id}/access?term_id=999999999", headers=_auth(org_token)
    )

    assert response.status_code == 404


async def test_getGroupAccess_privateGroupOutsider_keepsReducedResponse(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "b13.org3@example.com")
    group_id, term_id = await _create_private_circle_and_term(client, org_token, "b13c")
    outsider_token = await _register(client, "GUEST", "b13.outsider3@example.com")

    response = await client.get(
        f"/api/groups/public/{group_id}/access?term_id={term_id}",
        headers=_auth(outsider_token),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["access"]["can_view_content"] is False
    assert body["group"]["next_term"] is None
    assert body["group"]["guardians"] == []


async def test_createMembership_outsiderSelfJoinsPrivateGroup_isNotPossible(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "b14.org1@example.com")
    group_id, _term_id = await _create_private_circle_and_term(client, org_token, "b14a")
    outsider_token = await _register(client, "GUEST", "b14.outsider1@example.com")

    response = await client.post(
        "/api/memberships",
        json={"group_id": group_id, "valid_from": date.today().isoformat()},
        headers=_auth(outsider_token),
    )

    assert response.status_code in (404, 405)
    assert await _member_count(client, org_token, group_id) == 0


async def test_joinPrivateGroup_outsiderWithoutApproval_isNotPossible(
    client: AsyncClient,
) -> None:
    org_token = await _register(client, "ORGANIZER", "b14.org2@example.com")
    group_id, _term_id = await _create_private_circle_and_term(client, org_token, "b14b")
    outsider_token = await _register(client, "GUEST", "b14.outsider2@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/join",
        json={"guardian_name": "Gość", "child_count": 0},
        headers=_auth(outsider_token),
    )

    assert response.status_code in (404, 405)
    assert await _member_count(client, org_token, group_id) == 0
