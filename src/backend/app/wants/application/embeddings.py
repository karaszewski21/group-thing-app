"""The want vectors in `want_embeddings` (not ORM-mapped, written in SQL):
the store the seeker's writes use, the `embeddings.requested` outbox handler
that fills a vector a write missed, and the reconcile sweep that fills
missing and stale-model vectors of ACTIVE wants. Both background paths
embed without a lock, then lock the want only to check that the name is
unchanged and write.

A background fill asks the matcher for a SIMILAR-only run through
`similar_requested_at`, never `match_requested_at`, so no lexical pair is
stored born seen behind the seeker's back. It is a Core update of the
table, so `updated_at` (the version column) stays and a concurrent seeker
edit is not turned into a 409."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, cast

from sqlalchemy import Select, Table, column, select, table, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..domain.status import WantStatus
from ..infrastructure import embeddings_acl, outbox_acl
from ..models import Want

EVENT_TYPE = embeddings_acl.EMBEDDINGS_REQUESTED
SUBJECT = "want"
RECONCILE_EMBED_BATCH = embeddings_acl.RECONCILE_EMBED_BATCH
ReconcileResult = embeddings_acl.ReconcileResult

__all__ = [
    "EVENT_TYPE",
    "RECONCILE_EMBED_BATCH",
    "ReconcileResult",
    "delete_vector",
    "handle_embeddings_requested",
    "reconcile_embeddings",
    "register",
    "request_similar",
    "stage_retry",
    "store_or_stage",
    "upsert_vector",
]

_UPSERT = text(
    "INSERT INTO want_embeddings (want_id, model_id, embedding, updated_at) "
    "VALUES (:want_id, :model_id, CAST(:embedding AS halfvec), :now) "
    "ON CONFLICT (want_id) DO UPDATE SET model_id = EXCLUDED.model_id, "
    "embedding = EXCLUDED.embedding, updated_at = EXCLUDED.updated_at"
)
_want_embeddings = table("want_embeddings", column("want_id"), column("model_id"))
_wants = cast(Table, Want.__table__)


def _upsert_params(want_id: uuid.UUID, vector: list[float], now: datetime) -> dict[str, Any]:
    return {
        "want_id": want_id,
        "model_id": embeddings_acl.EMBEDDING_MODEL_ID,
        "embedding": embeddings_acl.vector_literal(vector),
        "now": now,
    }


async def upsert_vector(
    db: AsyncSession, want_id: uuid.UUID, vector: list[float], *, now: datetime
) -> None:
    await db.execute(_UPSERT, _upsert_params(want_id, vector, now))


async def delete_vector(db: AsyncSession, want_id: uuid.UUID) -> None:
    await db.execute(text("DELETE FROM want_embeddings WHERE want_id = :id"), {"id": want_id})


async def stage_retry(db: AsyncSession, want_id: uuid.UUID) -> None:
    """Nothing is staged while embeddings are off; the sweep fills the
    vector once they are on."""
    if embeddings_acl.is_enabled():
        await outbox_acl.append(
            db, event_type=EVENT_TYPE, payload={"subject": SUBJECT, "id": want_id}
        )


async def store_or_stage(
    db: AsyncSession,
    want_id: uuid.UUID,
    vectors: list[list[float]] | None,
    *,
    now: datetime,
    replaces: bool = False,
) -> None:
    """The write path's outcome of one embed. On a miss a vector of the old
    name (`replaces`) is deleted, so a stale meaning is never matched."""
    if vectors is not None:
        await upsert_vector(db, want_id, vectors[0], now=now)
        return
    if replaces:
        await delete_vector(db, want_id)
    await stage_retry(db, want_id)


async def request_similar(db: AsyncSession, want_ids: list[uuid.UUID], *, now: datetime) -> None:
    await db.execute(
        update(_wants)
        .where(
            _wants.c.id.in_(want_ids),
            _wants.c.status == WantStatus.ACTIVE,
            _wants.c.expires_at > now,
        )
        .values(similar_requested_at=now)
    )


def register() -> None:
    """Idempotent against the registry's actual state, as `bells_due.register`."""
    if handle_embeddings_requested not in outbox_acl.get_handlers(EVENT_TYPE):
        outbox_acl.register_handler(EVENT_TYPE, handle_embeddings_requested)


def _names(want_ids: list[uuid.UUID]) -> Select[Any]:
    """Id and name of the wants that are not WITHDRAWN."""
    return select(_wants.c.id, _wants.c.name).where(
        _wants.c.id.in_(want_ids), _wants.c.status != WantStatus.WITHDRAWN
    )


async def handle_embeddings_requested(db: AsyncSession, payload: dict[str, Any]) -> None:
    """Embeds the name read without a lock, then waits for the want's lock
    (never skips it, so a want held by the matcher or an edit is not read as
    gone) and writes only if the name is unchanged. A missing or WITHDRAWN
    want is a no-op; a miss or a rename in between raises so the dispatcher
    retries."""
    if payload.get("subject") != SUBJECT:
        return
    want_id = uuid.UUID(str(payload["id"]))
    async with db.begin_nested():
        if not embeddings_acl.is_enabled():
            return
        row = (await db.execute(_names([want_id]))).first()
        if row is None:
            return
        vectors = await embeddings_acl.embed_queries([row.name])
        if vectors is None:
            raise RuntimeError(f"want {want_id} was not embedded")
        locked = (await db.execute(_names([want_id]).with_for_update(key_share=True))).first()
        if locked is None:
            return
        if locked.name != row.name:
            raise RuntimeError(f"want {want_id} was renamed while embedding")
        now = datetime.utcnow()
        await upsert_vector(db, want_id, vectors[0], now=now)
        await request_similar(db, [want_id], now=now)


async def reconcile_embeddings(db: AsyncSession, *, limit: int = 300) -> ReconcileResult:
    """Fills the vectors of ACTIVE, unexpired wants that have none or one of
    another model, newest first, at most `limit` attempted, in batches of
    `RECONCILE_EMBED_BATCH`. A batch is read and embedded without a lock;
    its rows are then locked `FOR NO KEY UPDATE OF wants SKIP LOCKED` and
    only those still ACTIVE, unexpired and with an unchanged name are stored and asked for a SIMILAR
    run, in one commit. Rows held elsewhere or renamed meanwhile wait for a
    later tick. A missed batch is skipped for the rest of the tick; a busy
    embedder ends the tick. The caller checks `is_enabled()`."""
    filled = misses = attempted = 0
    skipped: list[uuid.UUID] = []
    while attempted < limit and not embeddings_acl.is_busy():
        statement = (
            select(_wants.c.id, _wants.c.name)
            .select_from(
                _wants.outerjoin(_want_embeddings, _want_embeddings.c.want_id == _wants.c.id)
            )
            .where(
                _wants.c.status == WantStatus.ACTIVE,
                _wants.c.expires_at > datetime.utcnow(),
                (_want_embeddings.c.want_id.is_(None))
                | (_want_embeddings.c.model_id != embeddings_acl.EMBEDDING_MODEL_ID),
            )
            .order_by(_wants.c.created_at.desc(), _wants.c.id.desc())
            .limit(min(RECONCILE_EMBED_BATCH, limit - attempted))
        )
        if skipped:
            statement = statement.where(_wants.c.id.not_in(skipped))
        rows = (await db.execute(statement)).all()
        await db.rollback()
        if not rows:
            break
        attempted += len(rows)
        skipped.extend(row.id for row in rows)
        vectors = await embeddings_acl.embed_queries(
            [row.name for row in rows], timeout=embeddings_acl.RECONCILE_EMBED_TIMEOUT_SECONDS
        )
        if vectors is None:
            misses += len(rows)
            continue
        now = datetime.utcnow()
        locked = (
            _names([row.id for row in rows])
            .where(_wants.c.status == WantStatus.ACTIVE, _wants.c.expires_at > now)
            .with_for_update(key_share=True, skip_locked=True, of=_wants)
        )
        current = {row.id: row.name for row in await db.execute(locked)}
        fresh = [
            (row.id, vector)
            for row, vector in zip(rows, vectors, strict=True)
            if current.get(row.id) == row.name
        ]
        if fresh:
            await db.execute(_UPSERT, [_upsert_params(id_, vector, now) for id_, vector in fresh])
            await request_similar(db, [id_ for id_, _ in fresh], now=now)
        await db.commit()
        filled += len(fresh)
    return ReconcileResult(filled=filled, misses=misses)
