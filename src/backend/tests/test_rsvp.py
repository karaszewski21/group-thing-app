"""Anonymous RSVP tests: `POST /api/groups/public/{group_id}/rsvp` (no auth
header) creates a Party+UserProfile(account_user_id=None)+TermAttendance;
the new guardian's `display_name` then appears in a subsequent public GET's
`guardians` list; `child_count` round-trips; a mismatched group_id/term_id
pair is rejected."""

from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.models import FamilyRole
from app.groups.models import GroupRole, TermAttendance
from app.party.models import Party
from app.users.models import UserProfile


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
            "circle_group_id": group_id,
            "occurs_on": date.today().isoformat(),
            "description": "Pierwsze spotkanie",
        },
        headers=_auth_headers(token),
    )
    return group_id, term.json()["id"]


async def test_createRsvp_anonymousNoAuthHeader_createsPartyProfileAndAttendance(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "rsvp.owner1@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Kasia Nowak", "child_count": 2},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["term_id"] == term_id
    assert body["guardian_name"] == "Kasia Nowak"
    assert body["child_count"] == 2

    assert body["attached_to_account"] is False

    profile = await db_session.get(UserProfile, body["user_profile_id"])
    assert profile is not None
    assert profile.account_user_id is None
    assert profile.display_name == "Kasia Nowak"

    party = await db_session.get(Party, profile.party_id)
    assert party is not None

    attendance_count = (
        await db_session.execute(
            select(func.count())
            .select_from(TermAttendance)
            .where(TermAttendance.term_id == term_id)
        )
    ).scalar_one()
    assert attendance_count == 1


async def test_createRsvp_thenPublicGet_guardianNameAndChildCountRoundTrip(
    client: AsyncClient,
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "rsvp.owner2@example.com")

    await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Piotr Zielinski", "child_count": 1},
    )

    public_view = await client.get(f"/api/groups/public/{group_id}")

    assert public_view.status_code == 200
    guardians = public_view.json()["guardians"]
    assert {"display_name": "Piotr Zielinski"} in guardians


async def test_createRsvp_loggedInUser_attachesToExistingAccountNotNewAnonymousProfile(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Regression (TDD red gate): a logged-in user who RSVPs via the public
    endpoint must have the `TermAttendance` attached to their EXISTING
    account/Party — not get a fresh detached anonymous `UserProfile`
    (`account_user_id=None`) minted. The public RSVP endpoint currently
    ignores the `Authorization: Bearer` header entirely; the fix makes it
    honour an optional valid token."""
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
        await db_session.execute(
            select(TermAttendance).where(TermAttendance.term_id == term_id)
        )
    ).scalars().all()
    assert len(attendance) == 1
    assert attendance[0].party_id == guest_party_id

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
    assert profile.party_id == guest_party_id
    assert profile.account_user_id is not None

    assert body["attached_to_account"] is True


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
    assert first.json()["attached_to_account"] is True
    assert second.json()["attached_to_account"] is True

    attendance = (
        await db_session.execute(
            select(TermAttendance).where(TermAttendance.term_id == term_id)
        )
    ).scalars().all()
    assert len(attendance) == 1
    assert attendance[0].party_id == guest_party_id
    assert attendance[0].child_count == 3


async def test_createRsvp_loggedInUserNotCircleMember_attachesAttendanceWithoutMembershipSideEffect(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Spec: RSVP is attendance-only — a logged-in caller who does not belong
    to the circle still RSVPs successfully, and no `Membership` (circle) or
    `Family*` row is minted as a side effect."""
    group_id, term_id = await _create_circle_with_term(client, "rsvp.nomember.owner@example.com")
    guest_token, guest_party_id = await _register_guest(client, "rsvp.nomember.guest@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Nieczlonek", "child_count": 2},
        headers=_auth_headers(guest_token),
    )

    assert response.status_code == 201
    assert response.json()["attached_to_account"] is True

    attendances = (
        await db_session.execute(
            select(TermAttendance).where(TermAttendance.term_id == term_id)
        )
    ).scalars().all()
    assert [attendance.party_id for attendance in attendances] == [guest_party_id]

    group_roles = (
        await db_session.execute(
            select(func.count())
            .select_from(GroupRole)
            .where(GroupRole.party_id == guest_party_id)
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
    assert family_roles == 0


async def test_createRsvp_expiredToken_fallsBackToAnonymousNot401(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "rsvp.badtoken.owner@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "Anon Mimo Tokena", "child_count": 2},
        headers={"Authorization": "Bearer not-a-real-token"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["attached_to_account"] is False

    profile = await db_session.get(UserProfile, body["user_profile_id"])
    assert profile is not None
    assert profile.account_user_id is None
    assert profile.display_name == "Anon Mimo Tokena"


async def test_createRsvp_mismatchedGroupAndTerm_raises404(client: AsyncClient) -> None:
    group_id_a, _term_id_a = await _create_circle_with_term(client, "rsvp.owner3@example.com")
    _group_id_b, term_id_b = await _create_circle_with_term(client, "rsvp.owner4@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id_a}/rsvp",
        json={"term_id": term_id_b, "guardian_name": "Ala Kowalska", "child_count": 0},
    )

    assert response.status_code == 404
