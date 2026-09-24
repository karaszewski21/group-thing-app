"""`add_active_membership` — the shared "make this party an active member of
this group" helper used by join-request approval, term formalization and
test seeding. Flat `tests/` placement, same convention as
`test_group_privacy.py`."""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups import service


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, int]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _create_circle_and_term(
    client: AsyncClient, org_token: str, prefix: str
) -> tuple[int, int]:
    circle = await client.post(
        "/api/groups/mine", json={"name": f"Krąg {prefix}"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": circle.json()["id"],
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return circle.json()["id"], term.json()["id"]


async def test_addActiveMembership_newParty_createsActiveMemberRoleAndMembership(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "aam.org1@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "aam1")
    _guest_token, party_id = await _register(client, "GUEST", "aam.guest1@example.com")

    membership = await service.add_active_membership(db_session, group_id, party_id)

    assert membership.id is not None
    assert membership.to_group_id == group_id
    assert membership.valid_from == date.today()
    assert membership.valid_to is None
    memberships = await service.list_memberships_for_party(db_session, party_id)
    assert [(m.id, m.to_group_id) for m in memberships] == [(membership.id, group_id)]


async def test_addActiveMembership_callerRollsBack_membershipNotPersisted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "aam.org2@example.com")
    group_id, _term_id = await _create_circle_and_term(client, org_token, "aam2")
    _guest_token, party_id = await _register(client, "GUEST", "aam.guest2@example.com")

    await service.add_active_membership(db_session, group_id, party_id)
    await db_session.rollback()

    assert await service.list_memberships_for_party(db_session, party_id) == []


async def test_formalizeGroupFromTerm_afterRefactor_createsMemberships(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "aam.org3@example.com")
    group_id, term_id = await _create_circle_and_term(client, org_token, "aam3")
    guest_token, party_id = await _register(client, "GUEST", "aam.guest3@example.com")
    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Gość AAM", "child_count": 1},
        headers=_auth(guest_token),
    )
    assert rsvp.status_code == 201

    response = await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/formalize",
        json={"party_ids": [party_id]},
        headers=_auth(org_token),
    )

    assert response.status_code == 200
    memberships = await client.get(f"/api/groups/{group_id}/memberships", headers=_auth(org_token))
    assert memberships.status_code == 200
    assert [m["member_party_id"] for m in memberships.json()] == [party_id]
