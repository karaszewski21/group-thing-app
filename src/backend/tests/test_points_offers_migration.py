"""Migration `0109_points_offers`. Each test moves the shared session
database down and always upgrades it back to head, so later tests see the
full schema."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_personal_pickup_migration import _alembic

_CONFIG_COLUMNS = {"price_min_ratio", "price_max_ratio", "price_cap", "price_step"}
_PREFERENCE_CHECKS = {
    "ck_item_listing_preferences_points_price",
    "ck_item_listing_preferences_points_price_positive",
}
_BURN_INDEX = "uq_point_accounts_account_type_burn"


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        "config": {col["name"]: col["default"] for col in inspector.get_columns("points_config")},
        "preferences": {col["name"] for col in inspector.get_columns("item_listing_preferences")},
        "preference_checks": {
            check["name"] for check in inspector.get_check_constraints("item_listing_preferences")
        },
        "account_uniques": {
            unique["name"] for unique in inspector.get_unique_constraints("point_accounts")
        },
        "account_indexes": {index["name"] for index in inspector.get_indexes("point_accounts")},
        "account_check": next(
            check["sqltext"]
            for check in inspector.get_check_constraints("point_accounts")
            if check["name"] == "ck_point_accounts_party_id_account_type"
        ),
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        schema: dict[str, Any] = await conn.run_sync(_schema)
        schema["system_accounts"] = dict(
            (
                await conn.execute(
                    text(
                        "SELECT account_type, count(*) FROM point_accounts "
                        "WHERE party_id IS NULL GROUP BY account_type"
                    )
                )
            )
            .tuples()
            .all()
        )
    await engine.dispose()
    return schema


async def test_migration0109_downgradeThenUpgrade_roundTrips(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0108")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        below = await _read_schema(engine)

        assert not _CONFIG_COLUMNS & below["config"].keys()
        assert "points_price" not in below["preferences"]
        assert not _PREFERENCE_CHECKS & below["preference_checks"]
        assert "uq_point_accounts_party_id" in below["account_uniques"]
        assert "uq_point_accounts_party_id_account_type" not in below["account_uniques"]
        assert _BURN_INDEX not in below["account_indexes"]
        assert "BURN" not in below["account_check"]
        assert below["system_accounts"] == {"EMISSION": 1}
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    head = await _read_schema(engine)
    assert head["config"].keys() >= _CONFIG_COLUMNS
    assert all(head["config"][column] is None for column in _CONFIG_COLUMNS)
    assert "points_price" in head["preferences"]
    assert head["preference_checks"] >= _PREFERENCE_CHECKS
    assert "uq_point_accounts_party_id_account_type" in head["account_uniques"]
    assert "uq_point_accounts_party_id" not in head["account_uniques"]
    assert _BURN_INDEX in head["account_indexes"]
    assert "HELD" in head["account_check"] and "BURN" in head["account_check"]
    assert head["system_accounts"] == {"EMISSION": 1, "BURN": 1}


async def test_migration0109_head_seedsOneBurnAccountAndConfigDefaults(
    engine: AsyncEngine,
) -> None:
    async with engine.connect() as conn:
        burn = (
            await conn.execute(
                text(
                    "SELECT count(*), count(party_id), count(created_at), count(updated_at) "
                    "FROM point_accounts WHERE account_type = 'BURN'"
                )
            )
        ).one()
        config = (
            await conn.execute(
                text(
                    "SELECT price_min_ratio, price_max_ratio, price_cap, price_step "
                    "FROM points_config"
                )
            )
        ).one()
    await engine.dispose()

    assert tuple(burn) == (1, 0, 1, 1)
    assert tuple(config) == (Decimal("0.50"), Decimal("1.50"), 100, 10)


_SEED_STATEMENTS: dict[str, tuple[str, ...]] = {
    "transaction": (
        "INSERT INTO point_transactions (id, transaction_type, source_type, source_id, "
        "party_id, counterparty_party_id, description, occurred_at, created_at, updated_at) "
        "VALUES (:row, 'HOLD', 'RESERVATION', gen_random_uuid(), :party, :other, 'Rower', "
        "now(), now(), now())",
    ),
    "preference": (
        "INSERT INTO item_listing_preferences (id, item_id, owner_party_id, mode, "
        "points_price, created_at, updated_at) "
        "VALUES (:row, gen_random_uuid(), :party, 'POINTS', 40, now(), now())",
    ),
    "reservation": (
        "INSERT INTO users (id, username, password_hash, created_at, updated_at) "
        "VALUES (:user, :tag, 'x', now(), now())",
        "INSERT INTO inventories (id, owner_user_id, inventory_type, created_at, updated_at) "
        "VALUES (:inventory, :user, 'PERSONAL', now(), now())",
        "INSERT INTO categories (id, name, sort_order, created_at, updated_at) "
        "VALUES (:category, :tag, 99, now(), now())",
        "INSERT INTO products (id, name, sku, category_id, created_at, updated_at) "
        "VALUES (:product, 'Rower', :tag, :category, now(), now())",
        "INSERT INTO inventory_items (id, inventory_id, owner_inventory_id, product_id, "
        "condition, added_at, created_at, updated_at) "
        "VALUES (:item, :inventory, :inventory, :product, 'GOOD', now(), now(), now())",
        "INSERT INTO reservations (id, item_id, reservation_type, reserved_by_user_id, "
        "giver_user_id, reserved_at, status, created_at, updated_at) "
        "VALUES (:row, :item, 'POINTS', :user, :user, now(), 'PENDING', now(), now())",
    ),
}

_CLEANUP_STATEMENTS: dict[str, tuple[str, ...]] = {
    "transaction": ("DELETE FROM point_transactions WHERE id = :row",),
    "preference": ("DELETE FROM item_listing_preferences WHERE id = :row",),
    "reservation": (
        "DELETE FROM reservations WHERE id = :row",
        "DELETE FROM inventory_items WHERE id = :item",
        "DELETE FROM products WHERE id = :product",
        "DELETE FROM categories WHERE id = :category",
        "DELETE FROM inventories WHERE id = :inventory",
        "DELETE FROM users WHERE id = :user",
    ),
}

_EXPECTED_COUNTS = {
    "transaction": "1 HOLD/SALE/RELEASE point transactions",
    "preference": "1 POINTS listing preferences",
    "reservation": "1 POINTS reservations",
}


@pytest.mark.parametrize("case", ["transaction", "preference", "reservation"])
async def test_migration0109_downgradeWithPointsData_refuses(
    engine: AsyncEngine, database_url: str, case: str
) -> None:
    keys = ("row", "party", "other", "user", "inventory", "category", "product", "item")
    ids: dict[str, Any] = {key: uuid.uuid4() for key in keys}
    ids["tag"] = f"m0109-{ids['row'].hex[:12]}"
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                "VALUES (:party, 'PERSON', true, now(), now()), "
                "(:other, 'PERSON', true, now(), now())"
            ),
            ids,
        )
        for statement in _SEED_STATEMENTS[case]:
            await conn.execute(text(statement), ids)
    await engine.dispose()
    try:
        refused = _alembic(database_url, "downgrade", "0108")
        await engine.dispose()

        assert refused.returncode != 0
        assert "Cannot downgrade 0109" in refused.stderr
        assert _EXPECTED_COUNTS[case] in refused.stderr
        assert "restore the pre-0109 dump" in refused.stderr
        async with engine.connect() as conn:
            burn_rows = (
                await conn.execute(
                    text("SELECT count(*) FROM point_accounts WHERE account_type = 'BURN'")
                )
            ).scalar_one()
        await engine.dispose()
        assert burn_rows == 1
    finally:
        async with engine.begin() as conn:
            for statement in _CLEANUP_STATEMENTS[case]:
                await conn.execute(text(statement), ids)
            await conn.execute(text("DELETE FROM parties WHERE id IN (:party, :other)"), ids)
        await engine.dispose()
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
