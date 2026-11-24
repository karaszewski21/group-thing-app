"""The organizer's payment toggle
(`PUT /api/groups/{g}/terms/{t}/attendees/{party_id}/payment`), the listed-row
predicate it shares with the attendee list (withdrawn PAID rows, the
`withdrawn`/`counted` flags) and the viewer-only payment status on `/access`
and `/mine/attendances`."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta

import pytest
from httpx import AsyncClient

from app.core import clock
from tests.conftest import create_location


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
        "/api/groups/mine", json={"name": "Krąg płatny"}, headers=_auth(token)
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
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _withdraw(client: AsyncClient, token: str, attendance_id: str) -> None:
    r = await client.post(
        f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(token)
    )
    assert r.status_code == 200, r.text


async def _pay(
    client: AsyncClient, token: str, group_id: str, term_id: str, party_id: str, body: object
) -> int:
    r = await client.put(
        f"/api/groups/{group_id}/terms/{term_id}/attendees/{party_id}/payment",
        json=body,
        headers=_auth(token),
    )
    return r.status_code


async def _attendees(
    client: AsyncClient, token: str, group_id: str, term_id: str
) -> list[dict[str, object]]:
    r = await client.get(f"/api/groups/{group_id}/terms/{term_id}/attendees", headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()


async def _attendance(
    client: AsyncClient, token: str, group_id: str, term_id: str
) -> dict[str, object]:
    r = await client.get(f"/api/groups/{group_id}/terms/{term_id}/attendance", headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()


async def _tick(
    client: AsyncClient, org_token: str, group_id: str, term_id: str, party_id: str
) -> None:
    r = await client.put(
        f"/api/groups/{group_id}/terms/{term_id}/attendees/{party_id}/presence",
        json={"present": True},
        headers=_auth(org_token),
    )
    assert r.status_code == 204, r.text


async def _close(client: AsyncClient, org_token: str, group_id: str, term_id: str) -> dict:
    r = await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/attendance/close", headers=_auth(org_token)
    )
    assert r.status_code == 200, r.text
    return r.json()


def _rows(attendees: list[dict[str, object]]) -> list[tuple[object, ...]]:
    return [(a["party_id"], a["payment_status"], a["withdrawn"], a["counted"]) for a in attendees]


async def test_setPayment_markRepeatAndUnmarkBeforeStart_isIdempotentAndListFollows(
    client: AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    org_token, _ = await _register(client, "pay.mark.org@example.com")
    guest_token, guest = await _register(client, "pay.mark.guest@example.com")
    group_id, term_id = await _circle_and_term(client, org_token, _occurs_on(), price="25.50")
    await _rsvp(client, guest_token, group_id, term_id)
    assert (await _attendance(client, org_token, group_id, term_id))["state"] == "NOT_STARTED"

    caplog.set_level("INFO", logger="app.groups.application.attendance_points")
    for _ in range(2):
        assert await _pay(client, org_token, group_id, term_id, guest, {"paid": True}) == 204
    assert _rows(await _attendees(client, org_token, group_id, term_id)) == [
        (guest, "PAID", False, True)
    ]

    for _ in range(2):
        assert await _pay(client, org_token, group_id, term_id, guest, {"paid": False}) == 204
    assert _rows(await _attendees(client, org_token, group_id, term_id)) == [
        (guest, "UNPAID", False, True)
    ]
    # One line per actual change (the repeats log nothing), ids only.
    toggles = [r.getMessage() for r in caplog.records if "payment status set" in r.getMessage()]
    assert [m.split("status=")[1].split()[0] for m in toggles] == ["PAID", "UNPAID"]
    assert all(f"party_id={guest}" in m and "https" not in m for m in toggles)


async def test_setPayment_nonOrganizerForeignTermNoRsvpOrBadBody_returns403Then404And400(
    client: AsyncClient,
) -> None:
    org_token, _ = await _register(client, "pay.deny.org@example.com")
    guest_token, guest = await _register(client, "pay.deny.guest@example.com")
    _, stranger = await _register(client, "pay.deny.stranger@example.com")
    other_token, _ = await _register(client, "pay.deny.other@example.com")
    group_id, term_id = await _circle_and_term(client, org_token, _occurs_on())
    _, foreign_term_id = await _circle_and_term(client, other_token, _occurs_on())
    await _rsvp(client, guest_token, group_id, term_id)
    paid = {"paid": True}

    assert await _pay(client, guest_token, group_id, foreign_term_id, guest, paid) == 403
    assert await _pay(client, org_token, group_id, foreign_term_id, guest, paid) == 404
    assert await _pay(client, org_token, group_id, term_id, stranger, paid) == 404
    assert await _pay(client, org_token, group_id, term_id, guest, {}) == 400
    assert await _pay(client, org_token, group_id, term_id, guest, {"paid": "maybe"}) == 400


async def test_setPayment_afterClose_isAccepted(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    org_token, _ = await _register(client, "pay.closed.org@example.com")
    guest_token, guest = await _register(client, "pay.closed.guest@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, price="10")
    await _rsvp(client, guest_token, group_id, term_id)
    freeze_local_now(occurs_on + timedelta(hours=1))
    await _close(client, org_token, group_id, term_id)

    assert await _pay(client, org_token, group_id, term_id, guest, {"paid": True}) == 204
    assert await _pay(client, org_token, group_id, term_id, guest, {"paid": False}) == 204
    assert _rows(await _attendees(client, org_token, group_id, term_id)) == [
        (guest, "UNPAID", False, True)
    ]


async def test_setPayment_paidRowWithdrawnWhileOpen_listedNotCountedUntilUnmarked(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    org_token, _ = await _register(client, "pay.refund.org@example.com")
    payer_token, payer = await _register(client, "pay.refund.payer@example.com")
    stayer_token, stayer = await _register(client, "pay.refund.stayer@example.com")
    unpaid_token, unpaid = await _register(client, "pay.refund.unpaid@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, price="25.50")
    payer_attendance = await _rsvp(client, payer_token, group_id, term_id)
    await _rsvp(client, stayer_token, group_id, term_id)
    unpaid_attendance = await _rsvp(client, unpaid_token, group_id, term_id)
    assert await _pay(client, org_token, group_id, term_id, payer, {"paid": True}) == 204
    await _withdraw(client, payer_token, payer_attendance)
    await _withdraw(client, unpaid_token, unpaid_attendance)

    expected = [(stayer, "UNPAID", False, True), (payer, "PAID", True, False)]
    assert _rows(await _attendees(client, org_token, group_id, term_id)) == expected
    assert (await _attendance(client, org_token, group_id, term_id))["attendee_count"] == 1
    assert await _pay(client, org_token, group_id, term_id, unpaid, {"paid": True}) == 404

    freeze_local_now(occurs_on + timedelta(hours=1))
    await _tick(client, org_token, group_id, term_id, stayer)
    closed = await _close(client, org_token, group_id, term_id)
    assert closed["attendee_count"] == 1
    assert _rows(await _attendees(client, org_token, group_id, term_id)) == expected

    assert await _pay(client, org_token, group_id, term_id, payer, {"paid": False}) == 204
    assert _rows(await _attendees(client, org_token, group_id, term_id)) == [expected[0]]
    assert await _pay(client, org_token, group_id, term_id, payer, {"paid": True}) == 404


async def test_setPayment_paidRowWithdrawnAfterClose_listedCountedAndAccepted(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    org_token, _ = await _register(client, "pay.late.org@example.com")
    guest_token, guest = await _register(client, "pay.late.guest@example.com")
    other_token, other = await _register(client, "pay.late.other@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, price="25.50")
    guest_attendance = await _rsvp(client, guest_token, group_id, term_id)
    await _rsvp(client, other_token, group_id, term_id)
    assert await _pay(client, org_token, group_id, term_id, guest, {"paid": True}) == 204
    freeze_local_now(occurs_on + timedelta(hours=1))
    await _tick(client, org_token, group_id, term_id, guest)
    closed = await _close(client, org_token, group_id, term_id)
    await _withdraw(client, guest_token, guest_attendance)

    after = await _attendance(client, org_token, group_id, term_id)
    assert (
        (after["attendee_count"], after["present_count"])
        == (
            closed["attendee_count"],
            closed["present_count"],
        )
        == (2, 1)
    )
    assert _rows(await _attendees(client, org_token, group_id, term_id)) == [
        (guest, "PAID", True, True),
        (other, "UNPAID", False, True),
    ]
    assert await _pay(client, org_token, group_id, term_id, guest, {"paid": False}) == 204
    assert _rows(await _attendees(client, org_token, group_id, term_id))[0] == (
        guest,
        "UNPAID",
        True,
        True,
    )


async def test_paymentStatus_exposedOnlyToTheViewer(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "pay.view.org@example.com")
    guest_token, guest = await _register(client, "pay.view.guest@example.com")
    other_token, _ = await _register(client, "pay.view.other@example.com")
    group_id, term_id = await _circle_and_term(
        client, org_token, _occurs_on(), price="25.50", payment_url="https://pay.example.com/x"
    )
    await _rsvp(client, guest_token, group_id, term_id)
    assert await _pay(client, org_token, group_id, term_id, guest, {"paid": True}) == 204
    url = f"/api/public/groups/{group_id}/access?term_id={term_id}"

    own = (await client.get(url, headers=_auth(guest_token))).json()
    other = (await client.get(url, headers=_auth(other_token))).json()
    anonymous = (await client.get(url)).json()

    assert own["access"]["payment_status"] == "PAID"
    assert other["access"]["payment_status"] is None
    assert anonymous["access"]["payment_status"] is None
    for body in (own, other, anonymous):
        assert body["group"]["guardians"]
        assert all("payment_status" not in g for g in body["group"]["guardians"])
        assert "payment_status" not in body["group"]["term"]

    mine = await client.get("/api/groups/mine/attendances", headers=_auth(guest_token))
    assert mine.status_code == 200
    [row] = mine.json()
    assert (row["price"], row["payment_url"], row["payment_method"], row["payment_status"]) == (
        "25.50",
        "https://pay.example.com/x",
        "EXTERNAL_LINK",
        "PAID",
    )


async def test_paymentStatus_withdrawnPaidViewer_getsNoStatus(client: AsyncClient) -> None:
    org_token, _ = await _register(client, "pay.gone.org@example.com")
    guest_token, guest = await _register(client, "pay.gone.guest@example.com")
    group_id, term_id = await _circle_and_term(client, org_token, _occurs_on(), price="25.50")
    attendance_id = await _rsvp(client, guest_token, group_id, term_id)
    assert await _pay(client, org_token, group_id, term_id, guest, {"paid": True}) == 204
    await _withdraw(client, guest_token, attendance_id)

    access = await client.get(
        f"/api/public/groups/{group_id}/access?term_id={term_id}", headers=_auth(guest_token)
    )
    assert access.status_code == 200, access.text
    assert access.json()["access"]["payment_status"] is None
    mine = await client.get("/api/groups/mine/attendances", headers=_auth(guest_token))
    assert mine.status_code == 200, mine.text
    assert mine.json() == []
