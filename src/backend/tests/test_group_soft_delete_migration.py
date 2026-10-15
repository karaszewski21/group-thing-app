"""Migration `0056_group_soft_delete`. The downgrade test moves the shared
session database to 0055 and always upgrades it back to head, so later tests
see the full schema."""

from __future__ import annotations

import os
import subprocess
import sys
from typing import Any

from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.types import DateTime

from tests.conftest import BACKEND_ROOT

FK_NAME = "fk_groups_deleted_by_party_id_parties"


def _alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )


def _schema(sync_conn: Connection) -> tuple[dict[str, Any], dict[str, Any]]:
    inspector = inspect(sync_conn)
    columns = {col["name"]: col for col in inspector.get_columns("groups")}
    foreign_keys = {fk["name"]: fk for fk in inspector.get_foreign_keys("groups")}
    return columns, foreign_keys


async def _read_schema(engine: AsyncEngine) -> tuple[dict[str, Any], dict[str, Any]]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def test_upgrade0056_addsDeletedColumnsAndFk(engine: AsyncEngine) -> None:
    columns, foreign_keys = await _read_schema(engine)

    deleted_at = columns["deleted_at"]
    assert deleted_at["nullable"] is True
    assert isinstance(deleted_at["type"], DateTime)
    assert deleted_at["type"].timezone is False

    deleted_by = columns["deleted_by_party_id"]
    assert deleted_by["nullable"] is True
    assert isinstance(deleted_by["type"], postgresql.UUID)

    fk = foreign_keys[FK_NAME]
    assert fk["constrained_columns"] == ["deleted_by_party_id"]
    assert fk["referred_table"] == "parties"
    assert fk["referred_columns"] == ["id"]


async def test_downgrade0056_dropsFkAndColumns(engine: AsyncEngine, database_url: str) -> None:
    try:
        _alembic(database_url, "downgrade", "0055")
        await engine.dispose()
        columns, foreign_keys = await _read_schema(engine)
        assert FK_NAME not in foreign_keys
        assert "deleted_at" not in columns
        assert "deleted_by_party_id" not in columns
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    columns, foreign_keys = await _read_schema(engine)
    assert FK_NAME in foreign_keys
    assert "deleted_at" in columns
    assert "deleted_by_party_id" in columns
