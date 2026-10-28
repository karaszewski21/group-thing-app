"""Migrations `0064_item_listing_status` and `0065_backfill_item_listing_
status`. Each test moves the shared session database down and always
upgrades it back to head, so later tests see the full schema."""

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


def _alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )


def _item_columns(sync_conn: Connection) -> dict[str, Any]:
    return {col["name"]: col for col in inspect(sync_conn).get_columns("inventory_items")}


async def _read_item_columns(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_item_columns)


async def test_migration_downgradeTo0063AndUpgradeHead_roundTripsListingStatus(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0063")
        await engine.dispose()
        assert "listing_status" not in await _read_item_columns(engine)
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    column = (await _read_item_columns(engine))["listing_status"]
    assert column["nullable"] is False
    assert column["type"].length == 20
    assert "DRAFT" in str(column["default"])


async def test_upgrade0065_itemWithPreference_becomesActive(
    engine: AsyncEngine, database_url: str
) -> None:
    ids = {
        key: uuid.uuid4()
        for key in ("user", "party", "inventory", "category", "product", "listed", "draft")
    }
    tag = ids["user"].hex[:12]
    statuses: dict[uuid.UUID, str] = {}
    try:
        _alembic(database_url, "downgrade", "0064")
        await engine.dispose()
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO users (id, username, password_hash, created_at, updated_at) "
                    "VALUES (:user, :tag, 'x', now(), now())"
                ),
                {**ids, "tag": f"m0065-{tag}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                    "VALUES (:party, 'PERSON', true, now(), now())"
                ),
                ids,
            )
            await conn.execute(
                text(
                    "INSERT INTO inventories "
                    "(id, owner_user_id, inventory_type, created_at, updated_at) "
                    "VALUES (:inventory, :user, 'PERSONAL', now(), now())"
                ),
                ids,
            )
            await conn.execute(
                text(
                    "INSERT INTO categories (id, name, sort_order, created_at, updated_at) "
                    "VALUES (:category, :tag, 99, now(), now())"
                ),
                {**ids, "tag": f"m0065-{tag}"},
            )
            await conn.execute(
                text(
                    "INSERT INTO products (id, name, sku, category_id, created_at, updated_at) "
                    "VALUES (:product, 'm0065', :tag, :category, now(), now())"
                ),
                {**ids, "tag": f"m0065-{tag}"},
            )
            for key in ("listed", "draft"):
                await conn.execute(
                    text(
                        "INSERT INTO inventory_items (id, inventory_id, product_id, condition, "
                        "added_at, created_at, updated_at) "
                        "VALUES (:item, :inventory, :product, 'GOOD', now(), now(), now())"
                    ),
                    {**ids, "item": ids[key]},
                )
            await conn.execute(
                text(
                    "INSERT INTO item_listing_preferences "
                    "(item_id, owner_party_id, mode, created_at, updated_at) "
                    "VALUES (:listed, :party, 'GIFT', now(), now())"
                ),
                ids,
            )
        await engine.dispose()

        _alembic(database_url, "upgrade", "0065")
        await engine.dispose()
        async with engine.connect() as conn:
            rows = await conn.execute(
                text("SELECT id, listing_status FROM inventory_items WHERE id IN (:a, :b)"),
                {"a": ids["listed"], "b": ids["draft"]},
            )
            statuses = {row.id: row.listing_status for row in rows}
        await engine.dispose()
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
        async with engine.begin() as conn:
            await conn.execute(
                text("DELETE FROM item_listing_preferences WHERE owner_party_id = :party"), ids
            )
            await conn.execute(
                text("DELETE FROM inventory_items WHERE inventory_id = :inventory"), ids
            )
            await conn.execute(text("DELETE FROM products WHERE id = :product"), ids)
            await conn.execute(text("DELETE FROM categories WHERE id = :category"), ids)
            await conn.execute(text("DELETE FROM inventories WHERE id = :inventory"), ids)
            await conn.execute(text("DELETE FROM parties WHERE id = :party"), ids)
            await conn.execute(text("DELETE FROM users WHERE id = :user"), ids)
        await engine.dispose()

    assert statuses == {ids["listed"]: "ACTIVE", ids["draft"]: "DRAFT"}
