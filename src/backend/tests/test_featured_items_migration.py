"""Migrations `0113_app_settings` and `0114_featured_items`. A test that moves
the shared session database down always upgrades it back to head, so later
tests see the full schema."""

from __future__ import annotations

from typing import Any

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_personal_pickup_migration import _alembic

_FEATURED_INDEX = "ix_item_listing_preferences_owner_party_id_featured"


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        "tables": set(inspector.get_table_names()),
        "preference_columns": {
            col["name"]: col for col in inspector.get_columns("item_listing_preferences")
        },
        "preference_indexes": {
            index["name"]: index for index in inspector.get_indexes("item_listing_preferences")
        },
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        schema: dict[str, Any] = await conn.run_sync(_schema)
    await engine.dispose()
    return schema


async def test_downgradeTo0112ThenUpgradeHead_settingsAndFeaturedColumn_restored(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0112")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        below = await _read_schema(engine)

        assert "app_settings" not in below["tables"]
        assert "featured_at" not in below["preference_columns"]
        assert _FEATURED_INDEX not in below["preference_indexes"]
    finally:
        restored = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert restored.returncode == 0, restored.stderr

    schema = await _read_schema(engine)
    assert "app_settings" in schema["tables"]
    assert schema["preference_columns"]["featured_at"]["nullable"] is True
    index = schema["preference_indexes"][_FEATURED_INDEX]
    assert index["column_names"] == ["owner_party_id"]
    assert index["dialect_options"]["postgresql_where"] == "(featured_at IS NOT NULL)"
    async with engine.connect() as conn:
        rows = (await conn.execute(text("SELECT max_featured_items FROM app_settings"))).all()
    await engine.dispose()
    assert [tuple(row) for row in rows] == [(3,)]


@pytest.mark.parametrize("value", [21, -1])
async def test_appSettingsCheck_outOfRange_rejected(engine: AsyncEngine, value: int) -> None:
    async with engine.connect() as conn:
        with pytest.raises(IntegrityError, match="ck_app_settings_max_featured_items_range"):
            await conn.execute(
                text("UPDATE app_settings SET max_featured_items = :value"), {"value": value}
            )
        await conn.rollback()
        with pytest.raises(IntegrityError, match="uq_app_settings_singleton"):
            await conn.execute(
                text(
                    "INSERT INTO app_settings (id, max_featured_items, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), 3, now(), now())"
                )
            )
        await conn.rollback()
    await engine.dispose()
