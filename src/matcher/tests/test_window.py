"""The window run (FR-MT-05/06): unseen SCAN pairs and their outbox rows,
the marker window with its overlap, the advisory lock, every NOT NULL column
of the raw inserts (L2), chunked outbox rows (L8), no wait behind a
claimed want (L7), and a listing read again after its `changed_at` moves
(renamed, available again). Forward ≡ window is pinned in `test_forward.py`."""

import asyncio
import re
import uuid
from datetime import datetime, timedelta

import asyncpg
import pytest

from matcher import clock, outbox, requests, rules, statements, window
from matcher import db as matcher_db
from tests import conftest


async def _markers(db: asyncpg.Pool) -> list[datetime]:
    rows = await db.fetch("SELECT scanned_through FROM want_scan_markers")
    return [row["scanned_through"] for row in rows]


async def _matched(db: asyncpg.Pool, want_id: uuid.UUID) -> set[uuid.UUID]:
    return set(await conftest.stored(db, want_id))


async def test_runWindow_newListing_unseenScanPairAndOneOutboxRow_againAddsNothing(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "rower")
    bike = await conftest.lists(db, lister, "Rower miejski")
    now = clock.utcnow()

    run = await window.run_window(db, now=now)

    row = (await conftest.stored(db, want_id))[bike]
    assert (row["source"], row["tier"], row["seen_at"]) == ("SCAN", "MATCH", None)
    assert (row["created_at"], row["updated_at"]) == (now, now)
    assert run is not None and run.outbox_rows == 1
    assert await conftest.bells_due(db) == [{"pairs": [[str(want_id), str(bike)]], "expiring": []}]
    entry = await db.fetchrow("SELECT * FROM outbox_entries")
    assert entry is not None
    assert (entry["status"], entry["attempts"], entry["processed_at"]) == ("PENDING", 0, None)

    await window.run_window(db, now=now + timedelta(seconds=1))

    assert await _matched(db, want_id) == {bike}
    assert len(await conftest.bells_due(db)) == 1


async def test_runWindow_firstRunReadsTheLookback_nextRunReadsFromTheMarkerMinusTheOverlap(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "rower")
    now = clock.utcnow() + timedelta(hours=1)
    first_start = now - rules.FIRST_WINDOW_LOOKBACK
    inside = await conftest.lists(
        db, lister, "Rower miejski", listed_at=first_start + timedelta(minutes=1)
    )
    await conftest.lists(db, lister, "Rower górski", listed_at=first_start)

    await window.run_window(db, now=now)

    assert await _matched(db, want_id) == {inside}
    assert await _markers(db) == [now]

    next_now = now + rules.WINDOW_INTERVAL
    in_overlap = await conftest.lists(
        db, lister, "Rower szosowy", listed_at=now - rules.WINDOW_OVERLAP + timedelta(seconds=1)
    )
    await conftest.lists(db, lister, "Rower składany", listed_at=now - rules.WINDOW_OVERLAP)
    at_the_end = await conftest.lists(db, lister, "Rower dziecięcy", listed_at=next_now)
    await conftest.lists(db, lister, "Rower trekkingowy", listed_at=next_now + timedelta(seconds=1))

    run = await window.run_window(db, now=next_now)

    assert run is not None and run.start == now - rules.WINDOW_OVERLAP
    assert await _matched(db, want_id) == {inside, in_overlap, at_the_end}
    assert await _markers(db) == [next_now]


async def test_runWindow_cappedRun_markerUpdatedAtIsTheRunClock(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(rules, "WINDOW_MAX_LISTINGS", 1)
    lister = await conftest.owner(db)
    now = clock.utcnow()
    marker = now - timedelta(hours=1)
    await db.execute(window.MARKER_INSERT, marker, window.SCAN_NAME, marker)
    first = marker + timedelta(minutes=1)
    await conftest.lists(db, lister, "Rower miejski", listed_at=first)
    await conftest.lists(db, lister, "Rower górski", listed_at=marker + timedelta(minutes=2))

    run = await window.run_window(db, now=now)

    assert run is not None and (run.end, run.capped) == (first, True)
    row = await db.fetchrow("SELECT scanned_through, updated_at FROM want_scan_markers")
    assert row is not None and (row["scanned_through"], row["updated_at"]) == (first, now)


@pytest.mark.parametrize(
    ("previous_run_at", "expected"),
    [
        (timedelta(0), -rules.WINDOW_OVERLAP),
        (timedelta(seconds=30), timedelta(seconds=30) - rules.WINDOW_OVERLAP),
        (rules.WINDOW_OVERLAP, timedelta(0)),
        (timedelta(hours=3), timedelta(0)),
        (-timedelta(minutes=5), -rules.WINDOW_OVERLAP),
    ],
)
def test_windowStart_overlapOnlyWithinTheOverlapBeforeThePreviousRunClock(
    previous_run_at: timedelta, expected: timedelta
) -> None:
    marker = datetime(2026, 11, 17, 12, 0)

    assert window.window_start(marker, marker + previous_run_at) == marker + expected


def _counting_window_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> list[int]:
    """Patches `statements.match_window` to record how many listings each
    window run reads."""
    reads: list[int] = []
    match_window = statements.match_window

    async def counting(
        connection: asyncpg.Connection,
        *,
        listed_after: datetime,
        now: datetime,
        listed_until: datetime | None = None,
    ) -> list[statements.StoredPair]:
        reads.append(
            await connection.fetchval(
                "SELECT count(*) FROM matchable_listings"
                " WHERE created_at > $1 AND created_at <= $2",
                listed_after,
                listed_until,
            )
        )
        return await match_window(
            connection, listed_after=listed_after, now=now, listed_until=listed_until
        )

    monkeypatch.setattr(statements, "match_window", counting)
    return reads


async def _drain(db: asyncpg.Pool, now: datetime, *, max_runs: int) -> list[window.WindowRun]:
    runs: list[window.WindowRun] = []
    for second in range(max_runs):
        run = await window.run_window(db, now=now + timedelta(seconds=second))
        assert run is not None
        runs.append(run)
        if not run.capped:
            return runs
    raise AssertionError(f"not drained in {max_runs} runs")


async def test_runWindow_burstWithinOneMinute_drainsInRunsOfAtMostTheCap_markerReachesNow(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    cap = 5
    monkeypatch.setattr(rules, "WINDOW_MAX_LISTINGS", cap)
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "rower")
    now = clock.utcnow()
    marker = now - timedelta(minutes=4)
    await db.execute(window.MARKER_INSERT, marker, window.SCAN_NAME, marker)
    bikes = {
        await conftest.lists(
            db, lister, "Rower miejski", listed_at=marker + timedelta(seconds=1 + n)
        )
        for n in range(50)
    }
    reads = _counting_window_reads(monkeypatch)

    runs = await _drain(db, now, max_runs=20)

    assert [run.capped for run in runs] == [True] * 9 + [False]
    assert reads == [cap] * 10
    assert await _markers(db) == [runs[-1].end] == [now + timedelta(seconds=9)]
    assert await _matched(db, want_id) == bikes
    assert sum(len(payload["pairs"]) for payload in await conftest.bells_due(db)) == len(bikes)


async def test_runWindow_tiedCreatedAtBeyondTheCap_drainsWithoutLossOrRereadingTheTies(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(rules, "WINDOW_MAX_LISTINGS", 5)
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "rower")
    now = clock.utcnow()
    marker = now - timedelta(hours=1)
    await db.execute(window.MARKER_INSERT, marker, window.SCAN_NAME, marker)
    tied_at = marker + timedelta(minutes=10)
    bikes = {
        await conftest.lists(db, lister, "Rower miejski", listed_at=tied_at) for _ in range(12)
    }
    bikes |= {
        await conftest.lists(db, lister, "Rower górski", listed_at=tied_at + timedelta(minutes=n))
        for n in (1, 2)
    }
    reads = _counting_window_reads(monkeypatch)

    runs = await _drain(db, now, max_runs=5)

    assert [(run.start, run.end, run.capped) for run in runs] == [
        (marker - rules.WINDOW_OVERLAP, tied_at, True),
        (tied_at, now + timedelta(seconds=1), False),
    ]
    assert reads == [12, 2]
    assert await _matched(db, want_id) == bikes


async def test_runWindow_unlockFailsAfterAFailedMatch_theMatchErrorPropagates(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    class MatchFailed(Exception):
        pass

    async def fails(*_: object, **__: object) -> list[statements.StoredPair]:
        raise MatchFailed

    execute = asyncpg.Connection.execute

    async def unlock_breaks(self: asyncpg.Connection, query: str, *args: object) -> str:
        if "pg_advisory_unlock(" in query:
            raise asyncpg.exceptions.ConnectionDoesNotExistError("connection was closed")
        return await execute(self, query, *args)

    monkeypatch.setattr(statements, "match_window", fails)
    monkeypatch.setattr(asyncpg.Connection, "execute", unlock_breaks)

    with pytest.raises(MatchFailed):
        await window.run_window(db, now=clock.utcnow())

    monkeypatch.undo()
    assert await window.run_window(db, now=clock.utcnow()) is not None


async def test_runWindow_advisoryLockHeldElsewhere_runSkippedWithoutWriting(
    db: asyncpg.Pool,
) -> None:
    async with db.acquire() as rival, rival.transaction():
        await rival.execute("SELECT pg_advisory_xact_lock($1)", window.LOCK_KEY)

        assert await window.run_window(db, now=clock.utcnow()) is None
        assert await _markers(db) == []

    assert await window.run_window(db, now=clock.utcnow()) is not None
    assert len(await _markers(db)) == 1


async def test_runWindow_markerMovedByARival_lostRaceAndNothingStored(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = clock.utcnow()
    await window.run_window(db, now=now)
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "rower")
    await conftest.lists(db, lister, "Rower miejski")
    match_window = statements.match_window

    async def rival_moves_the_marker(
        connection: asyncpg.Connection,
        *,
        listed_after: datetime,
        now: datetime,
        listed_until: datetime | None = None,
    ) -> list[statements.StoredPair]:
        await db.execute(
            "UPDATE want_scan_markers SET scanned_through = scanned_through + interval '1 second'"
        )
        return await match_window(
            connection, listed_after=listed_after, now=now, listed_until=listed_until
        )

    monkeypatch.setattr(statements, "match_window", rival_moves_the_marker)

    with pytest.raises(matcher_db.LostRace):
        await window.run_window(db, now=now + timedelta(minutes=1))

    assert await _matched(db, want_id) == set()
    assert await _markers(db) == [now + timedelta(seconds=1)]


async def test_runWindow_moreThanAThousandPairs_twoPairRows_expiringInTheSweepRow(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    wants = [
        await conftest.want(db, seeker.party_id, "Kurtka zimowa")
        for _ in range(outbox.PAIRS_PER_ROW // rules.MATCH_TOP_N + 1)
    ]
    expiring = await conftest.want(
        db, seeker.party_id, "Hulajnoga", expires_at=now + timedelta(days=1)
    )
    for _ in range(rules.MATCH_TOP_N):
        await conftest.lists(db, lister, "Kurtka zimowa", listed_at=now - timedelta(minutes=1))

    run = await window.run_window(db, now=now)

    sweep, first, second = await conftest.bells_due(db)
    assert run is not None and run.outbox_rows == 3
    assert sweep == {"pairs": [], "expiring": [str(expiring)]}
    assert len(first["pairs"]) == outbox.PAIRS_PER_ROW
    assert len(second["pairs"]) == len(wants) * rules.MATCH_TOP_N - outbox.PAIRS_PER_ROW
    assert (first["expiring"], second["expiring"]) == ([], [])
    stored = {
        (row["want_id"], row["item_id"])
        for row in await db.fetch("SELECT want_id, item_id FROM want_matches")
    }
    belled = {
        (uuid.UUID(want_id), uuid.UUID(item_id))
        for payload in (first, second)
        for want_id, item_id in payload["pairs"]
    }
    assert belled == stored


async def test_runWindow_onlySuggestions_noOutboxRow(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "Traktor Bruder Claas")
    tractor = await conftest.lists(db, lister, "Traktor bruder Deutz")

    run = await window.run_window(db, now=clock.utcnow())

    assert (await conftest.stored(db, want_id))[tractor]["tier"] == "SUGGESTION"
    assert run is not None and run.outbox_rows == 0
    assert await conftest.bells_due(db) == []


def _inserted_columns(statement: str, table: str) -> set[str]:
    found = re.search(rf"INSERT INTO {table}\s*\(([^)]*)\)", statement)
    assert found is not None, table
    return {column.strip() for column in found.group(1).split(",")}


async def test_rawInserts_setEveryNotNullColumnWithoutADefault(db: asyncpg.Pool) -> None:
    inserts = {
        "outbox_entries": outbox.INSERT,
        "want_matches": statements.WINDOW_MATCH.sql,
        "want_scan_markers": window.MARKER_INSERT,
    }
    required = await db.fetch(
        """
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])
          AND is_nullable = 'NO' AND column_default IS NULL AND is_generated = 'NEVER'
        """,
        list(inserts),
    )

    assert {row["table_name"] for row in required} == set(inserts)
    for row in required:
        assert row["column_name"] in _inserted_columns(
            inserts[row["table_name"]], row["table_name"]
        ), (row["table_name"], row["column_name"])
    for table, statement in inserts.items():
        assert {"id", "created_at", "updated_at"} <= _inserted_columns(statement, table)


async def test_runWindow_wantHeldByAClaim_insertDoesNotWait(db: asyncpg.Pool) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "rower", match_requested_at=clock.utcnow())
    bike = await conftest.lists(db, lister, "Rower miejski")

    async with db.acquire() as claimer, claimer.transaction():
        claimed = await claimer.fetchrow(requests.CLAIM, [])
        assert claimed is not None and claimed["id"] == want_id

        await asyncio.wait_for(window.run_window(db, now=clock.utcnow()), timeout=5)

    assert await _matched(db, want_id) == {bike}
    assert await conftest.bells_due(db) == [{"pairs": [[str(want_id), str(bike)]], "expiring": []}]


async def test_runWindow_hoursOldMarkerAboveTheCap_drainsInCappedRuns_markerEndsAtNow(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(rules, "WINDOW_MAX_LISTINGS", 3)
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "rower")
    now = clock.utcnow()
    marker = now - timedelta(hours=3)
    await db.execute(window.MARKER_INSERT, marker, window.SCAN_NAME, marker)
    listed = [marker + timedelta(minutes=20 * n) for n in range(1, 8)]
    bikes = [await conftest.lists(db, lister, "Rower miejski", listed_at=at) for at in listed]

    runs = [await window.run_window(db, now=now) for _ in range(3)]

    assert [(run.start, run.end, run.capped) for run in runs if run] == [
        (marker - rules.WINDOW_OVERLAP, listed[2], True),
        (listed[2], listed[5], True),
        (listed[5], now, False),
    ]
    assert await _markers(db) == [now]
    rows = await conftest.stored(db, want_id)
    assert set(rows) == set(bikes)
    assert {row["created_at"] for row in rows.values()} == {now}
    assert sum(len(payload["pairs"]) for payload in await conftest.bells_due(db)) == len(bikes)


async def test_windowLoop_cappedRun_nextRunStartsWithoutTheInterval(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(rules, "WINDOW_MAX_LISTINGS", 2)
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "rower")
    marker = clock.utcnow() - timedelta(hours=1)
    await db.execute(window.MARKER_INSERT, marker, window.SCAN_NAME, marker)
    bikes = {
        await conftest.lists(db, lister, "Rower miejski", listed_at=marker + timedelta(minutes=n))
        for n in range(1, 8)
    }
    task = asyncio.create_task(window.window_loop(db, interval=timedelta(minutes=5)))
    try:
        deadline = asyncio.get_running_loop().time() + 10
        while await _matched(db, want_id) != bikes:
            assert asyncio.get_running_loop().time() < deadline, "backlog not drained in time"
            await asyncio.sleep(0.05)
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    (end,) = await _markers(db)
    assert end > marker + timedelta(minutes=7)


async def test_runWindow_matchStatementFails_sweepStaysCommitted_lockReleased(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    ended = await conftest.want(db, seeker.party_id, "Narty", expires_at=now - timedelta(days=1))
    ending = await conftest.want(db, seeker.party_id, "Rower", expires_at=now + timedelta(days=1))
    await conftest.lists(db, lister, "Rower miejski")
    match_window = statements.match_window

    async def times_out(*_: object, **__: object) -> list[statements.StoredPair]:
        raise asyncpg.exceptions.QueryCanceledError("canceling statement due to statement timeout")

    monkeypatch.setattr(statements, "match_window", times_out)

    with pytest.raises(asyncpg.exceptions.QueryCanceledError):
        await window.run_window(db, now=now)

    states = await db.fetch("SELECT id, status, reminded_at FROM wants")
    assert {row["id"]: (row["status"], row["reminded_at"]) for row in states} == {
        ended: ("EXPIRED", None),
        ending: ("ACTIVE", now),
    }
    assert await conftest.bells_due(db) == [{"pairs": [], "expiring": [str(ending)]}]
    assert await _markers(db) == []
    assert await db.fetchval("SELECT count(*) FROM want_matches") == 0

    monkeypatch.setattr(statements, "match_window", match_window)
    run = await window.run_window(db, now=now + timedelta(seconds=1))

    assert run is not None and (run.matches, run.expired, run.reminded) == (1, 0, [])


async def test_runWindow_itemRenamedAfterItsListingWasRead_nextRunMatchesWithABell(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "klocki lego")
    now = clock.utcnow()
    item_id = await conftest.lists(db, lister, "Klocki Cobi", listed_at=now - timedelta(seconds=30))
    await window.run_window(db, now=now)
    assert await _matched(db, want_id) == set()

    renamed_at = now + timedelta(minutes=5)
    lego = await conftest.product(db, "Klocki Lego - fajne jak nowe", lister.category_id)
    await db.execute(
        "UPDATE inventory_items SET product_id = $2, updated_at = $3 WHERE id = $1",
        item_id,
        lego,
        renamed_at,
    )
    await window.run_window(db, now=renamed_at + rules.WINDOW_INTERVAL)

    row = (await conftest.stored(db, want_id))[item_id]
    assert (row["source"], row["tier"], row["seen_at"]) == ("SCAN", "MATCH", None)
    assert await conftest.bells_due(db) == [
        {"pairs": [[str(want_id), str(item_id)]], "expiring": []}
    ]


async def test_runWindow_itemAvailableAgainAfterItsListingWasRead_nextRunMatches(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    want_id = await conftest.want(db, seeker.party_id, "rower")
    now = clock.utcnow()
    bike = await conftest.lists(
        db, lister, "Rower miejski", balance="RESERVED", listed_at=now - timedelta(seconds=30)
    )
    await window.run_window(db, now=now)
    assert await _matched(db, want_id) == set()

    available_at = now + timedelta(minutes=5)
    await db.execute(
        "UPDATE inventory_balances SET status = 'AVAILABLE', updated_at = $2 WHERE item_id = $1",
        bike,
        available_at,
    )
    await window.run_window(db, now=available_at + rules.WINDOW_INTERVAL)

    assert await _matched(db, want_id) == {bike}
