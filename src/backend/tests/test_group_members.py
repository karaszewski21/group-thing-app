"""Group member listing (`GET /api/groups/{id}/members`) — everyone who
RSVP'd to any of the group's Terms with a per-party term count, the
organizer-or-member gate, and withdrawn RSVPs.

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


async def _create_circle(client: AsyncClient, org_token: str, name: str) -> str:
    circle = await client.post(
        "/api/groups/mine/new", json={"name": name}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    return circle.json()["id"]


async def _create_term(client: AsyncClient, org_token: str, group_id: str, days: int) -> str:
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=days)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return term.json()["id"]


async def _rsvp(client: AsyncClient, token: str, group_id: str, term_id: str) -> str:
    r = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored", "child_count": 1},
        headers=_auth(token),
    )
    assert r.status_code == 201
    return r.json()["id"]


async def _get_members(client: AsyncClient, token: str, group_id: str) -> list[dict[str, object]]:
    r = await client.get(f"/api/groups/{group_id}/members", headers=_auth(token))
    assert r.status_code == 200
    return r.json()


async def test_listMembers_organizer_countsTermsPerPartyAndResolvesFamily(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.org@example.com")
    group_id = await _create_circle(client, org_token, "Krąg gm1")
    term_a = await _create_term(client, org_token, group_id, 7)
    term_b = await _create_term(client, org_token, group_id, 14)
    regular_token, regular_party_id = await _register(client, "GUEST", "gm.regular@example.com")
    once_token, once_party_id = await _register(client, "GUEST", "gm.once@example.com")
    added = await client.post(
        "/api/families/mine/members",
        json={"members": [{"name": "Dziecko", "role_type": "CHILD", "birth_year": 2019}]},
        headers=_auth(regular_token),
    )
    assert added.status_code == 201
    families = await client.get("/api/families/mine", headers=_auth(regular_token))
    family_name = families.json()[0]["name"]
    await _rsvp(client, regular_token, group_id, term_a)
    await _rsvp(client, regular_token, group_id, term_b)
    await _rsvp(client, once_token, group_id, term_a)

    members = await _get_members(client, org_token, group_id)

    by_party = {m["party_id"]: m for m in members}
    assert set(by_party) == {regular_party_id, once_party_id}
    regular = by_party[regular_party_id]
    assert set(regular) == {
        "party_id",
        "display_name",
        "family_name",
        "terms_attended",
        "last_term_on",
    }
    assert regular["terms_attended"] == 2
    assert regular["family_name"] == family_name
    assert regular["display_name"] != ""
    assert regular["last_term_on"].startswith((date.today() + timedelta(days=14)).isoformat())
    assert by_party[once_party_id]["terms_attended"] == 1
    assert members[0]["party_id"] == regular_party_id


async def test_listMembers_otherGroupsTerms_notCounted(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.other.org@example.com")
    group_id = await _create_circle(client, org_token, "Krąg gm2a")
    other_group_id = await _create_circle(client, org_token, "Krąg gm2b")
    term = await _create_term(client, org_token, group_id, 7)
    other_term = await _create_term(client, org_token, other_group_id, 7)
    guest_token, guest_party_id = await _register(client, "GUEST", "gm.other.guest@example.com")
    stranger_token, _ = await _register(client, "GUEST", "gm.other.stranger@example.com")
    await _rsvp(client, guest_token, group_id, term)
    await _rsvp(client, guest_token, other_group_id, other_term)
    await _rsvp(client, stranger_token, other_group_id, other_term)

    members = await _get_members(client, org_token, group_id)

    assert [m["party_id"] for m in members] == [guest_party_id]
    assert members[0]["terms_attended"] == 1


async def test_listMembers_withdrawnRsvp_excluded(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.withdrawn.org@example.com")
    group_id = await _create_circle(client, org_token, "Krąg gm3")
    term = await _create_term(client, org_token, group_id, 7)
    guest_token, _ = await _register(client, "GUEST", "gm.withdrawn.guest@example.com")
    attendance_id = await _rsvp(client, guest_token, group_id, term)
    withdraw = await client.post(
        f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(guest_token)
    )
    assert withdraw.status_code == 200

    assert await _get_members(client, org_token, group_id) == []


async def test_listMembers_outsider_returns403(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.forbidden.org@example.com")
    group_id = await _create_circle(client, org_token, "Krąg gm4")
    outsider_token, _ = await _register(client, "GUEST", "gm.forbidden.outsider@example.com")

    response = await client.get(f"/api/groups/{group_id}/members", headers=_auth(outsider_token))

    assert response.status_code == 403


async def test_listMembers_unknownGroup_returns404(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "gm.unknown.org@example.com")

    response = await client.get(f"/api/groups/{uuid.uuid4()}/members", headers=_auth(org_token))

    assert response.status_code == 404
