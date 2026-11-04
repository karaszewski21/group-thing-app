"""RSVP tests: `POST /api/groups/public/{group_id}/rsvp` needs an account —
no token (or an invalid one) is a 401 that creates nothing; a logged-in
caller's own party is attached idempotently, its display name then appears
in the public GET's `guardians` list; a mismatched group_id/term_id pair is
rejected."""

from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.models import FamilyRole
from app.groups.models import GroupRole, TermAttendance
from app.users.models import UserProfile
from tests.conftest import create_location


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


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


async def _create_circle_with_term(client: AsyncClient, email: str) -> tuple[int, int]:
    token = await _register_organizer(client, email)
    circle = await client.post(
        "/api/groups/mine", json={"name": "Muzyczne Skrzaty"}, headers=_auth_headers(token)
    )
    group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={
            "location_id": await create_location(client, _auth_headers(token)),
            "circle_group_id": group_id,
            "occurs_on": date.today().isoformat(),
            "description": "Pierwsze spotkanie",
        },
        headers=_auth_headers(token),
    )
    return group_id, term.json()["id"]


async def test_createRsvp_withoutOrInvalidToken_returns401AndCreatesNothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "rsvp.owner1@example.com")
    profiles_before = (
        await db_session.execute(select(func.count()).select_from(UserProfile))
    ).scalar_one()

    for headers in ({}, {"Authorization": "Bearer not-a-real-token"}):
        response = await client.post(
            f"/api/groups/public/{group_id}/rsvp",
            json={"term_id": term_id, "guardian_name": "Kasia Nowak", "child_count": 2},
            headers=headers,
        )
        assert response.status_code == 401

    attendance_count = (
        await db_session.execute(
            select(func.count())
            .select_from(TermAttendance)
            .where(TermAttendance.term_id == term_id)
        )
    ).scalar_one()
    assert attendance_count == 0
    profiles_after = (
        await db_session.execute(select(func.count()).select_from(UserProfile))
    ).scalar_one()
    assert profiles_after == profiles_before


async def test_createRsvp_thenPublicGet_displayNameAndShapeRoundTrip(
    client: AsyncClient,
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "rsvp.owner2@example.com")
    guest_token, _ = await _register_guest(client, "piotr.zielinski@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "child_count": 1},
        headers=_auth_headers(guest_token),
    )

    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"id", "term_id", "user_profile_id", "guardian_name", "child_count"}
    assert body["child_count"] == 1
    public_view = await client.get(f"/api/groups/public/{group_id}")

    assert public_view.status_code == 200
    guardians = public_view.json()["guardians"]
    assert body["guardian_name"] in {guardian["display_name"] for guardian in guardians}


async def test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """The `TermAttendance` is attached to the caller's EXISTING account/Party
    — no detached `UserProfile` (`account_user_id=None`) is minted."""
    group_id, term_id = await _create_circle_with_term(client, "rsvp.loggedin.owner@example.com")
    guest_token, guest_party_id = await _register_guest(client, "rsvp.loggedin.guest@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Zalogowany Rodzic", "child_count": 1},
        headers=_auth_headers(guest_token),
    )

    assert response.status_code == 201
    body = response.json()

    attendance = (
        (await db_session.execute(select(TermAttendance).where(TermAttendance.term_id == term_id)))
        .scalars()
        .all()
    )
    assert len(attendance) == 1
    assert str(attendance[0].party_id) == guest_party_id

    anonymous_profiles = (
        await db_session.execute(
            select(func.count())
            .select_from(UserProfile)
            .where(
                UserProfile.display_name == "Zalogowany Rodzic",
                UserProfile.account_user_id.is_(None),
            )
        )
    ).scalar_one()
    assert anonymous_profiles == 0

    profile = await db_session.get(UserProfile, body["user_profile_id"])
    assert profile is not None
    assert str(profile.party_id) == guest_party_id
    assert profile.account_user_id is not None


async def test_createRsvp_loggedInUserRepeat_updatesChildCountNoDuplicateRow(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "rsvp.repeat.owner@example.com")
    guest_token, guest_party_id = await _register_guest(client, "rsvp.repeat.guest@example.com")

    first = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "x", "child_count": 1},
        headers=_auth_headers(guest_token),
    )
    second = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "x", "child_count": 3},
        headers=_auth_headers(guest_token),
    )

    assert first.status_code == 201
    assert second.status_code == 201

    attendance = (
        (await db_session.execute(select(TermAttendance).where(TermAttendance.term_id == term_id)))
        .scalars()
        .all()
    )
    assert len(attendance) == 1
    assert str(attendance[0].party_id) == guest_party_id
    assert attendance[0].child_count == 3


async def test_createRsvp_loggedInUserNotCircleMember_attachesAttendanceWithoutMembershipSideEffect(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Spec: RSVP is attendance-only — a logged-in caller who does not belong
    to the circle still RSVPs successfully, and no `Membership` (circle) or
    `Family*` row is minted as a side effect."""
    group_id, term_id = await _create_circle_with_term(client, "rsvp.nomember.owner@example.com")
    guest_token, guest_party_id = await _register_guest(client, "rsvp.nomember.guest@example.com")

    # `register()` now auto-creates a solo Family (one FamilyRole(GUARDIAN))
    # for every new party (spec.md Core Requirements 3-4), so
    # `guest_party_id` already has exactly one FamilyRole at this point —
    # capture it so the assertion below proves the RSVP itself adds no
    # *additional* Family* row, rather than assuming a pristine zero.
    family_roles_before = (
        await db_session.execute(
            select(func.count())
            .select_from(FamilyRole)
            .where(FamilyRole.party_id == guest_party_id)
        )
    ).scalar_one()

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Nieczlonek", "child_count": 2},
        headers=_auth_headers(guest_token),
    )

    assert response.status_code == 201

    attendances = (
        (await db_session.execute(select(TermAttendance).where(TermAttendance.term_id == term_id)))
        .scalars()
        .all()
    )
    assert [str(attendance.party_id) for attendance in attendances] == [guest_party_id]

    group_roles = (
        await db_session.execute(
            select(func.count()).select_from(GroupRole).where(GroupRole.party_id == guest_party_id)
        )
    ).scalar_one()
    assert group_roles == 0

    family_roles = (
        await db_session.execute(
            select(func.count())
            .select_from(FamilyRole)
            .where(FamilyRole.party_id == guest_party_id)
        )
    ).scalar_one()
    assert family_roles == family_roles_before


async def test_createRsvp_mismatchedGroupAndTerm_raises404(client: AsyncClient) -> None:
    group_id_a, _term_id_a = await _create_circle_with_term(client, "rsvp.owner3@example.com")
    _group_id_b, term_id_b = await _create_circle_with_term(client, "rsvp.owner4@example.com")
    guest_token, _ = await _register_guest(client, "rsvp.mismatch.guest@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id_a}/rsvp",
        json={"term_id": term_id_b, "child_count": 0},
        headers=_auth_headers(guest_token),
    )

    assert response.status_code == 404
