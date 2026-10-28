"""Migrations `0067_wipe_needed_items` and `0068_needed_item_name`. Each
test moves the shared session database down and always upgrades it back to
head, so later tests see the full schema."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT

PRODUCT_FK = "fk_needed_items_product_id_products"
PRODUCT_INDEX = "ix_needed_items_product_id"


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
    return {
        "columns": {col["name"]: col for col in inspector.get_columns("needed_items")},
        "fks": {fk["name"] for fk in inspector.get_foreign_keys("needed_items")},
        "indexes": {index["name"] for index in inspector.get_indexes("needed_items")},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def test_migration_downgradeTo0066AndUpgradeHead_replacesProductIdWithName(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0066")
        await engine.dispose()
        schema = await _read_schema(engine)
        assert "name" not in schema["columns"]
        assert schema["columns"]["product_id"]["nullable"] is False
        assert PRODUCT_FK in schema["fks"]
        assert PRODUCT_INDEX in schema["indexes"]
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    schema = await _read_schema(engine)
    assert "product_id" not in schema["columns"]
    assert PRODUCT_FK not in schema["fks"]
    assert PRODUCT_INDEX not in schema["indexes"]
    name = schema["columns"]["name"]
    assert name["nullable"] is False
    assert name["type"].length == 255


async def test_downgrade0068_withNeededItemPresent_succeeds(
    engine: AsyncEngine, database_url: str
) -> None:
    ids = {key: uuid.uuid4() for key in ("party", "group", "term", "needed_item")}
    remaining: int | None = None
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                    "VALUES (:party, 'ORGANIZATION', true, now(), now())"
                ),
                ids,
            )
            await conn.execute(
                text(
                    "INSERT INTO groups (id, party_id, name, layout_mode, visibility, "
                    "created_at, updated_at) "
                    "VALUES (:group, :party, 'm0068', 'CIRCLE', 'PUBLIC', now(), now())"
                ),
                ids,
            )
            await conn.execute(
                text(
                    "INSERT INTO terms (id, circle_group_id, occurs_on, created_at, updated_at) "
                    "VALUES (:term, :group, :occurs_on, now(), now())"
                ),
                {**ids, "occurs_on": datetime(2026, 11, 2, 18, 0)},
            )
            await conn.execute(
                text(
                    "INSERT INTO needed_items (id, term_id, name, created_at, updated_at) "
                    "VALUES (:needed_item, :term, 'Termos', now(), now())"
                ),
                ids,
            )
        await engine.dispose()

        _alembic(database_url, "downgrade", "0067")
        await engine.dispose()
        async with engine.connect() as conn:
            remaining = (
                await conn.execute(
                    text("SELECT count(*) FROM needed_items WHERE term_id = :term"), ids
                )
            ).scalar_one()
        await engine.dispose()
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM needed_items WHERE term_id = :term"), ids)
            await conn.execute(text("DELETE FROM terms WHERE id = :term"), ids)
            await conn.execute(text("DELETE FROM groups WHERE id = :group"), ids)
            await conn.execute(text("DELETE FROM parties WHERE id = :party"), ids)
        await engine.dispose()

    assert remaining == 0
