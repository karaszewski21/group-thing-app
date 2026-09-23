"""Solo-family auto-creation — implementation/spec.md Core Requirements 3, 4:
every new `Party` (via `/api/auth/register` and anonymous RSVP) must have
exactly one resolvable solo `Family` immediately after creation, and the
creation path must be idempotent (never a second Family for the same party).

Isolation via the `conftest.py` TestContainers + savepoint-rollback fixtures;
naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`)."""

from __future__ import annotations

from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.bootstrap import create_solo_family_for_party
from app.families.repository import list_families_for_guardian_party


async def _register_guest(client: AsyncClient, email: str) -> tuple[str, int]:
    response = await client.post(
        "/api/auth/register",
        json={"role": "GUEST", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    body = response.json()
    return body["token"], body["party_id"]


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


def _auth_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _create_circle(client: AsyncClient, token: str, name: str) -> int:
    circle = await client.post(
        "/api/groups/mine", json={"name": name}, headers=_auth_headers(token)
    )
    assert circle.status_code == 201
    return circle.json()["id"]


async def _create_term(client: AsyncClient, token: str, group_id: int) -> int:
    term = await client.post(
        "/api/terms",
        json={
            "circle_group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
            "description": "Zajęcia",
        },
        headers=_auth_headers(token),
    )
    assert term.status_code == 201
    return term.json()["id"]


async def test_register_newAccount_createsSoloFamily(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _token, party_id = await _register_guest(client, "bootstrap.register@example.com")

    families = await list_families_for_guardian_party(db_session, party_id)

    assert len(families) == 1


async def test_createRsvp_anonymousAttendee_createsSoloFamily(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    organizer_token = await _register_organizer(client, "bootstrap.organizer@example.com")
    group_id = await _create_circle(client, organizer_token, "Zajęcia muzyczne")
    term_id = await _create_term(client, organizer_token, group_id)

    rsvp = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Anonimowy Gość", "child_count": 0},
    )
    assert rsvp.status_code == 201
    party_id = rsvp.json()["user_profile_id"]
    # `user_profile_id` in RsvpResponse is the UserProfile.id, not party_id —
    # resolve the party via the profile so the lookup below is correct.
    from app.users.service import get_profile

    profile = await get_profile(db_session, party_id)

    families = await list_families_for_guardian_party(db_session, profile.party_id)

    assert len(families) == 1


async def test_createSoloFamilyForParty_calledTwice_returnsSameFamilyBothTimes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _token, party_id = await _register_guest(client, "bootstrap.idempotent@example.com")

    first = await create_solo_family_for_party(db_session, party_id, "Test Idempotent")
    second = await create_solo_family_for_party(db_session, party_id, "Test Idempotent")

    assert first.id == second.id

    families = await list_families_for_guardian_party(db_session, party_id)
    assert len(families) == 1
