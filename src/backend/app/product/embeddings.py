"""The product side of the SIMILAR want tier: one name vector per product
in `product_embeddings`, the `embeddings.requested` retry handler and the
reconcile sweep. The table is unmapped and written in `sa.text`.

The handler and the sweep embed without a lock, then lock the product
`FOR NO KEY UPDATE` (never `FOR UPDATE`, so an item insert's KEY SHARE lock
on `products` is never blocked) only to check the name and upsert. A vector
upsert moves `updated_at` and with it `matchable_listings.changed_at`, so
the matcher's window reads the listing again."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Select, String, column, or_, select, table, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.embeddings.service import (
    EMBEDDING_MODEL_ID,
    EMBEDDINGS_REQUESTED,
    RECONCILE_EMBED_BATCH,
    RECONCILE_EMBED_TIMEOUT_SECONDS,
    ReconcileResult,
    embed_listings,
    is_busy,
    is_enabled,
    vector_literal,
)
from app.outbox import registry as outbox_registry
from app.outbox import service as outbox_service

from .models import Product

SUBJECT = "product"

__all__ = [
    "EMBEDDINGS_REQUESTED",
    "ReconcileResult",
    "handle_embeddings_requested",
    "reconcile_embeddings",
    "register",
    "save_name_vector",
]

_product_embeddings = table(
    "product_embeddings",
    column("product_id", postgresql.UUID(as_uuid=True)),
    column("model_id", String),
    column("updated_at", DateTime),
)

_UPSERT = text(
    """
    INSERT INTO product_embeddings (product_id, model_id, embedding, updated_at)
    VALUES (:product_id, :model_id, CAST(:embedding AS halfvec), :now)
    ON CONFLICT (product_id) DO UPDATE
    SET model_id = EXCLUDED.model_id,
        embedding = EXCLUDED.embedding,
        updated_at = EXCLUDED.updated_at
    """
)
_DELETE = text("DELETE FROM product_embeddings WHERE product_id = :product_id")


def _upsert_params(product_id: uuid.UUID, vector: list[float], now: datetime) -> dict[str, Any]:
    return {
        "product_id": product_id,
        "model_id": EMBEDDING_MODEL_ID,
        "embedding": vector_literal(vector),
        "now": now,
    }


async def upsert_vector(
    db: AsyncSession, product_id: uuid.UUID, vector: list[float], *, now: datetime
) -> None:
    await db.execute(_UPSERT, _upsert_params(product_id, vector, now))


async def delete_vector(db: AsyncSession, product_id: uuid.UUID) -> None:
    await db.execute(_DELETE, {"product_id": product_id})


async def stage_retry(db: AsyncSession, product_id: uuid.UUID) -> None:
    """Nothing is staged while embeddings are off; the sweep fills the
    vector once they are on."""
    if is_enabled():
        await outbox_service.append(
            db, event_type=EMBEDDINGS_REQUESTED, payload={"subject": SUBJECT, "id": product_id}
        )


async def save_name_vector(
    db: AsyncSession,
    product_id: uuid.UUID,
    vectors: list[list[float]] | None,
    *,
    renamed: bool,
) -> None:
    """Stores the vector of a just-written name in the caller's commit. On a
    miss a renamed product loses its stale vector and a retry is staged."""
    if vectors is not None:
        await upsert_vector(db, product_id, vectors[0], now=datetime.utcnow())
        return
    if renamed:
        await delete_vector(db, product_id)
    await stage_retry(db, product_id)


def register() -> None:
    """Idempotent against the registry's actual state, as
    `app.wants.application.bells_due.register`."""
    if handle_embeddings_requested not in outbox_registry.get_handlers(EMBEDDINGS_REQUESTED):
        outbox_registry.register_handler(EMBEDDINGS_REQUESTED, handle_embeddings_requested)


def _locked_names(product_ids: list[uuid.UUID], *, skip_locked: bool) -> Select[Any]:
    return (
        select(Product.id, Product.name)
        .where(Product.id.in_(product_ids))
        .with_for_update(key_share=True, skip_locked=skip_locked, of=Product)
    )


async def handle_embeddings_requested(db: AsyncSession, payload: dict[str, Any]) -> None:
    """Embeds the product's current name read without a lock, then waits for
    the row lock (never SKIP LOCKED, so a product held by a rename is not
    taken for gone) and stores the vector only if the name is unchanged. A
    miss or a rename in between raises so the dispatcher retries. Runs in a
    savepoint because the dispatcher commits after a failing handler too."""
    if payload.get("subject") != SUBJECT:
        return
    product_id = uuid.UUID(str(payload["id"]))
    async with db.begin_nested():
        if not is_enabled():
            return
        name = await db.scalar(select(Product.name).where(Product.id == product_id))
        if name is None:
            return
        vectors = await embed_listings([name])
        if vectors is None:
            raise RuntimeError(f"Embedding of product {product_id} missed")
        locked = (await db.execute(_locked_names([product_id], skip_locked=False))).first()
        if locked is None:
            return
        if locked.name != name:
            raise RuntimeError(f"Product {product_id} was renamed while embedding")
        await upsert_vector(db, product_id, vectors[0], now=datetime.utcnow())


async def reconcile_embeddings(db: AsyncSession, *, limit: int = 300) -> ReconcileResult:
    """Fills missing and stale-model vectors, newest products first, in
    batches of `RECONCILE_EMBED_BATCH`. A batch is read and embedded without
    a lock; its rows are then locked `FOR NO KEY UPDATE SKIP LOCKED` and
    only those whose name is unchanged are stored, in one commit. Rows held
    elsewhere or renamed meanwhile wait for a later tick. A missed batch is
    skipped for the rest of the tick; a busy embedder ends the tick. Stops
    after `limit` products attempted. The caller checks `is_enabled()`."""
    filled = misses = attempted = 0
    skipped: list[uuid.UUID] = []
    while attempted < limit and not is_busy():
        statement = (
            select(Product.id, Product.name)
            .outerjoin(_product_embeddings, _product_embeddings.c.product_id == Product.id)
            .where(
                or_(
                    _product_embeddings.c.product_id.is_(None),
                    _product_embeddings.c.model_id != EMBEDDING_MODEL_ID,
                )
            )
            .order_by(Product.created_at.desc(), Product.id.desc())
            .limit(min(RECONCILE_EMBED_BATCH, limit - attempted))
        )
        if skipped:
            statement = statement.where(Product.id.not_in(skipped))
        rows = (await db.execute(statement)).all()
        await db.rollback()
        if not rows:
            break
        attempted += len(rows)
        skipped.extend(row.id for row in rows)
        vectors = await embed_listings(
            [row.name for row in rows], timeout=RECONCILE_EMBED_TIMEOUT_SECONDS
        )
        if vectors is None:
            misses += len(rows)
            continue
        locked = await db.execute(_locked_names([row.id for row in rows], skip_locked=True))
        current = {row.id: row.name for row in locked}
        now = datetime.utcnow()
        fresh = [
            _upsert_params(row.id, vector, now)
            for row, vector in zip(rows, vectors, strict=True)
            if current.get(row.id) == row.name
        ]
        if fresh:
            await db.execute(_UPSERT, fresh)
        await db.commit()
        filled += len(fresh)
    return ReconcileResult(filled=filled, misses=misses)
