"""Closing a term's attendance list (`POST …/attendance/close` and the
`close_due_attendance` job): the frozen result, the monthly cap, organizers
left out, the level frozen after close — R6 of the points spec. Level,
presence and the read live in `test_term_attendance_points.py`."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta

from httpx import AsyncClient, Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.groups.application.attendance_points import close_due_attendance
from app.groups.models import Group, Term
from app.points.infrastructure.ledger import (
    PointLine,
    lock_accounts,
    post_points,
    system_account_id,
)
from app.points.models import (
    PointAccountType,
    PointsConfig,
    PointTransaction,
    PointTransactionType,
)
from tests.conftest import create_location
from tests.point_ledger_assertions import (
    assert_point_transactions_balanced,
    point_row_counts,
    transactions_for_party,
)

CLOSED_MESSAGE = "Obecność jest już zatwierdzona."
LEVEL_FROZEN_MESSAGE = "Obecność jest już zatwierdzona — nie można zmienić punktów za obecność."


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
    client: AsyncClient, token: str, occurs_on: datetime, level: int
) -> tuple[str, str]:
    circle = await client.post(
        "/api/groups/mine", json={"name": "Krąg zamknięcia"}, headers=_auth(token)
    )
    assert circle.status_code == 201
    term = await client.post(
        "/api/terms",
        json={
            "location_id": await create_location(client, _auth(token)),
            "group_id": circle.json()["id"],
            "occurs_on": occurs_on.isoformat(),
            "attendance_points": level,
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


async def _tick(
    client: AsyncClient, org_token: str, group_id: str, term_id: str, party: str
) -> None:
    r = await client.put(
        f"/api/groups/{group_id}/terms/{term_id}/attendees/{party}/presence",
        json={"present": True},
        headers=_auth(org_token),
    )
    assert r.status_code == 204, r.text


async def _close(client: AsyncClient, org_token: str, group_id: str, term_id: str) -> Response:
    return await client.post(
        f"/api/groups/{group_id}/terms/{term_id}/attendance/close", headers=_auth(org_token)
    )


async def _config(db: AsyncSession, **values: object) -> None:
    await db.execute(update(PointsConfig).values(**values))
    await db.commit()


async def _attendance_points(db: AsyncSession, party_id: str) -> list[int]:
    return [
        sum(e.amount for e in t.entries if e.amount > 0)
        for t in await transactions_for_party(db, uuid.UUID(party_id))
        if t.transaction_type == PointTransactionType.ATTENDANCE
    ]


async def _people(client: AsyncClient, prefix: str, n: int) -> list[tuple[str, str]]:
    return [await _register(client, f"{prefix}.{i}@example.com") for i in range(n)]


async def test_close_belowMinimum_closesUnrewardedWithoutPoints(
    client: AsyncClient, db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    await _config(db_session, attendance_min_present=3)
    org_token, _ = await _register(client, "close.min.org@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, 10)
    people = await _people(client, "close.min.guest", 2)
    for token, _party in people:
        await _rsvp(client, token, group_id, term_id)
    freeze_local_now(occurs_on + timedelta(hours=1))
    for _token, party in people:
        await _tick(client, org_token, group_id, term_id, party)
    before = await point_row_counts(db_session)

    r = await _close(client, org_token, group_id, term_id)

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["state"] == "CLOSED"
    assert body["rewarded"] is False
    assert body["present_count"] == 2
    assert body["min_present"] == 3
    assert body["closed_at"] is not None
    assert body["auto_close_on"] is None
    assert await point_row_counts(db_session) == before


async def test_close_monthlyCap_clipsCappedPersonAndPaysOthersInFull(
    client: AsyncClient, db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    await _config(
        db_session,
        attendance_levels=[0, 10, 20],
        attendance_min_present=2,
        attendance_monthly_cap=40,
    )
    org_token, _ = await _register(client, "close.cap.org@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, 20)
    people = await _people(client, "close.cap.guest", 3)
    for token, _party in people:
        await _rsvp(client, token, group_id, term_id)
    capped_party = uuid.UUID(people[0][1])
    close_on = occurs_on + timedelta(hours=1)
    accounts = await lock_accounts(db_session, [(capped_party, PointAccountType.PARTY)])
    await post_points(
        db_session,
        transaction_type=PointTransactionType.ATTENDANCE,
        source_id=uuid.uuid4(),
        party_id=capped_party,
        counterparty_party_id=None,
        cap_month=date(close_on.year, close_on.month, 1),
        description="Wcześniejszy termin",
        occurred_at=datetime.utcnow(),
        entries=[
            PointLine(await system_account_id(db_session, PointAccountType.EMISSION), -30),
            PointLine(accounts[(capped_party, PointAccountType.PARTY)], 30),
        ],
    )
    await db_session.commit()
    freeze_local_now(close_on)
    for _token, party in people:
        await _tick(client, org_token, group_id, term_id, party)

    r = await _close(client, org_token, group_id, term_id)

    assert r.status_code == 200, r.text
    assert r.json()["rewarded"] is True
    assert await _attendance_points(db_session, people[0][1]) == [30, 10]
    for _token, party in people[1:]:
        assert await _attendance_points(db_session, party) == [20]
    posted = (
        await db_session.execute(
            select(PointTransaction.cap_month, PointTransaction.description).where(
                PointTransaction.party_id == uuid.UUID(people[1][1])
            )
        )
    ).one()
    closed_on = clock.local_now()
    assert posted == (date(closed_on.year, closed_on.month, 1), "Krąg zamknięcia")
    await assert_point_transactions_balanced(db_session)


async def test_close_pastTermsOfTwoMonths_closedTogether_shareOneCloseMonthCap(
    client: AsyncClient, db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    await _config(
        db_session,
        attendance_levels=[0, 10, 20],
        attendance_min_present=1,
        attendance_monthly_cap=30,
    )
    org_token, _ = await _register(client, "close.months.org@example.com")
    guest_token, guest_party = await _register(client, "close.months.guest@example.com")
    first_on = _occurs_on()
    second_on = first_on + timedelta(days=40)
    terms = []
    for occurs_on in (first_on, second_on):
        group_id, term_id = await _circle_and_term(client, org_token, occurs_on, 20)
        await _rsvp(client, guest_token, group_id, term_id)
        terms.append((group_id, term_id))
    close_on = second_on + timedelta(hours=1)
    freeze_local_now(close_on)

    for group_id, term_id in terms:
        await _tick(client, org_token, group_id, term_id, guest_party)
        assert (await _close(client, org_token, group_id, term_id)).status_code == 200

    assert await _attendance_points(db_session, guest_party) == [20, 10]
    cap_months = (
        await db_session.scalars(
            select(PointTransaction.cap_month)
            .where(PointTransaction.party_id == uuid.UUID(guest_party))
            .distinct()
        )
    ).all()
    assert cap_months == [date(close_on.year, close_on.month, 1)]


async def test_close_tickedOrganizer_getsNothingAndIsNotCounted(
    client: AsyncClient, db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    await _config(db_session, attendance_min_present=2)
    org_token, org_party = await _register(client, "close.org.org@example.com")
    guest_token, guest_party = await _register(client, "close.org.guest@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, 10)
    await _rsvp(client, org_token, group_id, term_id)
    await _rsvp(client, guest_token, group_id, term_id)
    freeze_local_now(occurs_on + timedelta(hours=1))
    await _tick(client, org_token, group_id, term_id, org_party)
    await _tick(client, org_token, group_id, term_id, guest_party)

    r = await _close(client, org_token, group_id, term_id)

    assert r.status_code == 200, r.text
    assert r.json()["present_count"] == 1
    assert r.json()["rewarded"] is False
    assert await _attendance_points(db_session, org_party) == []
    attendees = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendees", headers=_auth(org_token)
    )
    assert {(a["party_id"], a["is_organizer"]) for a in attendees.json()} == {
        (org_party, True),
        (guest_party, False),
    }
    assert await _attendance_points(db_session, guest_party) == []


async def test_closeDueAttendance_groupSoftDeletedAfterStart_paysGuestNotOrganizer(
    client: AsyncClient, db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    await _config(db_session, attendance_min_present=1, attendance_auto_close_days=7)
    org_token, org_party = await _register(client, "close.deleted.org@example.com")
    guest_token, guest_party = await _register(client, "close.deleted.guest@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, 10)
    await _rsvp(client, org_token, group_id, term_id)
    await _rsvp(client, guest_token, group_id, term_id)
    freeze_local_now(occurs_on + timedelta(hours=1))
    await _tick(client, org_token, group_id, term_id, org_party)
    await _tick(client, org_token, group_id, term_id, guest_party)
    await db_session.execute(
        update(Group).where(Group.id == uuid.UUID(group_id)).values(deleted_at=datetime.utcnow())
    )
    await db_session.commit()

    freeze_local_now(occurs_on + timedelta(days=7, minutes=1))
    await close_due_attendance(db_session)

    term = await db_session.get(Term, uuid.UUID(term_id), populate_existing=True)
    assert term is not None
    assert term.attendance_present_count == 1
    assert term.attendance_rewarded is True
    assert await _attendance_points(db_session, guest_party) == [10]
    assert await _attendance_points(db_session, org_party) == []


async def test_closed_presenceAndSecondClose_return409(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    org_token, _ = await _register(client, "close.twice.org@example.com")
    guest_token, guest_party = await _register(client, "close.twice.guest@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, 10)
    await _rsvp(client, guest_token, group_id, term_id)
    freeze_local_now(occurs_on + timedelta(hours=1))
    assert (await _close(client, org_token, group_id, term_id)).status_code == 200

    presence = await client.put(
        f"/api/groups/{group_id}/terms/{term_id}/attendees/{guest_party}/presence",
        json={"present": True},
        headers=_auth(org_token),
    )
    second = await _close(client, org_token, group_id, term_id)

    assert presence.status_code == 409
    assert presence.json()["message"] == CLOSED_MESSAGE
    assert second.status_code == 409
    assert second.json()["message"] == CLOSED_MESSAGE


async def test_updateTerm_afterClose_sameLevelNoOpDifferentLevel409(
    client: AsyncClient, freeze_local_now: Callable[[datetime], None]
) -> None:
    org_token, _ = await _register(client, "close.level.org@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, 10)
    freeze_local_now(occurs_on + timedelta(hours=1))
    assert (await _close(client, org_token, group_id, term_id)).status_code == 200

    same = await client.patch(
        f"/api/terms/{term_id}", json={"attendance_points": 10}, headers=_auth(org_token)
    )
    different = await client.patch(
        f"/api/terms/{term_id}", json={"attendance_points": 20}, headers=_auth(org_token)
    )

    assert same.status_code == 200, same.text
    assert different.status_code == 409
    assert different.json()["message"] == LEVEL_FROZEN_MESSAGE


async def test_withdrawAfterClose_leavesFrozenResultAndListUnchanged(
    client: AsyncClient, db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    await _config(db_session, attendance_min_present=1)
    org_token, _ = await _register(client, "close.frozen.org@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, 10)
    people = await _people(client, "close.frozen.guest", 2)
    attendance_ids = [await _rsvp(client, token, group_id, term_id) for token, _ in people]
    freeze_local_now(occurs_on + timedelta(hours=1))
    await _tick(client, org_token, group_id, term_id, people[0][1])
    closed = (await _close(client, org_token, group_id, term_id)).json()

    for (token, _party), attendance_id in zip(people, attendance_ids, strict=True):
        withdraw = await client.post(
            f"/api/groups/mine/attendances/{attendance_id}/withdraw", headers=_auth(token)
        )
        assert withdraw.status_code == 200

    after = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendance", headers=_auth(org_token)
    )
    attendees = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendees", headers=_auth(org_token)
    )
    assert after.json()["present_count"] == closed["present_count"] == 1
    assert after.json()["attendee_count"] == len(attendees.json()) == 2
    assert after.json()["rewarded"] is closed["rewarded"] is True
    assert {(a["party_id"], a["present"]) for a in attendees.json()} == {
        (people[0][1], True),
        (people[1][1], False),
    }


async def test_closeDueAttendance_pastAutoCloseDelay_closesOnceIdempotently(
    client: AsyncClient, db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    await _config(db_session, attendance_min_present=1, attendance_auto_close_days=7)
    org_token, _ = await _register(client, "close.job.org@example.com")
    guest_token, guest_party = await _register(client, "close.job.guest@example.com")
    occurs_on = _occurs_on()
    group_id, term_id = await _circle_and_term(client, org_token, occurs_on, 10)
    await _rsvp(client, guest_token, group_id, term_id)
    freeze_local_now(occurs_on + timedelta(hours=1))
    await _tick(client, org_token, group_id, term_id, guest_party)

    freeze_local_now(occurs_on + timedelta(days=7, minutes=1))
    await close_due_attendance(db_session)
    await close_due_attendance(db_session)

    read = await client.get(
        f"/api/groups/{group_id}/terms/{term_id}/attendance", headers=_auth(org_token)
    )
    assert read.json()["state"] == "CLOSED"
    assert read.json()["rewarded"] is True
    assert await _attendance_points(db_session, guest_party) == [10]
    attendance_transactions = await db_session.scalar(
        select(func.count())
        .select_from(PointTransaction)
        .where(PointTransaction.transaction_type == PointTransactionType.ATTENDANCE)
    )
    assert attendance_transactions == 1
