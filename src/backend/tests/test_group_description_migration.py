"""Migration `0085_group_description`. The round-trip test downgrades the
shared session database to 0084 and always upgrades it back to head, so later
tests see the full schema."""

from __future__ import annotations

from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_organization_page_layout_migration import _alembic


def _group_columns(sync_conn: Connection) -> dict[str, Any]:
    return {col["name"]: col for col in inspect(sync_conn).get_columns("groups")}


async def _read(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_group_columns)


async def test_migration0085_downgradeUpgrade_roundTrip(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0084")
        await engine.dispose()
        assert "description" not in await _read(engine)
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    column = (await _read(engine))["description"]
    assert column["nullable"] is True
    assert str(column["type"]) == "TEXT"
