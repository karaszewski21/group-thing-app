"""Re-RSVP after a withdrawal: the withdrawn `TermAttendance` row is
reactivated, and a withdrawn row no longer counts as attending nor shows
in the public guardians list.

Isolation via the `conftest.py` TestContainers + savepoint-rollback fixtures;
naming follows `action_condition_expectedResult`
(`standards/testing/backend-testing.md`).
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import date, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.points.models import PointsConfig
from tests.conftest import create_location


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client: AsyncClient, role: str, email: str) -> tuple[str, str]:
    r = await client.post(
        "/api/auth/register", json={"role": role, "email": email, "password": "secret123"}
    )
    assert r.status_code == 201
    return r.json()["token"], r.json()["party_id"]


async def _circle_and_term(client: AsyncClient, org_token: str, name: str) -> tuple[str, str]:
    circle = await client.post("/api/groups/mine", json={"name": name}, headers=_auth(org_token))
    assert circle.status_code == 201
    group_id = circle.json()["id"]
    term = await client.post(
        "/api/terms",
        json={
            "location_id": await create_location(client, _auth(org_token)),
            "group_id": group_id,
            "occurs_on": (date.today() + timedelta(days=7)).isoformat(),
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201
    return group_id, term.json()["id"]


async def _rsvp(client: AsyncClient, token: str, group_id: str, term_id: str) -> str:
    r = await client.post(
        f"/api/groups/{group_id}/rsvp",
        json={"term_id": term_id, "guardian_name": "ignored"},
        headers=_auth(token),
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _withdraw(client: AsyncClient, token: str, attendance_id: str) -> None:
    r = await client.post(
        f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(token)
    )
    assert r.status_code == 200, r.text


async def _access(client: AsyncClient, token: str, group_id: str, term_id: str) -> dict:
    r = await client.get(
        f"/api/public/groups/{group_id}/access?term_id={term_id}", headers=_auth(token)
    )
    assert r.status_code == 200, r.text
    return r.json()


async def test_rsvp_afterWithdraw_reactivatesAttendance(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "reactivate.org1@example.com")
    group_id, term_id = await _circle_and_term(client, org_token, "Reactivate Circle 1")
    guest_token, _ = await _register(client, "GUEST", "reactivate.guest1@example.com")
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    await _withdraw(client, guest_token, attendance_id)

    again_id = await _rsvp(client, guest_token, group_id, term_id)
    body = await _access(client, guest_token, group_id, term_id)

    assert again_id == attendance_id
    assert body["access"]["is_attending"] is True
    assert body["access"]["is_active_attendee"] is True


async def test_access_withdrawnAttendee_notAttendingAndNotListedPublicly(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "reactivate.org2@example.com")
    group_id, term_id = await _circle_and_term(client, org_token, "Reactivate Circle 2")
    guest_token, guest_party = await _register(client, "GUEST", "reactivate.guest2@example.com")
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    await _withdraw(client, guest_token, attendance_id)

    body = await _access(client, guest_token, group_id, term_id)

    assert body["access"]["is_attending"] is False
    assert body["access"]["is_active_attendee"] is False
    assert guest_party not in [g["party_id"] for g in body["group"]["guardians"]]


async def _started_term(client: AsyncClient, org_token: str) -> tuple[str, str, datetime]:
    occurs_on = (clock.local_now() + timedelta(days=7)).replace(second=0, microsecond=0)
    circle = await client.post(
        "/api/groups/mine", json={"name": "Reactivate Closed"}, headers=_auth(org_token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "location_id": await create_location(client, _auth(org_token)),
            "group_id": circle.json()["id"],
            "occurs_on": occurs_on.isoformat(),
            "attendance_points": 10,
        },
        headers=_auth(org_token),
    )
    assert term.status_code == 201, term.text
    return circle.json()["id"], term.json()["id"], occurs_on


async def _mark(
    client: AsyncClient, org_token: str, group_id: str, term_id: str, party_id: str, kind: str
) -> None:
    body = {"present": True} if kind == "presence" else {"paid": True}
    r = await client.put(
        f"/api/groups/{group_id}/terms/{term_id}/attendees/{party_id}/{kind}",
        json=body,
        headers=_auth(org_token),
    )
    assert r.status_code == 204, r.text


async def _guest_row(
    client: AsyncClient, org_token: str, group_id: str, term_id: str, party_id: str
) -> dict[str, object]:
    r = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendees", headers=_auth(org_token)
    )
    assert r.status_code == 200, r.text
    return next(a for a in r.json() if a["party_id"] == party_id)


async def _balance(client: AsyncClient, token: str) -> int:
    r = await client.get("/api/points/me", headers=_auth(token))
    assert r.status_code == 200, r.text
    return int(r.json()["balance"])


async def test_rsvp_afterWithdraw_clearsPresenceKeepsPaymentStatus(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    org_token, _ = await _register(client, "ORGANIZER", "reactivate.org3@example.com")
    guest_token, guest = await _register(client, "GUEST", "reactivate.guest3@example.com")
    group_id, term_id, occurs_on = await _started_term(client, org_token)
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    freeze_local_now(occurs_on + timedelta(hours=1))
    await _mark(client, org_token, group_id, term_id, guest, "presence")
    await _mark(client, org_token, group_id, term_id, guest, "payment")
    await _withdraw(client, guest_token, attendance_id)

    again_id = await _rsvp(client, guest_token, group_id, term_id)
    row = await _guest_row(client, org_token, group_id, term_id, guest)

    assert again_id == attendance_id
    assert (row["present"], row["payment_status"], row["withdrawn"]) == (False, "PAID", False)


async def test_rsvp_afterWithdrawOnClosedList_keepsPresenceAndPoints(
    client: AsyncClient, db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    await db_session.execute(
        update(PointsConfig).values(attendance_levels=[0, 10, 20], attendance_min_present=1)
    )
    await db_session.commit()
    org_token, _ = await _register(client, "ORGANIZER", "reactivate.org4@example.com")
    guest_token, guest = await _register(client, "GUEST", "reactivate.guest4@example.com")
    group_id, term_id, occurs_on = await _started_term(client, org_token)
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    freeze_local_now(occurs_on + timedelta(hours=1))
    await _mark(client, org_token, group_id, term_id, guest, "presence")
    await _mark(client, org_token, group_id, term_id, guest, "payment")
    close = await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/attendance/close", headers=_auth(org_token)
    )
    assert close.status_code == 200, close.text
    closed = close.json()
    assert closed["rewarded"] is True
    balance = await _balance(client, guest_token)
    await _withdraw(client, guest_token, attendance_id)

    again_id = await _rsvp(client, guest_token, group_id, term_id)
    row = await _guest_row(client, org_token, group_id, term_id, guest)
    attendance = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendance", headers=_auth(org_token)
    )

    assert again_id == attendance_id
    assert (row["present"], row["payment_status"], row["withdrawn"]) == (True, "PAID", False)
    after = attendance.json()
    assert (after["present_count"], after["attendee_count"]) == (
        closed["present_count"],
        closed["attendee_count"],
    )
    assert await _balance(client, guest_token) == balance > 0
