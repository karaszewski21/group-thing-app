"""Group member listing (`GET /api/groups/{id}/members`) — resolved display
names and families, the organizer-or-member gate, and ended memberships.

Flat `tests/` placement, same convention as `test_term_attendees.py`."""

from __future__ import annotations

import uuid
from datetime import date, timedelta

from httpx import AsyncClient


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, str]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _create_private_circle(client: AsyncClient, org_token: str, name: str) -> str:
    circle = await client.post(
        "/api/groups/mine/new",
        json={"name": name, "visibility": "PRIVATE"},
        headers=_auth(org_token),
    )
    assert circle.status_code == 201
    return circle.json()["id"]


async def _join(client: AsyncClient, org_token: str, member_token: str, group_id: str) -> None:
    request = await client.post(
        f"/api/groups/public/{group_id}/join-requests",
        json={"term_id": None},
        headers=_auth(member_token),
    )
    assert request.status_code == 201
    approve = await client.post(
        f"/api/groups/{group_id}/join-requests/{request.json()['id']}/approve",
        headers=_auth(org_token),
    )
    assert approve.status_code == 200


async def _get_members(client: AsyncClient, token: str, group_id: str) -> list[dict[str, object]]:
    r = await client.get(f"/api/groups/{group_id}/members", headers=_auth(token))
    assert r.status_code == 200
    return r.json()


async def test_listMembers_organizer_returnsNamesFamiliesAndMemberSince(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.org@example.com")
    group_id = await _create_private_circle(client, org_token, "Krąg gm1")
    member_token, member_party_id = await _register(client, "GUEST", "gm.member@example.com")
    added = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Dziecko", "role_type": "CHILD", "birth_year": 2019}]},
        headers=_auth(member_token),
    )
    assert added.status_code == 201
    families = await client.get("/api/families/mine", headers=_auth(member_token))
    family_name = families.json()[0]["name"]
    await _join(client, org_token, member_token, group_id)

    members = await _get_members(client, org_token, group_id)

    assert len(members) == 1
    member = members[0]
    assert set(member) == {"party_id", "display_name", "family_name", "member_since"}
    assert member["party_id"] == member_party_id
    assert member["display_name"] != ""
    assert member["family_name"] == family_name
    assert member["member_since"] == date.today().isoformat()


async def test_listMembers_standingMember_canSeeList(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.visible.org@example.com")
    group_id = await _create_private_circle(client, org_token, "Krąg gm2")
    first_token, first_party_id = await _register(client, "GUEST", "gm.visible.first@example.com")
    second_token, second_party_id = await _register(
        client, "GUEST", "gm.visible.second@example.com"
    )
    await _join(client, org_token, first_token, group_id)
    await _join(client, org_token, second_token, group_id)

    members = await _get_members(client, first_token, group_id)

    assert {m["party_id"] for m in members} == {first_party_id, second_party_id}


async def test_listMembers_outsider_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.forbidden.org@example.com")
    group_id = await _create_private_circle(client, org_token, "Krąg gm3")
    outsider_token, _ = await _register(client, "GUEST", "gm.forbidden.outsider@example.com")

    response = await client.get(f"/api/groups/{group_id}/members", headers=_auth(outsider_token))

    assert response.status_code == 403


async def test_listMembers_unknownGroup_returns404(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.unknown.org@example.com")

    response = await client.get(f"/api/groups/{uuid.uuid4()}/members", headers=_auth(org_token))

    assert response.status_code == 404


async def test_listMembers_endedMembership_excluded(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.ended.org@example.com")
    group_id = await _create_private_circle(client, org_token, "Krąg gm4")
    member_token, member_party_id = await _register(client, "GUEST", "gm.ended.member@example.com")
    await _join(client, org_token, member_token, group_id)
    memberships = await client.get(f"/api/groups/{group_id}/memberships", headers=_auth(org_token))
    membership_id = next(
        m["id"] for m in memberships.json() if m["member_party_id"] == member_party_id
    )
    ended = await client.post(
        f"/api/memberships/{membership_id}/end",
        params={"valid_to": (date.today() - timedelta(days=1)).isoformat()},
        headers=_auth(member_token),
    )
    assert ended.status_code == 200

    members = await _get_members(client, org_token, group_id)

    assert members == []
