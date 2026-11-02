"""Migration `0077_swap_proposals_listing_item_index`. The round-trip test
downgrades the shared session database to 0076 and always upgrades it back
to head, so later tests see the full schema."""

from __future__ import annotations

from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_inventory_location_migration import _alembic

INDEX_NAME = "ix_swap_proposals_listing_item_id_proposed"


def _indexes(sync_conn: Connection) -> dict[str, Any]:
    return {str(index["name"]): index for index in inspect(sync_conn).get_indexes("swap_proposals")}


async def _read_indexes(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_indexes)


async def test_migration0077_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0076")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        assert INDEX_NAME not in await _read_indexes(engine)
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    index = (await _read_indexes(engine))[INDEX_NAME]
    assert index["column_names"] == ["listing_item_id"]
    assert "PROPOSED" in index["dialect_options"]["postgresql_where"]
