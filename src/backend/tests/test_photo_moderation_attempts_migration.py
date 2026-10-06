"""Migration `0049_photo_moderation_attempts`: the retry columns VPS B's
moderation cron writes on `product_photos`, plus the partial index behind its
claim query. The round-trip test downgrades the shared session database to
0048 and always upgrades it back to head, so later tests see the full
schema."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.auth.models import User
from app.category.models import Category
from app.moderation.status import ModerationStatus
from app.product.models import Product, ProductPhoto
from tests.conftest import BACKEND_ROOT

INDEX_NAME = "ix_product_photos_pending_created_at"


def _alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    columns = {col["name"]: col for col in inspector.get_columns("product_photos")}
    indexes = {ix["name"]: ix for ix in inspector.get_indexes("product_photos")}
    return {"columns": columns, "indexes": indexes}


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def _index_predicate(engine: AsyncEngine) -> str:
    async with engine.connect() as conn:
        result = await conn.exec_driver_sql(
            "SELECT pg_get_indexdef(indexrelid) FROM pg_index "
            "WHERE indexrelid = 'ix_product_photos_pending_created_at'::regclass"
        )
        return str(result.scalar_one())


async def test_migration0049_columnsAndPartialIndex_present(
    engine: AsyncEngine, db_session: AsyncSession
) -> None:
    schema = await _read_schema(engine)

    attempts = schema["columns"]["moderation_attempts"]
    assert attempts["type"].python_type is int
    assert attempts["nullable"] is False
    assert "0" in str(attempts["default"])

    retry_at = schema["columns"]["moderation_retry_at"]
    assert retry_at["nullable"] is True
    assert type(retry_at["type"]).__name__ == "TIMESTAMP"
    assert retry_at["type"].timezone is False

    index = schema["indexes"][INDEX_NAME]
    assert index["column_names"] == ["created_at", "id"]
    indexdef = await _index_predicate(engine)
    assert "WHERE" in indexdef
    assert "'PENDING'" in indexdef

    category = Category(name=f"Mig {uuid.uuid4().hex[:8]}", sort_order=99)
    db_session.add(category)
    await db_session.flush()
    product = Product(name="Puzzle", sku=f"SKU-{uuid.uuid4().hex[:8]}", category_id=category.id)
    user = User(username=f"mig-{uuid.uuid4().hex[:8]}", password_hash="x")
    db_session.add_all([product, user])
    await db_session.flush()
    photo = ProductPhoto(
        product_id=product.id,
        storage_key="products/mig/1",
        width=1600,
        height=1200,
        size_bytes=1000,
        content_sha256="c" * 64,
        status=ModerationStatus.PENDING,
        uploaded_by_user_id=user.id,
        sort_order=0,
    )
    db_session.add(photo)
    await db_session.flush()
    await db_session.refresh(photo)

    assert photo.moderation_attempts == 0
    assert photo.moderation_retry_at is None


async def test_migration0049_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0048")
        await engine.dispose()
        schema = await _read_schema(engine)
        assert "moderation_attempts" not in schema["columns"]
        assert "moderation_retry_at" not in schema["columns"]
        assert INDEX_NAME not in schema["indexes"]
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    schema = await _read_schema(engine)
    assert "moderation_attempts" in schema["columns"]
    assert "moderation_retry_at" in schema["columns"]
    assert INDEX_NAME in schema["indexes"]
