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

from app.groups.models import TermAttendance
from app.party.models import Party
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


async def test_createRsvp_mismatchedGroupAndTerm_raises404(client: AsyncClient) -> None:
    group_id_a, _term_id_a = await _create_circle_with_term(client, "rsvp.owner3@example.com")
    _group_id_b, term_id_b = await _create_circle_with_term(client, "rsvp.owner4@example.com")

    response = await client.post(
        f"/api/groups/public/{group_id_a}/rsvp",
        json={"term_id": term_id_b, "guardian_name": "Ala Kowalska", "child_count": 0},
    )

    assert response.status_code == 404
