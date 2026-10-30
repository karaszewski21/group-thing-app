"""Migration `0072_event_party_indexes`. The round-trip test moves the shared
session database to 0071 and always upgrades it back to head, so later tests
see the full schema."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT

AUTHOR_INDEX = "ix_events_author_party_id"
ATTENDANCE_INDEX = "ix_event_attendances_party_id"


def _alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )


def _indexes(sync_conn: Connection) -> dict[str, dict[str, Any]]:
    inspector = inspect(sync_conn)
    return {
        str(index["name"]): dict(index)
        for table in ("events", "event_attendances")
        for index in inspector.get_indexes(table)
    }


async def _read_indexes(engine: AsyncEngine) -> dict[str, dict[str, Any]]:
    async with engine.connect() as conn:
        return await conn.run_sync(_indexes)


async def test_downgradeTo0071ThenUpgradeHead_succeeds(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0071")
        await engine.dispose()
        assert {AUTHOR_INDEX, ATTENDANCE_INDEX}.isdisjoint(await _read_indexes(engine))
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    indexes = await _read_indexes(engine)
    author = indexes[AUTHOR_INDEX]
    assert not author["unique"]
    assert author["column_names"] == ["author_party_id"]
    attendance = indexes[ATTENDANCE_INDEX]
    assert not attendance["unique"]
    assert attendance["column_names"] == ["party_id"]
    assert "withdrawn_at IS NULL" in attendance["dialect_options"]["postgresql_where"]
