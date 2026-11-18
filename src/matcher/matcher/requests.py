"""The request loop (FR-MT-04, R26): a seeker's write flags a want for a full
run (`match_requested_at`), a background re-trigger for a SIMILAR-only run
(`similar_requested_at`), and either trigger NOTIFYs `wants_changed`. The
loop LISTENs on a dedicated connection, polls every `REQUEST_POLL` as well,
and on each wake-up drains the flagged wants, one transaction per want:

- claim a flagged want `FOR NO KEY UPDATE SKIP LOCKED`, full requests first
  and the oldest flag first within each kind, so copies never share a want
  and window inserts (the FK's `KEY SHARE`) never wait (L7);
- for an ACTIVE want run what was asked for (pairs born seen, no outbox
  row): the full forward match, or only its SIMILAR tier, so a background
  re-trigger stores no lexical pair and the window still rings its bell;
- compare-and-clear the claimed flag(s) against the values claimed, so a
  newer request stays, without touching `updated_at`, so a seeker's loaded
  version stays valid. A full run includes SIMILAR, so it also clears a
  SIMILAR flag set at or before its claim.

A failing want is rolled back (both flags stay) and skipped by this
process's claims of either kind for a doubling backoff (H4), so it never
blocks the others."""

import asyncio
import contextlib
import logging
import uuid
from datetime import datetime, timedelta

import asyncpg

from matcher import clock, db, rules, statements
from matcher.settings import Settings

logger = logging.getLogger("matcher")

CHANNEL = "wants_changed"

CLAIM = """
SELECT id, status, match_requested_at, similar_requested_at
FROM wants
WHERE (match_requested_at IS NOT NULL OR similar_requested_at IS NOT NULL)
  AND id <> ALL($1::uuid[])
ORDER BY match_requested_at IS NULL, least(match_requested_at, similar_requested_at), id
LIMIT 1
FOR NO KEY UPDATE SKIP LOCKED
"""

# `$3` NULL: the comparison is NULL and the SIMILAR flag keeps its value.
CLEAR = """
UPDATE wants
SET match_requested_at = CASE WHEN match_requested_at = $2 THEN NULL ELSE match_requested_at END,
    similar_requested_at = CASE WHEN similar_requested_at <= $3::timestamp
                           THEN NULL ELSE similar_requested_at END
WHERE id = $1
"""

CLEAR_SIMILAR = (
    "UPDATE wants SET similar_requested_at = NULL WHERE id = $1 AND similar_requested_at = $2"
)


class Backoff:
    """This process's failing wants: `retry_after = now + BACKOFF_START ×
    2^(failures−1)`, capped at `BACKOFF_MAX`, forgotten on success."""

    def __init__(self) -> None:
        self._failures: dict[uuid.UUID, int] = {}
        self._retry_after: dict[uuid.UUID, datetime] = {}

    def waiting(self, now: datetime) -> list[uuid.UUID]:
        return [want_id for want_id, after in self._retry_after.items() if after > now]

    def failed(self, want_id: uuid.UUID, now: datetime) -> tuple[int, datetime]:
        failures = self._failures.get(want_id, 0) + 1
        delay = min(rules.BACKOFF_START * 2 ** (failures - 1), rules.BACKOFF_MAX)
        self._failures[want_id] = failures
        self._retry_after[want_id] = now + delay
        return failures, now + delay

    def succeeded(self, want_id: uuid.UUID) -> None:
        self._failures.pop(want_id, None)
        self._retry_after.pop(want_id, None)


async def _process(connection: asyncpg.Connection, claimed: asyncpg.Record, now: datetime) -> None:
    """Runs and clears the claimed request in the claim's transaction."""
    want_id = claimed["id"]
    full = claimed["match_requested_at"] is not None
    if claimed["status"] == "ACTIVE":
        await db.limit_transaction(connection)
        if full:
            await statements.match_forward(connection, want_id, now=now)
        else:
            await statements.match_similar_forward(connection, want_id, now=now)
    if full:
        await connection.execute(
            CLEAR, want_id, claimed["match_requested_at"], claimed["similar_requested_at"]
        )
    else:
        await connection.execute(CLEAR_SIMILAR, want_id, claimed["similar_requested_at"])


async def process_next(pool: asyncpg.Pool, backoff: Backoff, *, now: datetime) -> bool:
    """Claims and processes one flagged want; `False` when none is claimable.
    A failure after the claim is logged and backs the want off; one before it
    (the claim itself) propagates."""
    async with db.acquire(pool) as connection:
        claimed: asyncpg.Record | None = None
        try:
            async with connection.transaction():
                claimed = await connection.fetchrow(CLAIM, backoff.waiting(now))
                if claimed is None:
                    return False
                await _process(connection, claimed, now)
        except Exception as exc:
            if claimed is None:
                raise
            failures, retry_after = backoff.failed(claimed["id"], now)
            kind = "" if claimed["match_requested_at"] is not None else "similar only, "
            db.log_failure(
                logger,
                exc,
                f"matching want {claimed['id']} ({kind}failure {failures},"
                f" retry after {retry_after.isoformat()})",
            )
            return True
    if claimed is not None:
        backoff.succeeded(claimed["id"])
    return True


async def drain(pool: asyncpg.Pool, backoff: Backoff) -> int:
    """Processes flagged wants until none is claimable, each with its own
    `now`; returns how many were claimed. Never raises."""
    claimed = 0
    try:
        while await process_next(pool, backoff, now=clock.utcnow()):
            claimed += 1
    except Exception as exc:
        db.log_failure(logger, exc, "claiming a flagged want")
    return claimed


async def _listen(
    settings: Settings, pool: asyncpg.Pool, backoff: Backoff, *, poll: timedelta
) -> None:
    """Drains on start, on each NOTIFY and every `poll`, until the listening
    connection is lost."""
    wake = asyncio.Event()

    def notified(*_: object) -> None:
        wake.set()

    listener = await db.connect(settings)
    try:
        listener.add_termination_listener(notified)
        await listener.add_listener(CHANNEL, notified)
        logger.info("listening")
        while not listener.is_closed():
            wake.clear()
            await drain(pool, backoff)
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(wake.wait(), poll.total_seconds())
    finally:
        listener.terminate()


async def request_loop(
    settings: Settings,
    pool: asyncpg.Pool,
    *,
    poll: timedelta = rules.REQUEST_POLL,
    retry_delay: timedelta = rules.REQUEST_POLL,
) -> None:
    """Runs forever; a lost listening connection is reopened (and LISTEN
    re-issued) after `retry_delay`."""
    backoff = Backoff()
    while True:
        try:
            await _listen(settings, pool, backoff, poll=poll)
            logger.warning("listening connection lost, reconnecting")
        except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError) as exc:
            logger.warning("listening connection failed (%s), reconnecting", type(exc).__name__)
        except Exception as exc:
            db.log_failure(logger, exc, "request loop")
        await asyncio.sleep(retry_delay.total_seconds())
