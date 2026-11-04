"""Migrations `0075_inventory_location` and `0080_item_location_locality`.
The test moves the shared session database to 0074, checks the 0075 shape of
`inventories.location_id`, and always upgrades it back to head, where 0080
has replaced it with `inventory_items.location_id`."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT

INVENTORY_FK = "fk_inventories_location_id_locations"
INVENTORY_INDEX = "ix_inventories_location_id"
ITEM_FK = "fk_inventory_items_location_id_locations"
ITEM_INDEX = "ix_inventory_items_location_id"


def _alembic(database_url: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        capture_output=True,
        text=True,
    )


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        table: {
            "columns": {col["name"]: col for col in inspector.get_columns(table)},
            "indexes": {index["name"]: index for index in inspector.get_indexes(table)},
            "fks": {fk["name"]: fk for fk in inspector.get_foreign_keys(table)},
        }
        for table in ("inventories", "inventory_items")
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


def _assert_location_ref(table: dict[str, Any], fk_name: str, index_name: str) -> None:
    assert table["columns"]["location_id"]["nullable"] is True
    fk = table["fks"][fk_name]
    assert fk["constrained_columns"] == ["location_id"]
    assert fk["referred_table"] == "locations"
    assert fk["options"].get("ondelete") is None
    index = table["indexes"][index_name]
    assert index["column_names"] == ["location_id"]
    assert "location_id IS NOT NULL" in index["dialect_options"]["postgresql_where"]


async def test_migration0075And0080_downgradeUpgrade_movesLocationToItems(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0074")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        inventories = (await _read_schema(engine))["inventories"]
        assert "location_id" not in inventories["columns"]
        assert "location" in inventories["columns"]
        assert INVENTORY_FK not in inventories["fks"]
        assert INVENTORY_INDEX not in inventories["indexes"]

        result = _alembic(database_url, "upgrade", "0075")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        _assert_location_ref(
            (await _read_schema(engine))["inventories"], INVENTORY_FK, INVENTORY_INDEX
        )
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    schema = await _read_schema(engine)
    inventories, items = schema["inventories"], schema["inventory_items"]
    assert "location_id" not in inventories["columns"]
    assert "location" in inventories["columns"]
    assert INVENTORY_FK not in inventories["fks"]
    assert INVENTORY_INDEX not in inventories["indexes"]
    _assert_location_ref(items, ITEM_FK, ITEM_INDEX)
