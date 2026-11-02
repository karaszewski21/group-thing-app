"""Migration `0076_item_listing_visibility`. The round-trip test moves the
shared session database to 0075 and always upgrades it back to head, so later
tests see the full schema. The guarded-downgrade test commits a PRIVATE
listing preference to the real database and always deletes it again."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.conftest import BACKEND_ROOT


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


def _columns(sync_conn: Connection) -> dict[str, Any]:
    return {col["name"]: col for col in inspect(sync_conn).get_columns("item_listing_preferences")}


async def _read_columns(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_columns)


async def test_downgradeThenUpgrade_0076_roundTrips(engine: AsyncEngine, database_url: str) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0075")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        assert "visibility" not in await _read_columns(engine)
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    column = (await _read_columns(engine))["visibility"]
    assert column["nullable"] is False
    assert column["type"].length == 10
    assert "PUBLIC" in column["default"]


async def test_downgrade0076_privateRows_refusesNamingRecovery(
    engine: AsyncEngine, database_url: str
) -> None:
    party_id, preference_id = uuid.uuid4(), uuid.uuid4()
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
                "INSERT INTO item_listing_preferences "
                "(id, item_id, owner_party_id, mode, visibility, created_at, updated_at) "
                "VALUES (:id, :item_id, :party_id, 'GIFT', 'PRIVATE', now(), now())"
            ),
            {"id": preference_id, "item_id": uuid.uuid4(), "party_id": party_id},
        )
    try:
        result = _alembic(database_url, "downgrade", "0075")

        assert result.returncode != 0
        assert "1 PRIVATE" in result.stderr
        assert "PUT /api/item-listing-preferences/{item_id}" in result.stderr
        assert "pre-0076 dump" in result.stderr
        await engine.dispose()
        assert "visibility" in await _read_columns(engine)
    finally:
        async with engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM item_listing_preferences WHERE id = :id"), {"id": preference_id}
            )
            await conn.execute(text("DELETE FROM parties WHERE id = :id"), {"id": party_id})
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
