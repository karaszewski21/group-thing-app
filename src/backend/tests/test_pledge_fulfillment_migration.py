"""Migration 0063 (pledge fulfillment removed). The test moves the shared
session database to 0062 and always upgrades it back to head, so later tests
see the full schema."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT

_COLUMN = "resolved_reservation_id"


def _alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )


def _pledge_schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        "columns": {col["name"]: col for col in inspector.get_columns("pledges")},
        "fk_columns": {
            column
            for fk in inspector.get_foreign_keys("pledges")
            for column in fk["constrained_columns"]
        },
        "indexed_columns": {
            column for index in inspector.get_indexes("pledges") for column in index["column_names"]
        },
    }


async def _read_pledge_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_pledge_schema)


async def test_downgrade0062_restoresResolvedReservationId_upgradeHeadDropsIt(
    engine: AsyncEngine, database_url: str
) -> None:
    party_id = uuid.uuid4()
    try:
        _alembic(database_url, "downgrade", "0062")
        await engine.dispose()
        schema = await _read_pledge_schema(engine)
        column = schema["columns"][_COLUMN]
        assert isinstance(column["type"], UUID)
        assert column["nullable"] is True
        assert _COLUMN not in schema["fk_columns"]
        assert _COLUMN not in schema["indexed_columns"]

        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                    "VALUES (:id, 'PERSON', true, now(), now())"
                ),
                {"id": party_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO notifications (party_id, kind, message, created_at, updated_at) "
                    "VALUES (:party_id, 'PLEDGE_ITEM_REGISTERED', 'x', now(), now()), "
                    "(:party_id, 'PLEDGE_CREATED', 'y', now(), now())"
                ),
                {"party_id": party_id},
            )
        await engine.dispose()
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    schema = await _read_pledge_schema(engine)
    assert _COLUMN not in schema["columns"]
    async with engine.begin() as conn:
        kinds = await conn.execute(
            text("SELECT kind FROM notifications WHERE party_id = :party_id"),
            {"party_id": party_id},
        )
        assert [row.kind for row in kinds] == ["PLEDGE_CREATED"]
        await conn.execute(
            text("DELETE FROM notifications WHERE party_id = :party_id"), {"party_id": party_id}
        )
        await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": party_id})
    await engine.dispose()
