"""The sweep of the window run, ported from the backend's lifecycle tests:
expiry at the want's end, the reminder once per validity period (also when
muted), and the purge of wants closed for `RETENTION`. Expire and remind
bump `updated_at`; reminded wants go into the outbox's `expiring`."""

import uuid
from datetime import datetime, timedelta

import asyncpg

from matcher import clock, rules, window
from tests import conftest


async def _states(
    db: asyncpg.Pool, seeker: uuid.UUID
) -> dict[uuid.UUID, tuple[str, datetime | None, datetime]]:
    rows = await db.fetch(
        "SELECT id, status, closed_at, updated_at FROM wants WHERE seeker_party_id = $1", seeker
    )
    return {row["id"]: (row["status"], row["closed_at"], row["updated_at"]) for row in rows}


async def test_runWindow_wantAtOrPastItsEnd_expiredWithClosedAtAtItsEnd(
    db: asyncpg.Pool,
) -> None:
    seeker = (await conftest.person(db)).party_id
    now = clock.utcnow()
    past = await conftest.want(db, seeker, "Narty", expires_at=now - timedelta(days=2))
    at_the_end = await conftest.want(db, seeker, "Sanki", expires_at=now)
    running = await conftest.want(db, seeker, "Rower", expires_at=now + timedelta(seconds=1))

    run = await window.run_window(db, now=now)

    assert await _states(db, seeker) == {
        past: ("EXPIRED", now - timedelta(days=2), now),
        at_the_end: ("EXPIRED", now, now),
        running: ("ACTIVE", None, now),
    }
    assert run is not None and (run.expired, run.reminded) == (2, [running])
    assert await conftest.bells_due(db) == [{"pairs": [], "expiring": [str(running)]}]


async def test_runWindow_wantInItsLastWeek_remindedOncePerPeriodAlsoWhenMuted_againAfterExtend(
    db: asyncpg.Pool,
) -> None:
    seeker = (await conftest.person(db)).party_id
    now = clock.utcnow()
    enabled = await conftest.want(db, seeker, "Rzecz 0", expires_at=now + rules.REMINDER_LEAD)
    muted = await conftest.want(
        db,
        seeker,
        "Rzecz 1",
        expires_at=now + timedelta(days=2),
        notifications_enabled=False,
    )
    early = await conftest.want(
        db, seeker, "Rzecz 2", expires_at=now + rules.REMINDER_LEAD + timedelta(hours=1)
    )

    await window.run_window(db, now=now)

    rows = await db.fetch(
        "SELECT id, reminded_at, updated_at FROM wants WHERE seeker_party_id = $1", seeker
    )
    assert {row["id"]: row["reminded_at"] for row in rows} == {
        enabled: now,
        muted: now,
        early: None,
    }
    assert {row["id"] for row in rows if row["updated_at"] == now} == {enabled, muted}
    (first,) = await conftest.bells_due(db)
    assert sorted(first["expiring"]) == sorted([str(enabled), str(muted)])

    await window.run_window(db, now=now + timedelta(minutes=15))
    assert len(await conftest.bells_due(db)) == 1

    # The seeker's extend: a new period, the reminder reset.
    await conftest.update_want(db, enabled, expires_at=now + timedelta(days=90), reminded_at=None)
    await window.run_window(db, now=now + timedelta(minutes=30))
    assert len(await conftest.bells_due(db)) == 1

    await conftest.update_want(db, enabled, expires_at=now + timedelta(days=5))
    await window.run_window(db, now=now + timedelta(minutes=45))

    assert (await conftest.bells_due(db))[1:] == [{"pairs": [], "expiring": [str(enabled)]}]


async def test_runWindow_closedForTheRetention_purgedWithItsMatches_activeKeptBellRowsStay(
    db: asyncpg.Pool,
) -> None:
    seeker = (await conftest.person(db)).party_id
    now = clock.utcnow()
    purged = await conftest.want(db, seeker, "Narty", status="FULFILLED")
    recent = await conftest.want(db, seeker, "Sanki", status="WITHDRAWN")
    await conftest.want(db, seeker, "Łyżwy", expires_at=now - rules.RETENTION - timedelta(days=1))
    active = await conftest.want(db, seeker, "Rower")
    await conftest.update_want(db, purged, closed_at=now - rules.RETENTION)
    await conftest.update_want(db, recent, closed_at=now - rules.RETENTION + timedelta(seconds=1))
    for want_id in (purged, recent):
        await db.execute(
            "INSERT INTO want_matches (id, created_at, updated_at, want_id, item_id, source,"
            " score, tier) VALUES (gen_random_uuid(), $1, $1, $2, $3, 'SCAN', 1.0, 'MATCH')",
            now,
            want_id,
            uuid.uuid4(),
        )
    await db.execute(
        "INSERT INTO notifications (id, created_at, updated_at, party_id, kind, message)"
        " VALUES (gen_random_uuid(), $1, $1, $2, 'WANT_MATCH_FOUND', 'Szukasz: «narty».')",
        now,
        seeker,
    )

    run = await window.run_window(db, now=now)

    assert set(await _states(db, seeker)) == {recent, active}
    assert {row["want_id"] for row in await db.fetch("SELECT want_id FROM want_matches")} == {
        recent
    }
    assert await db.fetchval("SELECT count(*) FROM notifications WHERE party_id = $1", seeker) == 1
    assert run is not None and (run.expired, run.purged) == (1, 2)
