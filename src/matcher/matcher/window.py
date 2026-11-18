"""The window loop (FR-MT-05), ported from the backend's scan: every
`WINDOW_INTERVAL` one run under a session advisory lock (a run held by
another copy is skipped), in two transactions with the statement limits:

1. the sweep, committed on its own so that a slow or failing match cannot
   roll it back: expire, remind and purge, and the outbox row of the
   reminded wants. Expire and remind set `updated_at`, the version column,
   so a seeker's write that loaded the want before the run gets a conflict
   instead of overwriting it. The reminder ignores the want's notification
   switch;
2. the match of the listings whose `changed_at` (the view's latest write
   that can make a listing matchable: listed, edited, available again, a
   swap proposal rejected) lies in `(start, end]`. On the first run
   `start` is now − `FIRST_WINDOW_LOOKBACK`. After that it is the marker,
   moved back by the overlap only as far as the previous run's clock
   (the marker's `updated_at`) − `WINDOW_OVERLAP`, and at most by
   `WINDOW_OVERLAP`: a listing's `changed_at` can predate its commit by up
   to the overlap, so only a listing created within the overlap before the
   previous run's snapshot can have been missed by it. After a capped run
   whose `end` lies further back, the next run starts at the marker itself
   and re-reads nothing. `end` is now, or, when more than
   `WINDOW_MAX_LISTINGS` listings wait after the marker, the `changed_at`
   of the last of the first `WINDOW_MAX_LISTINGS` (a capped run: the loop
   starts the next one at once, so a backlog drains over several runs). It
   stages the bells of the MATCH pairs (SUGGESTION and SIMILAR pairs ring
   none) and moves the marker by
   compare-and-set: `scanned_through` to `end`, `updated_at` to now (also
   the liveness signal); a miss is a lost race and rolls the match back."""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

import asyncpg

from matcher import clock, db, outbox, rules, statements

logger = logging.getLogger("matcher")

SCAN_NAME = "wants"
# Any constant shared by every copy; the bytes of "wants".
LOCK_KEY = 0x77616E7473

EXPIRE = """
UPDATE wants SET status = 'EXPIRED', closed_at = expires_at, updated_at = $1
WHERE status = 'ACTIVE' AND expires_at <= $1
"""
REMIND = """
UPDATE wants SET reminded_at = $1, updated_at = $1
WHERE status = 'ACTIVE' AND expires_at <= $2 AND reminded_at IS NULL
RETURNING id
"""
# The matches go with the want (ON DELETE CASCADE); its bell rows stay.
PURGE = "DELETE FROM wants WHERE status <> 'ACTIVE' AND closed_at <= $1"

MARKER_READ = """
SELECT scanned_through, updated_at FROM want_scan_markers WHERE scan_name = $1
"""
# $1 the run's now, $2 the scan name, $3 the window end.
MARKER_INSERT = """
INSERT INTO want_scan_markers (id, created_at, updated_at, scan_name, scanned_through)
VALUES (gen_random_uuid(), $1, $1, $2, $3)
ON CONFLICT (scan_name) DO NOTHING
"""
MARKER_MOVE = """
UPDATE want_scan_markers SET scanned_through = $3, updated_at = $1
WHERE scan_name = $2 AND scanned_through = $4
"""
# The `changed_at` of the first `$3` matchable listings in `($1, $2]`.
WAITING_LISTINGS = """
SELECT changed_at FROM matchable_listings
WHERE changed_at > $1 AND changed_at <= $2
ORDER BY changed_at
LIMIT $3
"""


@dataclass(frozen=True)
class WindowRun:
    start: datetime
    end: datetime
    capped: bool
    matches: int
    suggestions: int
    similar: int
    outbox_rows: int
    expired: int
    reminded: list[uuid.UUID]
    purged: int


@dataclass(frozen=True)
class _Sweep:
    expired: int
    reminded: list[uuid.UUID]
    purged: int
    outbox_rows: int


@dataclass(frozen=True)
class _Match:
    start: datetime
    end: datetime
    capped: bool
    matches: int
    suggestions: int
    similar: int
    outbox_rows: int


def _row_count(status: str) -> int:
    """The row count of an asyncpg command tag (`UPDATE 1`, `INSERT 0 1`)."""
    return int(status.rsplit(" ", 1)[-1])


async def _move_marker(
    connection: asyncpg.Connection, marker: datetime | None, end: datetime, now: datetime
) -> None:
    if marker is None:
        moved = await connection.execute(MARKER_INSERT, now, SCAN_NAME, end)
    else:
        moved = await connection.execute(MARKER_MOVE, now, SCAN_NAME, end, marker)
    if _row_count(moved) != 1:
        raise db.LostRace("the window marker was moved by another run")


async def _sweep(connection: asyncpg.Connection, now: datetime) -> _Sweep:
    async with connection.transaction():
        await db.limit_transaction(connection)
        expired = _row_count(await connection.execute(EXPIRE, now))
        reminded = [
            row["id"] for row in await connection.fetch(REMIND, now, now + rules.REMINDER_LEAD)
        ]
        purged = _row_count(await connection.execute(PURGE, now - rules.RETENTION))
        outbox_rows = await outbox.stage_bells_due(connection, pairs=[], expiring=reminded)
    return _Sweep(expired, reminded, purged, outbox_rows)


async def _window_end(
    connection: asyncpg.Connection, after: datetime, now: datetime
) -> tuple[datetime, bool]:
    """`(now, False)`, or `(the `changed_at` of the last of the first
    WINDOW_MAX_LISTINGS listings after `after`, True)` when more wait."""
    cap = rules.WINDOW_MAX_LISTINGS
    waiting = await connection.fetch(WAITING_LISTINGS, after, now, cap + 1)
    if len(waiting) <= cap:
        return now, False
    end: datetime = waiting[cap - 1]["changed_at"]
    return end, True


def window_start(marker: datetime, previous_run_at: datetime) -> datetime:
    """The marker, moved back to the previous run's clock − the overlap, but
    never by more than the overlap: listings created before that clock −
    the overlap had committed when the previous run read."""
    return max(marker - rules.WINDOW_OVERLAP, min(marker, previous_run_at - rules.WINDOW_OVERLAP))


async def _match(connection: asyncpg.Connection, now: datetime) -> _Match:
    async with connection.transaction():
        await db.limit_transaction(connection)
        row = await connection.fetchrow(MARKER_READ, SCAN_NAME)
        marker: datetime | None
        if row is None:
            marker = None
            start = counted_after = now - rules.FIRST_WINDOW_LOOKBACK
        else:
            marker = row["scanned_through"]
            start, counted_after = window_start(marker, row["updated_at"]), marker
        end, capped = await _window_end(connection, counted_after, now)
        pairs = await statements.match_window(
            connection, listed_after=start, listed_until=end, now=now
        )
        matches = [(pair.want_id, pair.item_id) for pair in pairs if pair.tier == "MATCH"]
        outbox_rows = await outbox.stage_bells_due(connection, pairs=matches, expiring=[])
        await _move_marker(connection, marker, end, now)
    tiers = [pair.tier for pair in pairs]
    return _Match(
        start,
        end,
        capped,
        len(matches),
        tiers.count("SUGGESTION"),
        tiers.count("SIMILAR"),
        outbox_rows,
    )


async def _unlock(connection: asyncpg.Connection) -> None:
    """Never raises, so the run's own error is the one that propagates; a
    lock left behind goes with the connection (pool reset or disconnect)."""
    if connection.is_closed():
        return
    try:
        await connection.execute("SELECT pg_advisory_unlock($1)", LOCK_KEY)
    except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError) as exc:
        logger.debug("window lock not released explicitly: %s", exc)


async def run_window(pool: asyncpg.Pool, *, now: datetime) -> WindowRun | None:
    """One run with `now` (naive UTC) as its only clock; `None` when another
    copy holds the lock. When the match fails (`db.LostRace` when the marker
    moved under it) the sweep stays committed, nothing of the match is
    stored, and the error is raised."""
    async with db.acquire(pool) as connection:
        if not await connection.fetchval("SELECT pg_try_advisory_lock($1)", LOCK_KEY):
            logger.debug("window run skipped: another run holds the lock")
            return None
        try:
            sweep = await _sweep(connection, now)
            match = await _match(connection, now)
        finally:
            await _unlock(connection)

    return WindowRun(
        start=match.start,
        end=match.end,
        capped=match.capped,
        matches=match.matches,
        suggestions=match.suggestions,
        similar=match.similar,
        outbox_rows=sweep.outbox_rows + match.outbox_rows,
        expired=sweep.expired,
        reminded=sweep.reminded,
        purged=sweep.purged,
    )


async def run_logged(pool: asyncpg.Pool) -> bool:
    """One run with its log line (INFO when it did work or was capped, else
    DEBUG) and the failure policy; never raises. True when the run was
    capped, so the next one is due at once."""
    started = time.monotonic()
    now = clock.utcnow()
    try:
        run = await run_window(pool, now=now)
    except Exception as exc:
        db.log_failure(logger, exc, "window run")
        return False
    if run is None:
        return False
    did_work = bool(
        run.capped
        or run.matches
        or run.suggestions
        or run.similar
        or run.expired
        or run.reminded
        or run.purged
    )
    logger.log(
        logging.INFO if did_work else logging.DEBUG,
        "window run: start=%s end=%s capped=%s matches=%d suggestions=%d similar=%d "
        "outbox_rows=%d expired=%d reminded=%d purged=%d duration_ms=%d",
        run.start.isoformat(),
        run.end.isoformat(),
        run.capped,
        run.matches,
        run.suggestions,
        run.similar,
        run.outbox_rows,
        run.expired,
        len(run.reminded),
        run.purged,
        round((time.monotonic() - started) * 1000),
    )
    return run.capped


async def window_loop(pool: asyncpg.Pool, *, interval: timedelta = rules.WINDOW_INTERVAL) -> None:
    while True:
        if not await run_logged(pool):
            await asyncio.sleep(interval.total_seconds())
