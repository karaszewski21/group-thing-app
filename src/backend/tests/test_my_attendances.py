"""`GET /api/groups/mine/attendances` (R10): the authenticated caller's own
Term RSVPs, each row carrying enough to build the public-term link
(`organizer_slug` + `group_id` + `term_id`) and the panel tile (date, circle
name, organizer) with no second request. Only the caller's attendances are
returned, ordered ascending by `Term.occurs_on` in SQL.

Isolation via the `conftest.py` TestContainers + savepoint-rollback fixtures;
naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`).
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import cast

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


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


async def _create_circle(client: AsyncClient, token: str, name: str) -> int:
    circle = await client.post(
        "/api/groups/mine", json={"name": name}, headers=_auth_headers(token)
    )
    assert circle.status_code == 201
    return circle.json()["id"]


async def _create_term(client: AsyncClient, token: str, group_id: int, occurs_on: date) -> int:
    term = await client.post(
        "/api/terms",
        json={"circle_group_id": group_id, "occurs_on": occurs_on.isoformat(), "description": None},
        headers=_auth_headers(token),
    )
    assert term.status_code == 201
    return term.json()["id"]


async def _rsvp(
    client: AsyncClient, group_id: int, term_id: int, child_count: int, token: str
) -> dict[str, object]:
    response = await client.post(
        f"/api/groups/public/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "x", "child_count": child_count},
        headers=_auth_headers(token),
    )
    assert response.status_code == 201
    assert response.json()["attached_to_account"] is True
    return response.json()


async def test_getMyAttendances_returnsOnlyCallersAttendancesWithTermAndCircleAndOrganizerInfo(
    client: AsyncClient,
) -> None:
    token_a = await _register_organizer(client, "ma.owner.a@example.com")
    group_a = await _create_circle(client, token_a, "Krąg A")
    term_a1 = await _create_term(client, token_a, group_a, date.today() + timedelta(days=3))
    term_a2 = await _create_term(client, token_a, group_a, date.today() + timedelta(days=10))
    org_a = await client.post(
        "/api/organizations/mine", json={"name": "Muzyczne Skrzaty"}, headers=_auth_headers(token_a)
    )
    assert org_a.status_code == 201
    slug_a = org_a.json()["slug"]

    token_b = await _register_organizer(client, "ma.owner.b@example.com")
    group_b = await _create_circle(client, token_b, "Krąg B")
    term_b1 = await _create_term(client, token_b, group_b, date.today() + timedelta(days=5))

    guest_token, _ = await _register_guest(client, "ma.guest@example.com")
    other_token, _ = await _register_guest(client, "ma.other@example.com")

    att_a1 = await _rsvp(client, group_a, term_a1, 2, guest_token)
    att_b1 = await _rsvp(client, group_b, term_b1, 1, guest_token)
    # Third party attends term_a2 and term_a1 — must never surface for the guest.
    await _rsvp(client, group_a, term_a2, 4, other_token)
    await _rsvp(client, group_a, term_a1, 3, other_token)

    response = await client.get("/api/groups/mine/attendances", headers=_auth_headers(guest_token))

    assert response.status_code == 200
    rows = response.json()
    assert [row["term_id"] for row in rows] == [term_a1, term_b1]

    by_term = {row["term_id"]: row for row in rows}
    assert by_term[term_a1]["attendance_id"] == att_a1["id"]
    assert by_term[term_a1]["child_count"] == 2
    assert by_term[term_a1]["group_id"] == group_a
    assert by_term[term_a1]["group_name"] == "Krąg A"
    assert by_term[term_a1]["organizer_slug"] == slug_a
    assert by_term[term_a1]["organizer_display_name"] is not None
    assert set(by_term[term_a1].keys()) == {
        "attendance_id",
        "term_id",
        "occurs_on",
        "child_count",
        "group_id",
        "group_name",
        "organizer_display_name",
        "organizer_slug",
    }

    assert by_term[term_b1]["attendance_id"] == att_b1["id"]
    assert by_term[term_b1]["group_id"] == group_b
    assert by_term[term_b1]["group_name"] == "Krąg B"


async def test_getMyAttendances_noAttendances_returnsEmptyList(client: AsyncClient) -> None:
    guest_token, _ = await _register_guest(client, "ma.empty.guest@example.com")

    response = await client.get("/api/groups/mine/attendances", headers=_auth_headers(guest_token))

    assert response.status_code == 200
    assert response.json() == []


async def test_getMyAttendances_orderedByTermDateAscendingInSql(client: AsyncClient) -> None:
    token = await _register_organizer(client, "ma.order.owner@example.com")
    group_id = await _create_circle(client, token, "Krąg C")
    late_term = await _create_term(client, token, group_id, date.today() + timedelta(days=30))
    early_term = await _create_term(client, token, group_id, date.today() + timedelta(days=2))
    mid_term = await _create_term(client, token, group_id, date.today() + timedelta(days=15))

    guest_token, _ = await _register_guest(client, "ma.order.guest@example.com")
    await _rsvp(client, group_id, late_term, 1, guest_token)
    await _rsvp(client, group_id, early_term, 1, guest_token)
    await _rsvp(client, group_id, mid_term, 1, guest_token)

    response = await client.get("/api/groups/mine/attendances", headers=_auth_headers(guest_token))

    assert response.status_code == 200
    rows = response.json()
    assert [row["term_id"] for row in rows] == [early_term, mid_term, late_term]
    occurs = [row["occurs_on"] for row in rows]
    assert occurs == sorted(occurs)


async def test_getMyAttendances_afterRepeatRsvp_reflectsUpdatedChildCountNoDuplicateRow(
    client: AsyncClient,
) -> None:
    """The R5 idempotent repeat RSVP (same `(party, term)`, new `child_count`)
    surfaces here as one row with the refreshed count — not a duplicate."""
    token = await _register_organizer(client, "ma.repeat.owner@example.com")
    group_id = await _create_circle(client, token, "Krąg Powtórka")
    term_id = await _create_term(client, token, group_id, date.today() + timedelta(days=4))

    guest_token, _ = await _register_guest(client, "ma.repeat.guest@example.com")
    await _rsvp(client, group_id, term_id, 1, guest_token)
    await _rsvp(client, group_id, term_id, 4, guest_token)

    response = await client.get("/api/groups/mine/attendances", headers=_auth_headers(guest_token))

    assert response.status_code == 200
    rows = response.json()
    assert [row["term_id"] for row in rows] == [term_id]
    assert rows[0]["child_count"] == 4


async def test_getMyAttendances_unauthenticated_returns401(client: AsyncClient) -> None:
    response = await client.get("/api/groups/mine/attendances")

    assert response.status_code == 401


async def test_getMyAttendances_organizerPartyWithoutProfile_returnsNullDisplayNameNot500(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """I3 regression: a circle whose active organizer party has no `UserProfile`
    must degrade `organizer_display_name` to `null` and still return 200 — not
    500 the whole response. `organizer_slug` still resolves (hash fallback).

    The no-profile organizer state isn't reachable through the API (registering
    always mints a profile), so the circle/leadership/term are built at the
    model layer on the shared `db_session`, per the conftest pattern."""
    from app.groups.models import Group, GroupRole, GroupRoleType, Leadership, Term
    from app.party.models import PartyType
    from app.party.service import create_party

    circle_party = await create_party(db_session, PartyType.ORGANIZATION)
    group = Group(party_id=cast(int, circle_party.id), name="Krąg bez profilu")
    db_session.add(group)
    await db_session.flush()

    # deliberately no UserProfile for this organizer party
    organizer_party = await create_party(db_session, PartyType.PERSON)
    role = GroupRole(
        party_id=cast(int, organizer_party.id),
        role_type=GroupRoleType.ORGANIZATOR,
        valid_from=date.today(),
        valid_to=None,
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(
        Leadership(
            from_role_id=cast(int, role.id),
            to_group_id=cast(int, group.id),
            valid_from=date.today(),
            valid_to=None,
        )
    )
    term = Term(
        circle_group_id=cast(int, group.id),
        occurs_on=date.today() + timedelta(days=7),
        description=None,
    )
    db_session.add(term)
    await db_session.flush()

    guest_token, _ = await _register_guest(client, "ma.noprofile.guest@example.com")
    await _rsvp(client, cast(int, group.id), cast(int, term.id), 2, guest_token)

    response = await client.get("/api/groups/mine/attendances", headers=_auth_headers(guest_token))

    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["term_id"] == term.id
    assert rows[0]["organizer_display_name"] is None
    assert rows[0]["organizer_slug"].startswith("k-")
