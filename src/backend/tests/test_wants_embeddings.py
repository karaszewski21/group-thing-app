"""The want vector layer: create and a name edit embed `zapytanie: <name>`
in the write's own commit, a miss commits without a vector and stages
`embeddings.requested`, the outbox handler fills it and asks for a
SIMILAR-only run through `similar_requested_at` (never `match_requested_at`,
never a new `updated_at`), and the reconcile sweep fills ACTIVE wants while
skipping rows another session holds. Both background paths embed without
holding the want's lock and store nothing for a want renamed meanwhile. The
lifespan refuses to start without migration 0101 whatever the flag, and each
side of the reconcile job fails alone, never re-raised. The lock tests
commit their seed on the session engine and remove it in `finally`."""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Any, cast

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine, AsyncSession

import app.main as main
from app.config import settings
from app.embeddings import service as embeddings_service
from app.embeddings.service import EMBEDDING_MODEL_ID, vector_literal
from app.outbox import registry as outbox_registry
from app.outbox import scheduler as outbox_scheduler
from app.outbox.dispatcher import dispatch_pending
from app.outbox.models import OutboxEntry, OutboxStatus
from app.party.models import Party, PartyType
from app.product import embeddings as product_embeddings
from app.wants.application import embeddings
from app.wants.domain.status import WantStatus
from app.wants.infrastructure import embeddings_acl
from app.wants.models import Want, WantMatchTier
from tests.conftest import (
    FakeEmbedder,
    _Owner,
    _want,
    fake_unit_vector,
    leaf_category_ids,
    seed_want_matches,
)
from tests.test_term_item_listings import _auth, _register
from tests.test_wants_api import _create_want

INSERT_WANT = """
    INSERT INTO wants (id, created_at, updated_at, seeker_party_id, name, status, expires_at)
    VALUES (gen_random_uuid(), :now, :now, :seeker, :name, 'ACTIVE', :expires_at)
    RETURNING id
"""
LOCK_WANT = "SELECT id FROM wants WHERE id = :id FOR NO KEY UPDATE"


async def _vector(db: AsyncSession, want_id: uuid.UUID | str) -> Any:
    """The stored `(model_id, embedding text, updated_at)` row, or None."""
    row = await db.execute(
        text(
            "SELECT model_id, CAST(embedding AS text) AS embedding, updated_at "
            "FROM want_embeddings WHERE want_id = :id"
        ),
        {"id": uuid.UUID(str(want_id))},
    )
    return row.first()


async def _holds(db: AsyncSession, want_id: uuid.UUID | str, embedded_text: str) -> bool:
    """The stored vector is the fake embedder's vector of `embedded_text`,
    compared as halfvec."""
    return bool(
        await db.scalar(
            text(
                "SELECT embedding = CAST(:embedding AS halfvec) "
                "FROM want_embeddings WHERE want_id = :id"
            ),
            {
                "id": uuid.UUID(str(want_id)),
                "embedding": vector_literal(fake_unit_vector(embedded_text)),
            },
        )
    )


async def _store_vector(db: AsyncSession, want_id: uuid.UUID, model_id: str) -> None:
    await db.execute(
        text(
            "INSERT INTO want_embeddings (want_id, model_id, embedding, updated_at) "
            "VALUES (:id, :model_id, CAST(:embedding AS halfvec), :now)"
        ),
        {
            "id": want_id,
            "model_id": model_id,
            "embedding": vector_literal(fake_unit_vector("old")),
            "now": datetime.utcnow(),
        },
    )
    await db.commit()


async def _retries(db: AsyncSession, want_id: uuid.UUID | str) -> int:
    return int(
        await db.scalar(
            select(func.count())
            .select_from(OutboxEntry)
            .where(
                OutboxEntry.event_type == embeddings.EVENT_TYPE,
                OutboxEntry.payload == {"subject": "want", "id": str(want_id)},
            )
        )
        or 0
    )


async def _stored(db: AsyncSession, want_id: uuid.UUID | str) -> Any:
    """The want's `(match_requested_at, similar_requested_at, updated_at)`."""
    row = (
        await db.execute(
            select(Want.match_requested_at, Want.similar_requested_at, Want.updated_at).where(
                Want.id == uuid.UUID(str(want_id))
            )
        )
    ).first()
    assert row is not None
    return row


async def _seed_party_wants(engine: AsyncEngine, *names: str) -> tuple[uuid.UUID, list[uuid.UUID]]:
    """A party with one ACTIVE want per name, committed."""
    now = datetime.utcnow()
    async with AsyncSession(engine) as db:
        party = Party(party_type=PartyType.PERSON)
        db.add(party)
        await db.flush()
        seeker = cast(uuid.UUID, party.id)
        want_ids = [
            await db.scalar(
                text(INSERT_WANT),
                {
                    "now": now,
                    "seeker": seeker,
                    "name": name,
                    "expires_at": now + timedelta(days=90),
                },
            )
            for name in names
        ]
        await db.commit()
    return seeker, want_ids


async def _remove(engine: AsyncEngine, seeker: uuid.UUID) -> None:
    async with engine.begin() as conn:
        await conn.execute(text("DELETE FROM wants WHERE seeker_party_id = :id"), {"id": seeker})
        await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": seeker})


async def _until_lock_wait(conn: AsyncConnection) -> None:
    """Returns once some backend of the database waits for a row lock; the
    caller bounds it with `asyncio.wait_for`."""
    while True:
        waiting = await conn.scalar(
            text(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )
        )
        await conn.rollback()
        if waiting:
            return


async def test_createWant_storesQueryVectorInMatchCommit_resumeCallsNoEmbedder(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    token, _ = await _register(client, "GUEST", "we.create@example.com")

    want = await _create_want(client, token, "Rower miejski")

    assert fake_embedder.texts == ["zapytanie: Rower miejski"]
    stored = await _vector(db_session, want["id"])
    assert stored is not None
    assert stored.model_id == EMBEDDING_MODEL_ID
    assert await _holds(db_session, want["id"], "zapytanie: Rower miejski")
    assert (await _stored(db_session, want["id"])).match_requested_at == stored.updated_at
    assert await _retries(db_session, want["id"]) == 0

    closed = await client.post(
        f"/api/wants/{want['id']}/close", json={"outcome": "FULFILLED"}, headers=_auth(token)
    )
    assert closed.status_code == 200, closed.text
    resumed = await client.post(f"/api/wants/{want['id']}/resume", headers=_auth(token))
    assert resumed.status_code == 200, resumed.text
    assert fake_embedder.texts == ["zapytanie: Rower miejski"]
    assert (await _vector(db_session, want["id"])) == stored


async def test_updateWant_nameEdit_reEmbeds_categoryOnlyEdit_keepsVector(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    token, _ = await _register(client, "GUEST", "we.edit@example.com")
    want = await _create_want(client, token, "Rower miejski")

    renamed = await client.patch(
        f"/api/wants/{want['id']}", json={"name": "Hulajnoga"}, headers=_auth(token)
    )
    assert renamed.status_code == 200, renamed.text
    assert fake_embedder.texts[-1] == "zapytanie: Hulajnoga"
    assert await _holds(db_session, want["id"], "zapytanie: Hulajnoga")
    stored = await _vector(db_session, want["id"])

    calls = len(fake_embedder.calls)
    recategorised = await client.patch(
        f"/api/wants/{want['id']}",
        json={"category_id": (await leaf_category_ids(client, _auth(token)))[0]},
        headers=_auth(token),
    )
    assert recategorised.status_code == 200, recategorised.text
    assert len(fake_embedder.calls) == calls
    assert (await _vector(db_session, want["id"])) == stored


async def test_writeWant_embedderMiss_commitsWithoutVectorAndStagesOneRetry(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    token, _ = await _register(client, "GUEST", "we.miss@example.com")
    fake_embedder.fail = True

    missed = await _create_want(client, token, "Rower miejski")

    assert (await _stored(db_session, missed["id"])).match_requested_at is not None
    assert await _vector(db_session, missed["id"]) is None
    assert await _retries(db_session, missed["id"]) == 1

    fake_embedder.fail = False
    embedded = await _create_want(client, token, "Sanki")
    assert await _vector(db_session, embedded["id"]) is not None
    fake_embedder.fail = True
    renamed = await client.patch(
        f"/api/wants/{embedded['id']}", json={"name": "Narty"}, headers=_auth(token)
    )
    assert renamed.status_code == 200, renamed.text
    assert await _vector(db_session, embedded["id"]) is None
    assert await _retries(db_session, embedded["id"]) == 1


async def test_handleEmbeddingsRequested_upsertsAndRequestsSimilar_onlyForActive(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    _, seeker = await _register(client, "GUEST", "we.handler@example.com")
    active = await _want(db_session, seeker, "Rower miejski")
    expired = await _want(db_session, seeker, "Sanki", status=WantStatus.EXPIRED)
    withdrawn = await _want(db_session, seeker, "Narty", status=WantStatus.WITHDRAWN)
    versions = {
        want_id: (await _stored(db_session, want_id)).updated_at for want_id in (active, expired)
    }
    for want_id in (active, expired, withdrawn):
        await db_session.execute(
            text(
                "INSERT INTO outbox_entries "
                "(id, created_at, updated_at, event_type, payload, status, attempts) "
                "VALUES (gen_random_uuid(), :now, :now, :event_type, "
                "CAST(:payload AS jsonb), 'PENDING', 0)"
            ),
            {
                "now": datetime.utcnow(),
                "event_type": embeddings.EVENT_TYPE,
                "payload": f'{{"subject": "want", "id": "{want_id}"}}',
            },
        )
    await db_session.commit()

    embeddings.register()
    embeddings.register()
    await dispatch_pending(db_session, event_types=[embeddings.EVENT_TYPE])

    assert fake_embedder.texts == ["zapytanie: Rower miejski", "zapytanie: Sanki"]
    assert await _vector(db_session, active) is not None
    assert await _vector(db_session, expired) is not None
    assert await _vector(db_session, withdrawn) is None
    active_want, expired_want = (
        await _stored(db_session, active),
        await _stored(db_session, expired),
    )
    assert active_want.similar_requested_at is not None
    assert active_want.match_requested_at is None
    assert expired_want.similar_requested_at is None
    assert {active: active_want.updated_at, expired: expired_want.updated_at} == versions


async def test_handleEmbeddingsRequested_wantLockedByOtherSession_waitsAndWritesVector(
    engine: AsyncEngine, fake_embedder: FakeEmbedder
) -> None:
    seeker, (want_id,) = await _seed_party_wants(engine, "Rower miejski")
    try:
        async with engine.connect() as holder, engine.connect() as observer:
            await holder.execute(text(LOCK_WANT), {"id": want_id})

            async def handle() -> None:
                async with AsyncSession(engine) as db:
                    await embeddings.handle_embeddings_requested(
                        db, {"subject": "want", "id": str(want_id)}
                    )
                    await db.commit()

            task = asyncio.create_task(handle())
            await asyncio.wait_for(_until_lock_wait(observer), timeout=5)
            assert not task.done()
            await holder.rollback()
            await asyncio.wait_for(task, timeout=10)

        async with AsyncSession(engine) as db:
            assert await _vector(db, want_id) is not None
            assert (await _stored(db, want_id)).similar_requested_at is not None
    finally:
        await _remove(engine, seeker)


async def test_reconcileEmbeddings_fillsOnlyActiveUnexpiredWants_andRequestsSimilar(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    _, seeker = await _register(client, "GUEST", "we.reconcile@example.com")
    missing = await _want(db_session, seeker, "Rower miejski")
    stale = await _want(db_session, seeker, "Sanki")
    await _store_vector(db_session, stale, "old-model")
    lapsed = await _want(db_session, seeker, "Narty", expires_in=timedelta(days=-1))
    expired = await _want(db_session, seeker, "Łyżwy", status=WantStatus.EXPIRED)
    fulfilled = await _want(db_session, seeker, "Kask", status=WantStatus.FULFILLED)

    result = await embeddings.reconcile_embeddings(db_session, limit=300)

    assert result.filled >= 2
    assert result.misses == 0
    for want_id in (missing, stale):
        stored = await _vector(db_session, want_id)
        assert stored is not None and stored.model_id == EMBEDDING_MODEL_ID
        want = await _stored(db_session, want_id)
        assert want.similar_requested_at is not None
        assert want.match_requested_at is None
    for want_id in (lapsed, expired, fulfilled):
        assert await _vector(db_session, want_id) is None
        assert (await _stored(db_session, want_id)).similar_requested_at is None


async def test_reconcileEmbeddings_wantLockedByOtherSession_skippedWithoutFailingTick(
    engine: AsyncEngine, fake_embedder: FakeEmbedder
) -> None:
    seeker, (locked, free) = await _seed_party_wants(engine, "Rower miejski", "Sanki")
    try:
        async with engine.connect() as holder:
            await holder.execute(text(LOCK_WANT), {"id": locked})
            async with AsyncSession(engine) as db:
                result = await asyncio.wait_for(
                    embeddings.reconcile_embeddings(db, limit=300), timeout=10
                )
            await holder.rollback()

        assert result.misses == 0
        async with AsyncSession(engine) as db:
            assert await _vector(db, free) is not None
            assert await _vector(db, locked) is None
    finally:
        await _remove(engine, seeker)


@pytest.mark.parametrize(
    ("enabled", "ddl", "missing"),
    [
        (
            False,
            "ALTER TABLE wants DROP COLUMN similar_requested_at CASCADE",
            "similar_requested_at",
        ),
        (False, "DROP TABLE want_embeddings", "want_embeddings"),
        (True, "DROP TABLE want_embeddings", "want_embeddings"),
    ],
)
async def test_lifespan_migration0101Missing_refusesToStartWhateverTheFlag(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    enabled: bool,
    ddl: str,
    missing: str,
) -> None:
    @asynccontextmanager
    async def _session() -> AsyncIterator[AsyncSession]:
        yield db_session

    async def _no_poller() -> None:
        return None

    monkeypatch.setattr(settings, "embeddings_enabled", enabled)
    monkeypatch.setattr(main, "async_session_factory", _session)
    monkeypatch.setattr(outbox_scheduler, "run_forever", _no_poller)
    await db_session.execute(text(ddl))

    with pytest.raises(RuntimeError, match=f"migration 0101 .*{missing}"):
        async with main.lifespan(main.app):
            pytest.fail("the lifespan must not yield")

    assert embeddings_service.is_enabled() is False


def _db_error(sqlstate: str) -> DBAPIError:
    class _Orig(Exception):
        pass

    orig = _Orig("boom")
    orig.sqlstate = sqlstate  # type: ignore[attr-defined]
    return DBAPIError("SELECT 1", None, orig)


@pytest.mark.parametrize(
    ("error", "level"),
    [
        (_db_error("40P01"), logging.WARNING),
        (_db_error("42P01"), logging.ERROR),
        (ValueError("boom"), logging.ERROR),
    ],
)
async def test_runEmbeddingReconcile_productSideFails_loggedOnceWantSideStillRuns(
    monkeypatch: pytest.MonkeyPatch,
    fake_embedder: FakeEmbedder,
    caplog: pytest.LogCaptureFixture,
    error: Exception,
    level: int,
) -> None:
    @asynccontextmanager
    async def _session() -> AsyncIterator[None]:
        yield None

    async def _failing(*_: Any, **__: Any) -> None:
        raise error

    async def _wants(*_: Any, **__: Any) -> embeddings.ReconcileResult:
        return embeddings.ReconcileResult(filled=2, misses=1)

    monkeypatch.setattr(main, "async_session_factory", _session)
    monkeypatch.setattr(product_embeddings, "reconcile_embeddings", _failing)
    monkeypatch.setattr(embeddings, "reconcile_embeddings", _wants)
    caplog.set_level(logging.DEBUG, logger=main.__name__)

    await main._run_embedding_reconcile()

    records = [r for r in caplog.records if r.name == main.__name__]
    assert [r.levelno for r in records] == [level, logging.INFO]
    assert (records[0].exc_info is not None) is (level == logging.ERROR)
    assert "(products)" in records[0].getMessage()
    assert "products=0 wants=2 misses=1" in records[1].getMessage()


def _rename_during_embed(
    monkeypatch: pytest.MonkeyPatch, engine: AsyncEngine, want_id: uuid.UUID, new_name: str
) -> None:
    """While the embed runs, another connection takes the want's lock
    without waiting (so the caller holds none) and renames it."""

    async def _embed(names: list[str], **_: Any) -> list[list[float]]:
        async with engine.begin() as conn:
            await conn.execute(text(f"{LOCK_WANT} NOWAIT"), {"id": want_id})
            await conn.execute(
                text("UPDATE wants SET name = :name WHERE id = :id"),
                {"id": want_id, "name": new_name},
            )
        return [fake_unit_vector(f"zapytanie: {name}") for name in names]

    monkeypatch.setattr(embeddings_acl, "embed_queries", _embed)


async def test_handleEmbeddingsRequested_renamedWhileEmbedding_raisesWithoutStaleVector(
    engine: AsyncEngine, fake_embedder: FakeEmbedder, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeker, (want_id,) = await _seed_party_wants(engine, "Rower miejski")
    _rename_during_embed(monkeypatch, engine, want_id, "Sanki")
    try:
        async with AsyncSession(engine) as db:
            with pytest.raises(RuntimeError, match="renamed"):
                await embeddings.handle_embeddings_requested(
                    db, {"subject": "want", "id": str(want_id)}
                )
            await db.commit()

        async with AsyncSession(engine) as db:
            assert await _vector(db, want_id) is None
            assert (await _stored(db, want_id)).similar_requested_at is None
    finally:
        await _remove(engine, seeker)


async def test_reconcileEmbeddings_wantRenamedMidBatch_skipped_restStoredWithoutLockDuringEmbed(
    engine: AsyncEngine, fake_embedder: FakeEmbedder, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeker, (renamed, kept) = await _seed_party_wants(engine, "Rower miejski", "Sanki")
    _rename_during_embed(monkeypatch, engine, renamed, "Narty")
    try:
        async with AsyncSession(engine) as db:
            result = await embeddings.reconcile_embeddings(db, limit=2)

        assert result == embeddings.ReconcileResult(filled=1, misses=0)
        async with AsyncSession(engine) as db:
            assert await _vector(db, renamed) is None
            assert (await _stored(db, renamed)).similar_requested_at is None
            assert await _holds(db, kept, "zapytanie: Sanki")
            assert (await _stored(db, kept)).similar_requested_at is not None
    finally:
        await _remove(engine, seeker)


async def test_reconcileEmbeddings_wantExpiredMidBatch_skipped_requestSimilarIgnoresExpired(
    engine: AsyncEngine, fake_embedder: FakeEmbedder, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeker, (expired, kept) = await _seed_party_wants(engine, "Rower miejski", "Sanki")
    past = datetime.utcnow() - timedelta(minutes=1)

    async def _embed(names: list[str], **_: Any) -> list[list[float]]:
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE wants SET expires_at = :past WHERE id = :id"),
                {"id": expired, "past": past},
            )
        return [fake_unit_vector(f"zapytanie: {name}") for name in names]

    monkeypatch.setattr(embeddings_acl, "embed_queries", _embed)
    try:
        async with AsyncSession(engine) as db:
            result = await embeddings.reconcile_embeddings(db, limit=2)

        assert result == embeddings.ReconcileResult(filled=1, misses=0)
        async with AsyncSession(engine) as db:
            assert await _vector(db, expired) is None
            assert (await _stored(db, expired)).similar_requested_at is None
            assert (await _stored(db, kept)).similar_requested_at is not None

            await embeddings.request_similar(db, [expired], now=datetime.utcnow())
            await db.commit()
            assert (await _stored(db, expired)).similar_requested_at is None
    finally:
        await _remove(engine, seeker)


async def test_updateWant_nameEditMiss_outboxRetryStoresVectorAndRequestsSimilar_updatedAtKept(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    token, _ = await _register(client, "GUEST", "we.chain@example.com")
    want = await _create_want(client, token, "Rower miejski")
    fake_embedder.fail = True
    renamed = await client.patch(
        f"/api/wants/{want['id']}", json={"name": "Narty biegowe"}, headers=_auth(token)
    )
    assert renamed.status_code == 200, renamed.text
    assert await _vector(db_session, want["id"]) is None
    assert await _retries(db_session, want["id"]) == 1
    edited = await _stored(db_session, want["id"])
    assert edited.similar_requested_at is None

    handlers = outbox_registry.get_handlers(embeddings.EVENT_TYPE)
    registered_before = embeddings.handle_embeddings_requested in handlers
    embeddings.register()
    try:
        fake_embedder.fail = False
        await dispatch_pending(db_session, event_types=[embeddings.EVENT_TYPE])
    finally:
        if not registered_before:
            handlers.remove(embeddings.handle_embeddings_requested)

    assert fake_embedder.texts[-1] == "zapytanie: Narty biegowe"
    assert await _holds(db_session, want["id"], "zapytanie: Narty biegowe")
    after = await _stored(db_session, want["id"])
    assert after.similar_requested_at is not None
    assert (after.match_requested_at, after.updated_at) == (
        edited.match_requested_at,
        edited.updated_at,
    )
    entry = await db_session.scalar(
        select(OutboxEntry).where(OutboxEntry.event_type == embeddings.EVENT_TYPE)
    )
    assert entry is not None and entry.status == OutboxStatus.PROCESSED


async def test_writeWant_embeddingsDisabled_similarReadable_noEmbedNoRetry_nameEditDropsVector(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_embedder: FakeEmbedder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await _Owner.create(client, "we.off.o@example.com")
    token, _ = await _register(client, "GUEST", "we.off.s@example.com")
    scooter = await owner.lists("Hulajnoga trójkołowa")
    want = await _create_want(client, token, "Rower miejski")
    await seed_want_matches(db_session, want["id"], [scooter], tier=WantMatchTier.SIMILAR)
    monkeypatch.setattr(settings, "embeddings_enabled", False)
    fake_embedder.calls.clear()

    similar = await client.get(f"/api/wants/{want['id']}/similar", headers=_auth(token))
    created = await _create_want(client, token, "Sanki")
    renamed = await client.patch(
        f"/api/wants/{want['id']}", json={"name": "Rower górski"}, headers=_auth(token)
    )

    assert renamed.status_code == 200, renamed.text
    assert fake_embedder.calls == []
    assert await _vector(db_session, created["id"]) is None
    assert await _vector(db_session, want["id"]) is None
    assert await _retries(db_session, created["id"]) == 0
    assert await _retries(db_session, want["id"]) == 0
    assert (await _stored(db_session, created["id"])).match_requested_at is not None
    assert similar.status_code == 200, similar.text
    assert [card["id"] for card in similar.json()] == [str(scooter)]
