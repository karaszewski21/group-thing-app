"""Migration `0053_terms_circle_occurs_on_index`. The round-trip test
downgrades the shared session database to 0052 and always upgrades it back
to head, so later tests see the full schema."""

from __future__ import annotations

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_organization_page_layout_migration import _alembic

INDEX_NAME = "ix_terms_circle_group_id_occurs_on"


def _indexes(sync_conn: Connection) -> dict[str, list[str | None]]:
    return {
        str(index["name"]): list(index["column_names"])
        for index in inspect(sync_conn).get_indexes("terms")
    }


async def _read_indexes(engine: AsyncEngine) -> dict[str, list[str | None]]:
    async with engine.connect() as conn:
        return await conn.run_sync(_indexes)


async def test_migration0053_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0052")
        await engine.dispose()
        indexes = await _read_indexes(engine)
        assert INDEX_NAME not in indexes
        assert "ix_terms_circle_group_id" in indexes
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    indexes = await _read_indexes(engine)
    assert indexes[INDEX_NAME] == ["circle_group_id", "occurs_on"]
    assert indexes["ix_terms_circle_group_id"] == ["circle_group_id"]
