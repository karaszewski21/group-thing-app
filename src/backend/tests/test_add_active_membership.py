"""`add_active_membership` — the shared "make this party an active member of
this group" helper used by join-request approval and test seeding. Flat
`tests/` placement, same convention as `test_group_privacy.py`."""

from __future__ import annotations

from datetime import timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
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
            "occurs_on": (clock.local_now().date() + timedelta(days=7)).isoformat(),
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
    assert membership.valid_from == clock.local_now().date()
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
