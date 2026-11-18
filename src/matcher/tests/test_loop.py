"""The runtime loops (FR-MT-03/04/07): the startup gate, the NOTIFY and poll
wake-ups of the request loop, the per-want backoff (H4), and the error
policy of the window loop."""

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

import asyncpg
import pytest

from matcher import clock, requests, rules, statements, window
from matcher import db as matcher_db
from matcher.settings import Settings
from tests import conftest

_FAST = timedelta(milliseconds=50)


async def _eventually(check: Callable[[], Awaitable[bool]], timeout: float = 10.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not await check():
        assert asyncio.get_running_loop().time() < deadline, "condition not reached in time"
        await asyncio.sleep(0.05)


async def _stop(task: asyncio.Task[Any]) -> None:
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def _flagged_want(pool: asyncpg.Pool, name: str = "Kurtka zimowa") -> uuid.UUID:
    seeker = await conftest.person(pool)
    return await conftest.want(pool, seeker.party_id, name, match_requested_at=clock.utcnow())


def _cleared(pool: asyncpg.Pool, want_id: uuid.UUID) -> Callable[[], Awaitable[bool]]:
    async def check() -> bool:
        flag = await pool.fetchval("SELECT match_requested_at FROM wants WHERE id = $1", want_id)
        return flag is None

    return check


async def test_requestLoop_notifyWakesItBeforeThePoll(db: asyncpg.Pool, settings: Settings) -> None:
    first = await _flagged_want(db)
    task = asyncio.create_task(requests.request_loop(settings, db, poll=timedelta(minutes=5)))
    try:
        # Drained once at start, after LISTEN: only a NOTIFY can wake it again.
        await _eventually(_cleared(db, first))
        second = await _flagged_want(db)

        await _eventually(_cleared(db, second), timeout=5)
    finally:
        await _stop(task)


async def test_requestLoop_listeningConnectionKilled_reconnectsAndListensAgain(
    db: asyncpg.Pool, settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    def listener_pid() -> Callable[[], Awaitable[bool]]:
        async def check() -> bool:
            pids.append(
                await db.fetchval(
                    "SELECT pid FROM pg_stat_activity"
                    " WHERE datname = current_database() AND query LIKE 'LISTEN %'"
                )
            )
            return pids[-1] is not None and pids[-1] != killed

        return check

    pids: list[int | None] = []
    killed: int | None = None
    caplog.set_level(logging.WARNING, logger="matcher")
    task = asyncio.create_task(
        requests.request_loop(settings, db, poll=timedelta(minutes=5), retry_delay=_FAST)
    )
    try:
        await _eventually(listener_pid())
        killed = pids[-1]
        await db.execute("SELECT pg_terminate_backend($1)", killed)

        await _eventually(listener_pid())
        first = await _flagged_want(db)
        await _eventually(_cleared(db, first))
        # Only a NOTIFY on the new listening connection can wake it now.
        second = await _flagged_want(db)
        await _eventually(_cleared(db, second), timeout=5)
    finally:
        await _stop(task)

    assert any("reconnecting" in record.getMessage() for record in caplog.records)


async def test_requestLoop_wantFlaggedWithoutNotify_caughtByThePoll(
    db: asyncpg.Pool, settings: Settings
) -> None:
    first = await _flagged_want(db)
    task = asyncio.create_task(requests.request_loop(settings, db, poll=_FAST))
    try:
        await _eventually(_cleared(db, first))
        seeker = await conftest.person(db)
        silent = await conftest.want(db, seeker.party_id, "Narty biegowe")
        async with db.acquire() as connection, connection.transaction():
            # Replica mode skips ordinary triggers, so no NOTIFY is sent.
            await connection.execute("SET LOCAL session_replication_role = replica")
            await connection.execute(
                "UPDATE wants SET match_requested_at = $2 WHERE id = $1", silent, clock.utcnow()
            )

        await _eventually(_cleared(db, silent))
    finally:
        await _stop(task)


async def test_drain_failingWant_doesNotBlockTheNext_retriedOnlyAfterItsBackoff(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    failing = await _flagged_want(db, "Sanki drewniane")
    other = await _flagged_want(db, "Narty biegowe")
    match_forward = statements.match_forward
    now = clock.utcnow()

    async def fails_for_one(
        connection: asyncpg.Connection, want_id: uuid.UUID, *, now: datetime
    ) -> list[statements.StoredPair]:
        if want_id == failing:
            await connection.execute("SELECT 1 / 0")
        return await match_forward(connection, want_id, now=now)

    monkeypatch.setattr(statements, "match_forward", fails_for_one)
    monkeypatch.setattr(clock, "utcnow", lambda: now)
    backoff = requests.Backoff()

    assert await requests.drain(db, backoff) == 2
    assert await _cleared(db, other)()
    assert not await _cleared(db, failing)()
    assert backoff.waiting(now) == [failing]

    assert await requests.drain(db, backoff) == 0

    monkeypatch.setattr(clock, "utcnow", lambda: now + rules.BACKOFF_START - timedelta(seconds=1))
    assert await requests.drain(db, backoff) == 0

    monkeypatch.setattr(statements, "match_forward", match_forward)
    monkeypatch.setattr(clock, "utcnow", lambda: now + rules.BACKOFF_START)
    assert await requests.drain(db, backoff) == 1
    assert await _cleared(db, failing)()
    assert backoff.waiting(now + rules.BACKOFF_START) == []


def test_backoff_doublesFromTheStart_cappedAtTheMax_clearedOnSuccess() -> None:
    want_id = uuid.uuid4()
    now = clock.utcnow()
    backoff = requests.Backoff()

    delays = [backoff.failed(want_id, now)[1] - now for _ in range(6)]
    backoff.succeeded(want_id)

    assert delays == [
        rules.BACKOFF_START,
        rules.BACKOFF_START * 2,
        rules.BACKOFF_START * 4,
        rules.BACKOFF_START * 8,
        rules.BACKOFF_MAX,
        rules.BACKOFF_MAX,
    ]
    assert backoff.failed(want_id, now) == (1, now + rules.BACKOFF_START)


async def test_waitForContract_waitsForTheRevisionTheViewAndTheTables(
    db: asyncpg.Pool, settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    name = f"gate_{uuid.uuid4().hex[:12]}"
    await db.execute(f"CREATE DATABASE {name}")
    gate_settings = Settings(dsn=f"{settings.dsn.rsplit('/', 1)[0]}/{name}")
    caplog.set_level(logging.INFO, logger="matcher")
    gate = asyncio.create_task(matcher_db.wait_for_contract(gate_settings, retry_delay=_FAST))
    try:
        empty = await asyncpg.connect(gate_settings.dsn)
        try:
            await asyncio.sleep(0.3)
            assert not gate.done()
            await empty.execute(
                "CREATE TABLE alembic_version (version_num varchar(32) PRIMARY KEY);"
                "INSERT INTO alembic_version VALUES ('0098');"
                "CREATE VIEW matchable_listings AS SELECT 1 AS item_id"
            )
            await asyncio.sleep(0.3)
            assert not gate.done()
            await empty.execute("UPDATE alembic_version SET version_num = '0099'")
            await asyncio.sleep(0.3)
            assert not gate.done()
            await empty.execute("UPDATE alembic_version SET version_num = '0100'")
            await asyncio.sleep(0.3)
            assert not gate.done()
            await empty.execute(
                "CREATE TABLE product_embeddings (product_id uuid);"
                "CREATE TABLE want_embeddings (want_id uuid);"
                "CREATE TABLE wants (id uuid, similar_requested_at timestamp);"
                "UPDATE alembic_version SET version_num = '0101'"
            )

            await asyncio.wait_for(gate, timeout=5)
        finally:
            await empty.close()
    finally:
        gate.cancel()
        await db.execute(f"DROP DATABASE {name} WITH (FORCE)")

    messages = [record.getMessage() for record in caplog.records]
    assert any("no alembic_version" in message for message in messages)
    assert any("0098" in message for message in messages)
    assert any("0100 is before 0101" in message for message in messages)
    assert all(record.levelname == "INFO" for record in caplog.records)
    assert all(gate_settings.dsn not in message for message in messages)


async def test_waitForContract_unreachableDatabase_keepsWaitingWithoutTheUrl(
    settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    unreachable = Settings(dsn="postgresql://matcher:hunter2@127.0.0.1:1/aj")
    caplog.set_level(logging.INFO, logger="matcher")
    gate = asyncio.create_task(matcher_db.wait_for_contract(unreachable, retry_delay=_FAST))

    try:

        async def retried() -> bool:
            return len(caplog.records) >= 2

        # A refused connection takes about 2 s on Windows.
        await _eventually(retried, timeout=20)
        assert not gate.done()
    finally:
        await _stop(gate)

    messages = [record.getMessage() for record in caplog.records]
    assert all("hunter2" not in message and "127.0.0.1" not in message for message in messages)


async def test_windowLoop_lostRaceWarns_otherErrorLoggedOnce_loopContinues(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    match_window = statements.match_window
    failures: list[BaseException] = [
        asyncpg.exceptions.DeadlockDetectedError("deadlock detected"),
        RuntimeError("boom"),
    ]

    async def fails_twice(
        connection: asyncpg.Connection,
        *,
        listed_after: datetime,
        now: datetime,
        listed_until: datetime | None = None,
    ) -> list[statements.StoredPair]:
        if failures:
            raise failures.pop(0)
        return await match_window(
            connection, listed_after=listed_after, now=now, listed_until=listed_until
        )

    monkeypatch.setattr(statements, "match_window", fails_twice)
    caplog.set_level(logging.WARNING, logger="matcher")
    task = asyncio.create_task(window.window_loop(db, interval=_FAST))
    try:

        async def marker_written() -> bool:
            return bool(await db.fetchval("SELECT count(*) FROM want_scan_markers"))

        await _eventually(marker_written)
    finally:
        await _stop(task)

    warning, error = caplog.records
    assert warning.levelname == "WARNING"
    assert "deadlock detected" in warning.getMessage()
    assert warning.exc_info is None
    assert error.levelname == "ERROR"
    assert error.exc_info is not None and isinstance(error.exc_info[1], RuntimeError)


async def test_drain_lostRaceOnAWant_warnsWithItsIdAndFailureCount(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    want_id = await _flagged_want(db)

    async def deadlock(*_: Any, **__: Any) -> list[statements.StoredPair]:
        raise asyncpg.exceptions.DeadlockDetectedError("deadlock detected")

    monkeypatch.setattr(statements, "match_forward", deadlock)
    caplog.set_level(logging.WARNING, logger="matcher")

    assert await requests.drain(db, requests.Backoff()) == 1

    (record,) = caplog.records
    assert record.levelname == "WARNING"
    assert str(want_id) in record.getMessage()
    assert "failure 1" in record.getMessage()
