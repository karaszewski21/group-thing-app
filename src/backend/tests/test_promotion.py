"""GUEST -> ORGANIZER "Chcę dodać krąg" promotion flow tests — Group 8 gap
fill per implementation-plan.md's 8.2(b): the promotion flow's atomicity
(hamburger click -> circle created -> `isOrganizer` true) exercised as a
single flow crossing Group 1's registration and Group 6/7's promotion UI,
against the shared `POST /api/groups/mine` endpoint (spec.md Core
Requirement 12 — no new backend endpoint for this action)."""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import GroupRole, GroupRoleType, Leadership
from app.users.models import UserProfile


async def _register_guest(client: AsyncClient, email: str) -> tuple[str, int]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    body = response.json()
    return body["token"], body["party_id"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def test_promoteGuestToOrganizer_singleCallToGroupsMine_grantsRoleAndCreatesCircleAtomically(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    token, party_id = await _register_guest(client, "promote.guest@example.com")

    # Before promotion: no GroupRole at all for this party (registration
    # grants only the users-BC UserRoleType.ORGANIZATOR when role==ORGANIZER
    # — never the groups-BC GroupRole — per Core Requirement 4).
    roles_before = (
        await db_session.execute(select(GroupRole).where(GroupRole.party_id == party_id))
    ).scalars().all()
    assert roles_before == []

    response = await client.post(
        "/api/groups/mine",
        json={"name": "Nutki dla starszaków"},
        headers=_auth_headers(token),
    )

    assert response.status_code == 201
    circle = response.json()
    assert circle["name"] == "Nutki dla starszaków"

    # The single call both granted ORGANIZATOR (GroupRole) and created
    # exactly one new active Leadership pointing at the new circle — atomic,
    # not two separately-observable steps.
    roles_after = (
        await db_session.execute(select(GroupRole).where(GroupRole.party_id == party_id))
    ).scalars().all()
    assert len(roles_after) == 1
    role = roles_after[0]
    assert role.role_type == GroupRoleType.ORGANIZATOR

    leaderships = (
        await db_session.execute(select(Leadership).where(Leadership.from_role_id == role.id))
    ).scalars().all()
    assert len(leaderships) == 1
    assert leaderships[0].to_group_id == circle["id"]
    assert leaderships[0].valid_to is None


async def test_promoteGuestToOrganizer_priorGuestSession_hadNoActiveLeadership(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Sanity check on the "before" half of the promotion flow — a freshly
    registered GUEST (per Core Requirement 3/4, registration creates no
    circle) has no active leadership until they explicitly promote via
    `POST /api/groups/mine`."""
    _, party_id = await _register_guest(client, "not.yet.organizer@example.com")

    profile = (
        await db_session.execute(select(UserProfile).where(UserProfile.party_id == party_id))
    ).scalar_one()
    assert profile.party_id == party_id

    roles = (
        await db_session.execute(select(GroupRole).where(GroupRole.party_id == party_id))
    ).scalars().all()
    assert roles == []
