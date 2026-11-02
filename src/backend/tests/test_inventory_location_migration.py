"""Migration `0075_inventory_location`. The test moves the shared session
database to 0074 and always upgrades it back to head, so later tests see the
full schema."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT

LOCATION_FK = "fk_inventories_location_id_locations"
LOCATION_INDEX = "ix_inventories_location_id"


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
        "columns": {col["name"]: col for col in inspector.get_columns("inventories")},
        "indexes": {index["name"]: index for index in inspector.get_indexes("inventories")},
        "fks": {fk["name"]: fk for fk in inspector.get_foreign_keys("inventories")},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def test_downgradeThenUpgrade_0075_roundTrips(engine: AsyncEngine, database_url: str) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0074")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        schema = await _read_schema(engine)
        assert "location_id" not in schema["columns"]
        assert "location" in schema["columns"]
        assert LOCATION_FK not in schema["fks"]
        assert LOCATION_INDEX not in schema["indexes"]
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    schema = await _read_schema(engine)
    assert schema["columns"]["location_id"]["nullable"] is True
    assert "location" in schema["columns"]
    fk = schema["fks"][LOCATION_FK]
    assert fk["constrained_columns"] == ["location_id"]
    assert fk["referred_table"] == "locations"
    assert fk["options"].get("ondelete") is None
    index = schema["indexes"][LOCATION_INDEX]
    assert index["column_names"] == ["location_id"]
    assert "location_id IS NOT NULL" in index["dialect_options"]["postgresql_where"]
