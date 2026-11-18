"""The two request kinds (R26): a full request (`match_requested_at`) runs
the whole forward match and clears both flags, a background re-trigger
(`similar_requested_at`) runs only the SIMILAR tier, full requests are
claimed first, and the backoff covers both kinds."""

import logging
import uuid
from datetime import datetime, timedelta

import asyncpg
import pytest

from matcher import clock, requests, statements, window
from tests import conftest
from tests.test_similar import _embedded_want, _listed


async def _flags(db: asyncpg.Pool, want_id: uuid.UUID) -> asyncpg.Record:
    row: asyncpg.Record | None = await db.fetchrow(
        "SELECT match_requested_at, similar_requested_at, updated_at FROM wants WHERE id = $1",
        want_id,
    )
    assert row is not None
    return row


def _tiers(rows: dict[uuid.UUID, asyncpg.Record]) -> dict[uuid.UUID, str]:
    return {item_id: row["tier"] for item_id, row in rows.items()}


async def test_processNext_similarOnly_storesNoLexicalPairNoBell_windowRingsItAfterwards(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    item_id = await _listed(
        db, lister, 1.0, name="Rower górski czerwony", listed_at=now - timedelta(minutes=1)
    )
    want_id = await _embedded_want(db, seeker)
    await conftest.update_want(db, want_id, similar_requested_at=now)

    assert await requests.process_next(db, requests.Backoff(), now=now)

    rows = await conftest.stored(db, want_id)
    assert set(_tiers(rows).values()) <= {"SIMILAR"}
    assert await conftest.bells_due(db) == []
    assert (await _flags(db, want_id))["similar_requested_at"] is None

    await window.run_window(db, now=now + timedelta(seconds=1))

    rows = await conftest.stored(db, want_id)
    assert _tiers(rows) == {item_id: "MATCH"}
    assert (rows[item_id]["source"], rows[item_id]["seen_at"]) == ("SCAN", None)
    assert [bell["pairs"] for bell in await conftest.bells_due(db)] == [
        [[str(want_id), str(item_id)]]
    ]


async def test_processNext_fullRequest_storesMatchAndSimilar_clearsBothFlags_updatedAtKept(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    lexical = await _listed(db, lister, 0.5, name="Rower górski czerwony")
    semantic = await _listed(db, lister, 0.95)
    want_id = await _embedded_want(db, seeker)
    now = clock.utcnow()
    await conftest.update_want(
        db, want_id, match_requested_at=now, similar_requested_at=now - timedelta(seconds=1)
    )
    before = await _flags(db, want_id)

    assert await requests.process_next(db, requests.Backoff(), now=now)

    assert _tiers(await conftest.stored(db, want_id)) == {lexical: "MATCH", semantic: "SIMILAR"}
    after = await _flags(db, want_id)
    assert (after["match_requested_at"], after["similar_requested_at"]) == (None, None)
    assert after["updated_at"] == before["updated_at"]


async def test_processNext_fullRequestClaimedBeforeAnOlderSimilarOnlyRequest(
    db: asyncpg.Pool,
) -> None:
    seeker = await conftest.person(db)
    now = clock.utcnow()
    background = await conftest.want(db, seeker.party_id, "Sanki drewniane")
    await conftest.update_want(db, background, similar_requested_at=now - timedelta(minutes=10))
    full = await conftest.want(db, seeker.party_id, "Narty biegowe", match_requested_at=now)

    assert await requests.process_next(db, requests.Backoff(), now=now)

    assert (await _flags(db, full))["match_requested_at"] is None
    assert (await _flags(db, background))["similar_requested_at"] is not None


async def test_processNext_failingSimilarOnlyRun_rolledBack_flagKept_backedOffForBothKinds(
    db: asyncpg.Pool, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    await _listed(db, lister, 0.95)
    want_id = await _embedded_want(db, seeker)
    now = clock.utcnow()
    await conftest.update_want(db, want_id, similar_requested_at=now)
    match_similar_forward = statements.match_similar_forward

    async def broken(
        connection: asyncpg.Connection, want_id: uuid.UUID, *, now: datetime
    ) -> list[statements.StoredPair]:
        await match_similar_forward(connection, want_id, now=now)
        await connection.execute("SELECT 1 / 0")
        return []

    monkeypatch.setattr(statements, "match_similar_forward", broken)
    caplog.set_level(logging.ERROR, logger="matcher")
    backoff = requests.Backoff()

    assert await requests.process_next(db, backoff, now=now)

    assert await conftest.stored(db, want_id) == {}
    assert (await _flags(db, want_id))["similar_requested_at"] == now
    assert backoff.waiting(now) == [want_id]
    assert "similar only, failure 1" in caplog.text

    await conftest.update_want(db, want_id, match_requested_at=now)
    assert not await requests.process_next(db, backoff, now=now)


async def test_processNext_similarOnlyOnAnExpiredWant_clearedWithoutPairs(
    db: asyncpg.Pool,
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    await _listed(db, lister, 0.95)
    now = clock.utcnow()
    want_id = await conftest.want(
        db, seeker.party_id, "Rower górski", status="EXPIRED", expires_at=now - timedelta(days=1)
    )
    await conftest.update_want(db, want_id, similar_requested_at=now)

    assert await requests.process_next(db, requests.Backoff(), now=now)

    assert (await _flags(db, want_id))["similar_requested_at"] is None
    assert await conftest.stored(db, want_id) == {}


async def test_processNext_wantWithoutVector_lexicalOnly_similarOnlyCleared_noWarning(
    db: asyncpg.Pool, caplog: pytest.LogCaptureFixture
) -> None:
    lister = await conftest.owner(db)
    seeker = await conftest.person(db)
    now = clock.utcnow()
    listed_at = now - timedelta(minutes=1)
    lexical = await _listed(db, lister, 1.0, name="Rower górski czerwony", listed_at=listed_at)
    await _listed(db, lister, 1.0, listed_at=listed_at)
    want_id = await conftest.want(db, seeker.party_id, "Rower górski")
    await conftest.update_want(db, want_id, match_requested_at=now)
    caplog.set_level(logging.WARNING, logger="matcher")
    backoff = requests.Backoff()

    assert await requests.process_next(db, backoff, now=now)
    await conftest.update_want(db, want_id, similar_requested_at=now)
    assert await requests.process_next(db, backoff, now=now)
    await window.run_window(db, now=now + timedelta(seconds=1))

    assert _tiers(await conftest.stored(db, want_id)) == {lexical: "MATCH"}
    flags = await _flags(db, want_id)
    assert (flags["match_requested_at"], flags["similar_requested_at"]) == (None, None)
    assert backoff.waiting(now) == []
    assert caplog.records == []
