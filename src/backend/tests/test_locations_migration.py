"""Migrations `0057_locations` and `0058_group_term_location_capacity`. The
test moves the shared session database to 0056 (so 0058's downgrade must run
before 0057 drops the table) and always upgrades it back to head, so later
tests see the full schema."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT

GROUP_FK = "fk_groups_default_location_id_locations"
TERM_FK = "fk_terms_location_id_locations"
LOCATION_INDEXES = {"ix_locations_owner_party_id", "uq_locations_owner_party_id_google_place_id"}


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
    has_locations = inspector.has_table("locations")
    return {
        "has_locations": has_locations,
        "location_indexes": (
            {index["name"] for index in inspector.get_indexes("locations")}
            if has_locations
            else set()
        ),
        "group_columns": {col["name"] for col in inspector.get_columns("groups")},
        "term_columns": {col["name"] for col in inspector.get_columns("terms")},
        "group_fks": {fk["name"]: fk for fk in inspector.get_foreign_keys("groups")},
        "term_fks": {fk["name"]: fk for fk in inspector.get_foreign_keys("terms")},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def test_migration_downgradeTo0056AndUpgradeHead_succeeds(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0056")
        await engine.dispose()
        schema = await _read_schema(engine)
        assert schema["has_locations"] is False
        assert {"default_location_id", "default_capacity"}.isdisjoint(schema["group_columns"])
        assert {"location_id", "capacity"}.isdisjoint(schema["term_columns"])
        assert GROUP_FK not in schema["group_fks"]
        assert TERM_FK not in schema["term_fks"]
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    schema = await _read_schema(engine)
    assert schema["has_locations"] is True
    assert schema["location_indexes"] >= LOCATION_INDEXES
    assert {"default_location_id", "default_capacity"} <= schema["group_columns"]
    assert {"location_id", "capacity"} <= schema["term_columns"]
    group_fk = schema["group_fks"][GROUP_FK]
    assert group_fk["constrained_columns"] == ["default_location_id"]
    assert group_fk["referred_table"] == "locations"
    term_fk = schema["term_fks"][TERM_FK]
    assert term_fk["constrained_columns"] == ["location_id"]
    assert term_fk["referred_table"] == "locations"
