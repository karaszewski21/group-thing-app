"""Account-merge tests: `POST /api/groups/public/merge` (per
scope-clarifications.md Decision #2 — 5 mandatory tests, none optional).
Merge updates the *existing* `UserProfile` row's `account_user_id`/`email`
in place — no second Party/UserProfile row, no data loss on the profile's
pre-existing `TermAttendance`."""

from __future__ import annotations

from datetime import date

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import TermAttendance
from app.users.models import UserProfile


async def _register_organizer(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register",
        json={"role": "ORGANIZER", "email": email, "password": "secret123"},
    )
    assert response.status_code == 201
    return response.json()["token"]


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


async def _create_rsvp(
    client: AsyncClient, group_id: int, term_id: int, guardian_name: str
) -> dict:
    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": guardian_name, "child_count": 3},
    )
    assert response.status_code == 201
    return response.json()


async def test_mergeAnonymousProfile_updatesAccountUserIdOnSameProfileId(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "merge.owner1@example.com")
    rsvp = await _create_rsvp(client, group_id, term_id, "Kasia Nowak")
    profile_id = rsvp["user_profile_id"]

    response = await client.post(
        "/api/groups/public/merge",
        json={
            "user_profile_id": profile_id,
            "email": "kasia.merge1@example.com",
            "password": "secret123",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["token"], str) and body["token"]
    assert isinstance(body["party_id"], int)

    profile = await db_session.get(UserProfile, profile_id)
    assert profile is not None
    assert profile.id == profile_id
    assert profile.account_user_id is not None
    assert profile.email == "kasia.merge1@example.com"


async def test_mergeAnonymousProfile_thenLogin_succeeds(client: AsyncClient) -> None:
    group_id, term_id = await _create_circle_with_term(client, "merge.owner2@example.com")
    rsvp = await _create_rsvp(client, group_id, term_id, "Piotr Zielinski")
    profile_id = rsvp["user_profile_id"]

    merge_response = await client.post(
        "/api/groups/public/merge",
        json={
            "user_profile_id": profile_id,
            "email": "piotr.merge2@example.com",
            "password": "secret123",
        },
    )
    assert merge_response.status_code == 200

    login_response = await client.post(
        "/api/auth/login",
        json={"email": "piotr.merge2@example.com", "password": "secret123"},
    )

    assert login_response.status_code == 200
    assert isinstance(login_response.json()["token"], str) and login_response.json()["token"]


async def test_mergeAnonymousProfile_preservesExistingTermAttendance(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "merge.owner3@example.com")
    rsvp = await _create_rsvp(client, group_id, term_id, "Ala Kowalska")
    profile_id = rsvp["user_profile_id"]

    attendance_before = (
        await db_session.execute(
            select(TermAttendance).where(TermAttendance.term_id == term_id)
        )
    ).scalar_one()
    attendance_id_before = attendance_before.id
    party_id_before = attendance_before.party_id
    child_count_before = attendance_before.child_count

    merge_response = await client.post(
        "/api/groups/public/merge",
        json={
            "user_profile_id": profile_id,
            "email": "ala.merge3@example.com",
            "password": "secret123",
        },
    )
    assert merge_response.status_code == 200

    attendance_after = await db_session.get(TermAttendance, attendance_id_before)
    assert attendance_after is not None
    assert attendance_after.id == attendance_id_before
    assert attendance_after.party_id == party_id_before
    assert attendance_after.child_count == child_count_before

    attendance_count = (
        await db_session.execute(
            select(func.count())
            .select_from(TermAttendance)
            .where(TermAttendance.term_id == term_id)
        )
    ).scalar_one()
    assert attendance_count == 1


async def test_mergeAnonymousProfile_emailAlreadyHasAccount_returns409(
    client: AsyncClient,
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "merge.owner4@example.com")
    rsvp = await _create_rsvp(client, group_id, term_id, "Ola Wisniewska")
    profile_id = rsvp["user_profile_id"]

    existing_email = "merge.owner4@example.com"  # already used by the organizer account above

    response = await client.post(
        "/api/groups/public/merge",
        json={
            "user_profile_id": profile_id,
            "email": existing_email,
            "password": "secret123",
        },
    )

    assert response.status_code == 409


async def test_mergeAnonymousProfile_alreadyMergedProfile_secondMergeReturns409(
    client: AsyncClient,
) -> None:
    group_id, term_id = await _create_circle_with_term(client, "merge.owner5@example.com")
    rsvp = await _create_rsvp(client, group_id, term_id, "Tomek Kaczmarek")
    profile_id = rsvp["user_profile_id"]

    first_merge = await client.post(
        "/api/groups/public/merge",
        json={
            "user_profile_id": profile_id,
            "email": "tomek.merge5@example.com",
            "password": "secret123",
        },
    )
    assert first_merge.status_code == 200

    second_merge = await client.post(
        "/api/groups/public/merge",
        json={
            "user_profile_id": profile_id,
            "email": "tomek.merge5.second@example.com",
            "password": "secret123",
        },
    )

    assert second_merge.status_code == 409


async def test_mergeAnonymousProfile_malformedEmail_returns400(client: AsyncClient) -> None:
    """Regression test for a code-review finding: `MergeAnonymousProfileRequest.email`
    previously had no format validation (unlike `RegisterRequest.email`), so a
    malformed value could reach the service layer instead of failing fast."""
    group_id, term_id = await _create_circle_with_term(client, "merge.owner6@example.com")
    rsvp = await _create_rsvp(client, group_id, term_id, "Zosia Krawczyk")
    profile_id = rsvp["user_profile_id"]

    response = await client.post(
        "/api/groups/public/merge",
        json={
            "user_profile_id": profile_id,
            "email": "not-an-email",
            "password": "secret123",
        },
    )

    # Pydantic validation errors are mapped to the legacy 400 envelope by this
    # app's custom exception handling (not FastAPI's raw 422 default) — same
    # convention `RegisterRequest.email`'s existing validation already follows.
    assert response.status_code == 400
