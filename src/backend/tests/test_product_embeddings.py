"""Product name vectors for the SIMILAR want tier: the synchronous
best-effort writes in `app.product.service`, the `embeddings.requested`
retry handler and the reconcile sweep in `app.product.embeddings`."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import settings
from app.embeddings.service import EMBEDDING_MODEL_ID, EMBEDDINGS_REQUESTED, vector_literal
from app.outbox import registry
from app.outbox.dispatcher import dispatch_pending
from app.outbox.models import OutboxEntry, OutboxStatus
from app.product import embeddings
from app.product import service as product_service
from app.product.schemas import CreateProductRequest, UpdateProductRequest
from tests.conftest import FakeEmbedder, count_queries, fake_unit_vector, leaf_category_ids
from tests.test_search_location import KETY, _inventory, _listed_item
from tests.test_term_item_listings import _auth, _register


async def _category(client: AsyncClient) -> uuid.UUID:
    return uuid.UUID((await leaf_category_ids(client, {}))[0])


async def _create(db: AsyncSession, category_id: uuid.UUID, name: str) -> uuid.UUID:
    product = await product_service.create_product(
        db, CreateProductRequest(name=name, sku=name[:10].upper(), category_id=category_id)
    )
    return uuid.UUID(str(product.id))


async def _rename(db: AsyncSession, product_id: uuid.UUID, name: str) -> None:
    product = await product_service.get_product(db, product_id)
    await product_service.update_product(
        db,
        product_id,
        UpdateProductRequest(
            name=name,
            description=product.description,
            photo_url=product.photo_url,
            sku=product.sku,
            category_id=product.category_id,
        ),
    )


async def _vector(db: AsyncSession, product_id: uuid.UUID) -> tuple[str, str, datetime] | None:
    row = (
        await db.execute(
            text(
                "SELECT model_id, CAST(embedding AS text), updated_at"
                " FROM product_embeddings WHERE product_id = :id"
            ),
            {"id": product_id},
        )
    ).first()
    return None if row is None else (row[0], row[1], row[2])


async def _retry_rows(db: AsyncSession) -> list[OutboxEntry]:
    rows = await db.execute(
        select(OutboxEntry).where(OutboxEntry.event_type == EMBEDDINGS_REQUESTED)
    )
    return list(rows.scalars().all())


async def _same_vector(db: AsyncSession, stored: str, name: str) -> bool:
    return bool(
        await db.scalar(
            text("SELECT CAST(:a AS halfvec) = CAST(:b AS halfvec)"),
            {"a": stored, "b": vector_literal(fake_unit_vector(name))},
        )
    )


async def test_createProduct_withEmbedder_storesCurrentModelVector(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    product_id = await _create(db_session, await _category(client), "Rowerek biegowy")

    stored = await _vector(db_session, product_id)
    assert stored is not None
    assert stored[0] == EMBEDDING_MODEL_ID
    assert await _same_vector(db_session, stored[1], "Rowerek biegowy")
    assert fake_embedder.texts == ["Rowerek biegowy"]
    assert await _retry_rows(db_session) == []


async def test_getOrCreateProduct_existingProduct_callsNoEmbedder(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    category_id = await _category(client)
    created = await product_service.get_or_create_product_by_name(
        db_session, "Hulajnoga", category_id
    )
    assert await _vector(db_session, uuid.UUID(str(created.id))) is not None

    found = await product_service.get_or_create_product_by_name(
        db_session, "HULAJNOGA", category_id
    )

    assert found.id == created.id
    assert fake_embedder.texts == ["Hulajnoga"]


async def test_updateProduct_rename_reembedsAndMovesUpdatedAt(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    product_id = await _create(db_session, await _category(client), "Kask")
    before = await _vector(db_session, product_id)
    assert before is not None

    await _rename(db_session, product_id, "Kask rowerowy")
    after = await _vector(db_session, product_id)
    await _rename(db_session, product_id, "Kask rowerowy")

    assert after is not None
    assert after[2] > before[2]
    assert await _same_vector(db_session, after[1], "Kask rowerowy")
    assert fake_embedder.texts == ["Kask", "Kask rowerowy"]


async def test_updateProduct_rename_updatesProductRowBeforeVectorRow(
    client: AsyncClient,
    db_session: AsyncSession,
    engine: AsyncEngine,
    fake_embedder: FakeEmbedder,
) -> None:
    product_id = await _create(db_session, await _category(client), "Lampka")

    with count_queries(engine) as statements:
        await _rename(db_session, product_id, "Lampka nocna")

    writes = [
        statement.lstrip().split(None, 2)[:2]
        for statement in statements
        if statement.lstrip().upper().startswith(("UPDATE", "INSERT"))
    ]
    assert writes == [["UPDATE", "products"], ["INSERT", "INTO"]]
    assert "product_embeddings" in next(
        statement for statement in statements if statement.lstrip().startswith("INSERT")
    )


async def test_createProduct_failingEmbedder_commitsWithoutVectorAndOutboxRetryFills(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    handlers = registry.get_handlers(EMBEDDINGS_REQUESTED)
    registered_before = embeddings.handle_embeddings_requested in handlers
    embeddings.register()
    embeddings.register()
    assert handlers.count(embeddings.handle_embeddings_requested) == 1
    try:
        await _fail_then_retry(client, db_session, fake_embedder)
    finally:
        if not registered_before:
            handlers.remove(embeddings.handle_embeddings_requested)


async def _fail_then_retry(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    fake_embedder.fail = True

    product_id = await _create(db_session, await _category(client), "Wózek dla lalek")

    assert (await product_service.get_product(db_session, product_id)).name == "Wózek dla lalek"
    assert await _vector(db_session, product_id) is None
    [entry] = await _retry_rows(db_session)
    assert entry.payload == {"subject": "product", "id": str(product_id)}

    await dispatch_pending(db_session, event_types=[EMBEDDINGS_REQUESTED])
    await db_session.refresh(entry)
    assert (entry.status, entry.attempts) == (OutboxStatus.PENDING, 1)
    assert await _vector(db_session, product_id) is None

    fake_embedder.fail = False
    await dispatch_pending(db_session, event_types=[EMBEDDINGS_REQUESTED])
    await db_session.refresh(entry)
    assert entry.status == OutboxStatus.PROCESSED
    assert await _vector(db_session, product_id) is not None


async def test_updateProduct_renameMiss_deletesStaleVectorAndStagesRetry(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    product_id = await _create(db_session, await _category(client), "Lalka")
    fake_embedder.fail = True

    await _rename(db_session, product_id, "Miś pluszowy")

    assert (await product_service.get_product(db_session, product_id)).name == "Miś pluszowy"
    assert await _vector(db_session, product_id) is None
    assert len(await _retry_rows(db_session)) == 1


async def test_handleEmbeddingsRequested_embedsCurrentNameAndIgnoresGoneProduct(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    product_id = await _create(db_session, await _category(client), "Klocki")
    await db_session.execute(
        text("UPDATE products SET name = 'Klocki drewniane' WHERE id = :id"), {"id": product_id}
    )
    await db_session.commit()

    await embeddings.handle_embeddings_requested(
        db_session, {"subject": "product", "id": str(product_id)}
    )
    await embeddings.handle_embeddings_requested(
        db_session, {"subject": "product", "id": str(uuid.uuid4())}
    )
    await embeddings.handle_embeddings_requested(
        db_session, {"subject": "want", "id": str(product_id)}
    )

    stored = await _vector(db_session, product_id)
    assert stored is not None
    assert await _same_vector(db_session, stored[1], "Klocki drewniane")
    assert fake_embedder.texts == ["Klocki", "Klocki drewniane"]


async def _drop_vectors(db: AsyncSession, *product_ids: uuid.UUID) -> None:
    await db.execute(
        text("DELETE FROM product_embeddings WHERE product_id = ANY(:ids)"),
        {"ids": list(product_ids)},
    )
    await db.commit()


async def test_reconcile_fillsMissingAndStaleModelUpToLimitNewestFirst(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_embedder: FakeEmbedder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(embeddings, "RECONCILE_EMBED_BATCH", 1)
    category_id = await _category(client)
    oldest, stale, missing, current = [
        await _create(db_session, category_id, name)
        for name in ("Puzzle", "Piłka", "Skakanka", "Bębenek")
    ]
    await _drop_vectors(db_session, oldest, missing)
    await db_session.execute(
        text("UPDATE product_embeddings SET model_id = 'old-model' WHERE product_id = :id"),
        {"id": stale},
    )
    await db_session.commit()
    fake_embedder.calls.clear()

    result = await embeddings.reconcile_embeddings(db_session, limit=2)

    assert result == embeddings.ReconcileResult(filled=2, misses=0)
    assert fake_embedder.calls == [["Skakanka"], ["Piłka"]]
    stale_vector = await _vector(db_session, stale)
    assert stale_vector is not None and stale_vector[0] == EMBEDDING_MODEL_ID
    assert await _vector(db_session, missing) is not None
    assert await _vector(db_session, oldest) is None
    assert await _vector(db_session, current) is not None


async def test_reconcile_missedBatch_skippedForTheTickAndNextBatchFilled(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_embedder: FakeEmbedder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(embeddings, "RECONCILE_EMBED_BATCH", 1)
    category_id = await _category(client)
    older, newer = [await _create(db_session, category_id, name) for name in ("Bączek", "Jojo")]
    await _drop_vectors(db_session, older, newer)
    fake_embedder.calls.clear()
    embed = fake_embedder.embed

    def _fail_first(texts: list[str]) -> list[list[float]]:
        if not fake_embedder.calls:
            fake_embedder.calls.append(list(texts))
            raise RuntimeError("embedding failed")
        return embed(texts)

    monkeypatch.setattr(fake_embedder, "embed", _fail_first)

    result = await embeddings.reconcile_embeddings(db_session, limit=2)

    assert result == embeddings.ReconcileResult(filled=1, misses=1)
    assert fake_embedder.calls == [["Jojo"], ["Bączek"]]
    assert await _vector(db_session, newer) is None
    assert await _vector(db_session, older) is not None


async def test_reconcile_timedOutBatchLeavesEmbedderBusy_endsTheTick(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_embedder: FakeEmbedder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(embeddings, "RECONCILE_EMBED_BATCH", 1)
    monkeypatch.setattr(embeddings, "RECONCILE_EMBED_TIMEOUT_SECONDS", 0.05)
    category_id = await _category(client)
    older, newer = [await _create(db_session, category_id, name) for name in ("Bańki", "Kredki")]
    await _drop_vectors(db_session, older, newer)
    fake_embedder.calls.clear()
    fake_embedder.delay = threading.Event()

    result = await embeddings.reconcile_embeddings(db_session, limit=2)

    assert result == embeddings.ReconcileResult(filled=0, misses=1)
    assert fake_embedder.calls == [["Kredki"]]
    assert await _vector(db_session, newer) is None
    assert await _vector(db_session, older) is None


async def _listed_product(
    client: AsyncClient, db: AsyncSession, email: str, name: str
) -> tuple[str, uuid.UUID, uuid.UUID]:
    """A listed item of a new product, as `(token, item_id, product_id)`."""
    token, _ = await _register(client, "GUEST", email)
    item_id = uuid.UUID(
        await _listed_item(client, token, await _inventory(client, token), name, KETY)
    )
    product_id = await db.scalar(
        text("SELECT product_id FROM inventory_items WHERE id = :id"), {"id": item_id}
    )
    return token, item_id, uuid.UUID(str(product_id))


async def _put_name(
    client: AsyncClient, db: AsyncSession, token: str, product_id: uuid.UUID, name: str
) -> None:
    product = await product_service.get_product(db, product_id)
    response = await client.put(
        f"/api/products/{product_id}",
        json={"name": name, "sku": "SIM-1", "category_id": str(product.category_id)},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text


async def _listing_row(db: AsyncSession, item_id: uuid.UUID) -> Any:
    return (
        await db.execute(
            text(
                "SELECT changed_at, name_folded, model_id FROM matchable_listings"
                " WHERE item_id = :id"
            ),
            {"id": item_id},
        )
    ).one()


async def test_putProduct_rename_reembedsAndMovesListingChangedAt(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    token, item_id, product_id = await _listed_product(
        client, db_session, "pe.put.rename@example.com", "Rowerek biegowy"
    )
    before = await _listing_row(db_session, item_id)
    assert before.model_id == EMBEDDING_MODEL_ID

    await _put_name(client, db_session, token, product_id, "Hulajnoga trójkołowa")

    stored = await _vector(db_session, product_id)
    after = await _listing_row(db_session, item_id)
    assert stored is not None
    assert await _same_vector(db_session, stored[1], "Hulajnoga trójkołowa")
    assert fake_embedder.texts[-1] == "Hulajnoga trójkołowa"
    assert after.changed_at == stored[2] > before.changed_at
    assert after.name_folded == "hulajnoga trojkolowa"
    assert await _retry_rows(db_session) == []


async def test_putProduct_renameWhileEmbeddingsDisabled_dropsVectorStagesNothingStaysListed(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_embedder: FakeEmbedder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    token, item_id, product_id = await _listed_product(
        client, db_session, "pe.put.disabled@example.com", "Klocki drewniane"
    )
    assert await _vector(db_session, product_id) is not None
    monkeypatch.setattr(settings, "embeddings_enabled", False)
    fake_embedder.calls.clear()

    await _put_name(client, db_session, token, product_id, "Klocki magnetyczne")

    assert fake_embedder.calls == []
    assert await _vector(db_session, product_id) is None
    assert await _retry_rows(db_session) == []
    assert (await _listing_row(db_session, item_id)).model_id is None


def _rename_during_embed(
    monkeypatch: pytest.MonkeyPatch, db: AsyncSession, product_id: uuid.UUID, new_name: str
) -> None:
    """The embed renames the product, as a rename committed between the
    unlocked read and the lock would."""

    async def _embed(names: list[str], **_: Any) -> list[list[float]]:
        await db.execute(
            text("UPDATE products SET name = :name WHERE id = :id"),
            {"id": product_id, "name": new_name},
        )
        return [fake_unit_vector(name) for name in names]

    monkeypatch.setattr(embeddings, "embed_listings", _embed)


async def test_handleEmbeddingsRequested_renamedWhileEmbedding_raisesWithoutStaleVector(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_embedder: FakeEmbedder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    product_id = await _create(db_session, await _category(client), "Klocki")
    await _drop_vectors(db_session, product_id)
    _rename_during_embed(monkeypatch, db_session, product_id, "Klocki drewniane")

    with pytest.raises(RuntimeError, match="renamed"):
        await embeddings.handle_embeddings_requested(
            db_session, {"subject": "product", "id": str(product_id)}
        )

    assert await _vector(db_session, product_id) is None


async def test_reconcile_productRenamedMidBatch_skippedAndRestFilled(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_embedder: FakeEmbedder,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    category_id = await _category(client)
    renamed, kept = [await _create(db_session, category_id, name) for name in ("Bączek", "Jojo")]
    await _drop_vectors(db_session, renamed, kept)
    _rename_during_embed(monkeypatch, db_session, renamed, "Bączek drewniany")

    result = await embeddings.reconcile_embeddings(db_session, limit=2)

    assert result == embeddings.ReconcileResult(filled=1, misses=0)
    assert await _vector(db_session, renamed) is None
    stored = await _vector(db_session, kept)
    assert stored is not None and await _same_vector(db_session, stored[1], "Jojo")


async def test_reconcile_embedsAtMostOneSmallBatchPerWorkerCall(
    client: AsyncClient, db_session: AsyncSession, fake_embedder: FakeEmbedder
) -> None:
    """A write's embed queues behind at most one reconcile call on the single
    worker, so a call stays at `RECONCILE_EMBED_BATCH` = 8 names (~0.1 s)."""
    category_id = await _category(client)
    product_ids = [await _create(db_session, category_id, f"Zabawka {n}") for n in range(9)]
    await _drop_vectors(db_session, *product_ids)
    fake_embedder.calls.clear()

    result = await embeddings.reconcile_embeddings(db_session, limit=9)

    assert result == embeddings.ReconcileResult(filled=9, misses=0)
    assert [len(call) for call in fake_embedder.calls] == [8, 1]
