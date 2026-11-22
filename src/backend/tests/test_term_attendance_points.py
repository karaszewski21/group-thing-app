"""Term attendance level, presence and the organizer read
(`GET /api/groups/{g}/terms/{t}/attendance`,
`PUT /api/groups/{g}/terms/{t}/attendees/{party_id}/presence`) — R6 of the
points spec. The close lives in `test_term_attendance_close.py`."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.points.models import PointsConfig
from tests.conftest import create_location

LEVEL_MESSAGE = "Wybierz jeden z dozwolonych poziomów punktów."
NOT_STARTED_MESSAGE = "Obecność zaznaczysz od rozpoczęcia terminu."
ATTENDANCE_KEYS = {
    "state",
    "attendance_points",
    "allowed_levels",
    "attendee_count",
    "present_count",
    "min_present",
    "auto_close_on",
    "closed_at",
    "rewarded",
}


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, email: str) -> tuple[str, str]:
    r = await client.post(
        "/api/auth/register", json={"role": "GUEST", "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


def _occurs_on() -> datetime:
    return (clock.local_now() + timedelta(days=7)).replace(second=0, microsecond=0)


async def _circle_and_term(
    client: AsyncClient, token: str, occurs_on: datetime, **extra: object
) -> tuple[str, str]:
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg obecności"}, headers=_auth(token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "location_id": await create_location(client, _auth(token)),
            "group_id": circle.json()["id"],
            "occurs_on": occurs_on.isoformat(),
            **extra,
        },
        headers=_auth(token),
    )
    assert term.status_code == 201, term.text
    return circle.json()["id"], term.json()["id"]


async def _rsvp(client: AsyncClient, token: str, group_id: str, term_id: str) -> str:
    r = await client.post(
        f"/api/groups/{group_id}/rsvp",
        json={"term_id": term_id, "child_count": 0},
        headers=_auth(token),
    )
    assert r.status_code == 201
    return r.json()["id"]


async def _attendance(
    client: AsyncClient, token: str, group_id: str, term_id: str
) -> dict[str, object]:
    r = await client.get(f"/api/groups/{group_id}/terms/{term_id}/attendance", headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def _presence_url(group_id: str, term_id: str, party_id: str) -> str:
    return f"/api/groups/{group_id}/terms/{term_id}/attendees/{party_id}/presence"


async def test_termLevel_omittedInvalidOrAllowed_storesLowest400OrStored(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await db_session.execute(update(PointsConfig).values(attendance_levels=[5, 10, 20]))
    await db_session.commit()
    org_token, _ = await _register(client, "att.level.org@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on)

    assert (await _attendance(client, org_token, group_id, term_id))["attendance_points"] == 5
    term = await client.get(f"/api/terms/{term_id}", headers=_auth(org_token))
    assert not any(key.startswith("attendance") for key in term.json())

    invalid = await client.post(
        "/api/terms",
        json={
            "location_id": await create_location(client, _auth(org_token)),
            "group_id": group_id,
            "occurs_on": occurs_on.isoformat(),
            "attendance_points": 7,
        },
        headers=_auth(org_token),
    )
    assert invalid.status_code == 400
    assert invalid.json()["message"] == LEVEL_MESSAGE
    bad_update = await client.patch(
        f"/api/terms/{term_id}", json={"attendance_points": 15}, headers=_auth(org_token)
    )
    assert bad_update.status_code == 400
    assert bad_update.json()["message"] == LEVEL_MESSAGE

    updated = await client.patch(
        f"/api/terms/{term_id}", json={"attendance_points": 20}, headers=_auth(org_token)
    )
    assert updated.status_code == 200
    assert not any(key.startswith("attendance") for key in updated.json())
    assert (await _attendance(client, org_token, group_id, term_id))["attendance_points"] == 20


async def test_getAttendance_beforeAndAfterStart_returnsExactKeysAndState(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    org_token, _ = await _register(client, "att.read.org@example.com")
    guest_token, _ = await _register(client, "att.read.guest@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, attendance_points=10)
    await _rsvp(client, guest_token, group_id, term_id)

    before = await _attendance(client, org_token, group_id, term_id)
    assert set(before) == ATTENDANCE_KEYS
    assert before["state"] == "NOT_STARTED"
    assert before["attendance_points"] == 10
    assert before["allowed_levels"] == [0, 10, 20]
    assert before["attendee_count"] == 1
    assert before["present_count"] == 0
    assert before["min_present"] == 3
    assert before["auto_close_on"] == (occurs_on + timedelta(days=7)).isoformat()
    assert before["closed_at"] is None
    assert before["rewarded"] is None

    freeze_local_now(occurs_on + timedelta(minutes=1))
    after = await _attendance(client, org_token, group_id, term_id)
    assert set(after) == ATTENDANCE_KEYS
    assert after["state"] == "OPEN"


async def test_setPresence_beforeStart_returns409(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "att.early.org@example.com")
    guest_token, guest_party = await _register(client, "att.early.guest@example.com")
    group_id, term_id = await _circle_and_term(client, org_token, _occurs_on())
    await _rsvp(client, guest_token, group_id, term_id)

    r = await client.put(
        _presence_url(group_id, term_id, guest_party),
        json={"present": True},
        headers=_auth(org_token),
    )

    assert r.status_code == 409
    assert r.json()["message"] == NOT_STARTED_MESSAGE


async def test_setPresence_tickAndUntickTwice_isIdempotentAndCountFollows(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    org_token, _ = await _register(client, "att.tick.org@example.com")
    guest_token, guest_party = await _register(client, "att.tick.guest@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on)
    await _rsvp(client, guest_token, group_id, term_id)
    freeze_local_now(occurs_on + timedelta(hours=1))
    url = _presence_url(group_id, term_id, guest_party)

    for _ in range(2):
        tick = await client.put(url, json={"present": True}, headers=_auth(org_token))
        assert tick.status_code == 204
    assert (await _attendance(client, org_token, group_id, term_id))["present_count"] == 1
    attendees = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendees", headers=_auth(org_token)
    )
    assert [a["present"] for a in attendees.json()] == [True]

    for _ in range(2):
        untick = await client.put(url, json={"present": False}, headers=_auth(org_token))
        assert untick.status_code == 204
    assert (await _attendance(client, org_token, group_id, term_id))["present_count"] == 0


async def test_presenceAndRead_nonOrganizerBeforeStart_returns403Not409(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "att.deny.org@example.com")
    guest_token, guest_party = await _register(client, "att.deny.guest@example.com")
    group_id, term_id = await _circle_and_term(client, org_token, _occurs_on())
    await _rsvp(client, guest_token, group_id, term_id)

    presence = await client.put(
        _presence_url(group_id, term_id, guest_party),
        json={"present": True},
        headers=_auth(guest_token),
    )
    read = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendance", headers=_auth(guest_token)
    )

    assert presence.status_code == 403
    assert read.status_code == 403


async def test_setPresence_withdrawnOrNoRsvp_returns404(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    org_token, _ = await _register(client, "att.missing.org@example.com")
    guest_token, guest_party = await _register(client, "att.missing.guest@example.com")
    _, stranger_party = await _register(client, "att.missing.stranger@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on)
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    withdraw = await client.post(
        f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(guest_token)
    )
    assert withdraw.status_code == 200
    freeze_local_now(occurs_on + timedelta(hours=1))

    for party_id in (guest_party, stranger_party):
        r = await client.put(
            _presence_url(group_id, term_id, party_id),
            json={"present": True},
            headers=_auth(org_token),
        )
        assert r.status_code == 404
