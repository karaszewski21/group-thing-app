"""Migrations `0103_points_tables`, `0104_points_columns` and
`0105_points_seed`. Each test moves the shared session database down and
always upgrades it back to head, so later tests see the full schema."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_personal_pickup_migration import _alembic

_POINT_TABLES = {"point_accounts", "point_transactions", "point_entries", "points_config"}
_TERM_COLUMNS = {
    "attendance_points",
    "attendance_closed_at",
    "attendance_min_present",
    "attendance_present_count",
    "attendance_rewarded",
}
_TERM_CHECKS = {"ck_terms_attendance_points_nonnegative", "ck_terms_attendance_closed"}
_OPEN_INDEX = "ix_terms_occurs_on_attendance_open"


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        "tables": set(inspector.get_table_names()),
        "categories": {col["name"] for col in inspector.get_columns("categories")},
        "items": {col["name"] for col in inspector.get_columns("inventory_items")},
        "terms": {col["name"] for col in inspector.get_columns("terms")},
        "attendances": {col["name"] for col in inspector.get_columns("term_attendances")},
        "term_indexes": {index["name"] for index in inspector.get_indexes("terms")},
        "term_checks": {check["name"] for check in inspector.get_check_constraints("terms")},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        schema: dict[str, Any] = await conn.run_sync(_schema)
    await engine.dispose()
    return schema


async def test_migration0104_downgradeTo0103AndUpgradeHead_roundTrips(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0103")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        below = await _read_schema(engine)

        assert "size_class" not in below["categories"]
        assert "points_value" not in below["items"]
        assert not _TERM_COLUMNS & below["terms"]
        assert "present_marked_at" not in below["attendances"]
        assert _OPEN_INDEX not in below["term_indexes"]
        assert not _TERM_CHECKS & below["term_checks"]
        assert below["tables"] >= _POINT_TABLES
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    head = await _read_schema(engine)
    assert "size_class" in head["categories"]
    assert "points_value" in head["items"]
    assert head["terms"] >= _TERM_COLUMNS
    assert "present_marked_at" in head["attendances"]
    assert _OPEN_INDEX in head["term_indexes"]
    assert head["term_checks"] >= _TERM_CHECKS


async def test_migration0103_downgradeTo0102AndUpgradeHead_roundTrips(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0102")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        below = await _read_schema(engine)

        assert not _POINT_TABLES & below["tables"]
        assert "size_class" not in below["categories"]
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    head = await _read_schema(engine)
    assert head["tables"] >= _POINT_TABLES
    async with engine.connect() as conn:
        indexes = set(
            (
                await conn.execute(
                    text(
                        "SELECT indexname FROM pg_indexes "
                        "WHERE tablename IN ('point_accounts', 'point_transactions', "
                        "'point_entries', 'points_config')"
                    )
                )
            ).scalars()
        )
        constraints = set(
            (
                await conn.execute(
                    text(
                        "SELECT conname FROM pg_constraint c JOIN pg_class t "
                        "ON t.oid = c.conrelid WHERE t.relname IN ('point_accounts', "
                        "'point_transactions', 'point_entries', 'points_config')"
                    )
                )
            ).scalars()
        )
    await engine.dispose()
    assert {
        "uq_point_accounts_account_type_emission",
        "uq_point_accounts_account_type_burn",
        "ix_point_transactions_party_counterparty_occurred_at",
        "ix_point_entries_account_id_transaction_id",
        "uq_points_config_singleton",
    } <= indexes
    assert {
        "pk_point_accounts",
        "pk_point_transactions",
        "pk_point_entries",
        "pk_points_config",
        "fk_point_accounts_party_id_parties",
        "ck_point_accounts_party_id_account_type",
        "uq_point_accounts_party_id_account_type",
        "fk_point_transactions_party_id_parties",
        "fk_point_transactions_counterparty_party_id_parties",
        "uq_point_transactions_type_source",
        "ck_point_transactions_counterparty",
        "ck_point_transactions_cap_month",
        "fk_point_entries_transaction_id_point_transactions",
        "fk_point_entries_account_id_point_accounts",
        "ck_point_entries_amount_nonzero",
    } <= constraints


_SEED_KEYS = (
    "party",
    "group",
    "past",
    "future",
    "user",
    "inventory",
    "root",
    "large",
    "large_leaf",
    "small",
    "medium_product",
    "large_product",
    "small_product",
    "good_medium",
    "like_new_medium",
    "fair_medium",
    "new_large",
    "poor_small",
)

_ITEM_CONDITIONS = {
    "good_medium": ("GOOD", "medium_product"),
    "like_new_medium": ("LIKE_NEW", "medium_product"),
    "fair_medium": ("FAIR", "medium_product"),
    "new_large": ("NEW", "large_product"),
    "poor_small": ("POOR", "small_product"),
}


async def _seed_at_0104(engine: AsyncEngine, ids: dict[str, uuid.UUID]) -> None:
    """A root with an unset size class, a LARGE child with a leaf inheriting
    it, a SMALL child, one item per case, and a past and a future term."""
    tag = f"m0105-{ids['user'].hex[:12]}"
    statements = [
        "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
        "VALUES (:party, 'PERSON', true, now(), now())",
        "INSERT INTO groups (id, party_id, name, created_at, updated_at) "
        "VALUES (:group, :party, :tag, now(), now())",
        "INSERT INTO terms (id, circle_group_id, occurs_on, created_at, updated_at) VALUES "
        "(:past, :group, (now() AT TIME ZONE 'Europe/Warsaw') - interval '1 day', now(), now()), "
        "(:future, :group, (now() AT TIME ZONE 'Europe/Warsaw') + interval '1 day', now(), now())",
        "INSERT INTO users (id, username, password_hash, created_at, updated_at) "
        "VALUES (:user, :tag, 'x', now(), now())",
        "INSERT INTO inventories (id, owner_user_id, inventory_type, created_at, updated_at) "
        "VALUES (:inventory, :user, 'PERSONAL', now(), now())",
        "INSERT INTO categories (id, name, sort_order, created_at, updated_at) "
        "VALUES (:root, :tag, 99, now(), now())",
        "INSERT INTO categories (id, parent_id, name, sort_order, size_class, created_at, "
        "updated_at) VALUES (:large, :root, 'duze', 1, 'LARGE', now(), now()), "
        "(:small, :root, 'male', 2, 'SMALL', now(), now())",
        "INSERT INTO categories (id, parent_id, name, sort_order, created_at, updated_at) "
        "VALUES (:large_leaf, :large, 'lisc', 1, now(), now())",
        "INSERT INTO products (id, name, sku, category_id, created_at, updated_at) VALUES "
        "(:medium_product, 'm', :tag || '-m', :root, now(), now()), "
        "(:large_product, 'l', :tag || '-l', :large_leaf, now(), now()), "
        "(:small_product, 's', :tag || '-s', :small, now(), now())",
    ]
    for item, (condition, product) in _ITEM_CONDITIONS.items():
        statements.append(
            "INSERT INTO inventory_items (id, inventory_id, owner_inventory_id, product_id, "
            f"condition, added_at, created_at, updated_at) VALUES (:{item}, :inventory, "
            f":inventory, :{product}, '{condition}', now(), now(), now())"
        )
    async with engine.begin() as conn:
        for statement in statements:
            await conn.execute(text(statement), {**ids, "tag": tag})
    await engine.dispose()


async def _cleanup_seed(engine: AsyncEngine, ids: dict[str, uuid.UUID]) -> None:
    items = ", ".join(f":{item}" for item in _ITEM_CONDITIONS)
    statements = (
        f"DELETE FROM inventory_items WHERE id IN ({items})",
        "DELETE FROM products WHERE id IN (:medium_product, :large_product, :small_product)",
        "DELETE FROM categories WHERE id = :large_leaf",
        "DELETE FROM categories WHERE id IN (:large, :small)",
        "DELETE FROM categories WHERE id = :root",
        "DELETE FROM inventories WHERE id = :inventory",
        "DELETE FROM users WHERE id = :user",
        "DELETE FROM terms WHERE id IN (:past, :future)",
        "DELETE FROM groups WHERE id = :group",
        "DELETE FROM parties WHERE id = :party",
    )
    async with engine.begin() as conn:
        for statement in statements:
            await conn.execute(text(statement), ids)
    await engine.dispose()


async def test_migration0105_upgrade_seedsAccountConfigClassesValuesAndClosesPastTerms(
    engine: AsyncEngine, database_url: str
) -> None:
    ids = {key: uuid.uuid4() for key in _SEED_KEYS}
    try:
        result = _alembic(database_url, "downgrade", "0104")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        await _seed_at_0104(engine, ids)
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    try:
        assert result.returncode == 0, result.stderr
        async with engine.connect() as conn:
            emission = (
                await conn.execute(
                    text(
                        "SELECT count(*), count(party_id) FROM point_accounts "
                        "WHERE account_type = 'EMISSION'"
                    )
                )
            ).one()
            config = (
                (
                    await conn.execute(
                        text(
                            "SELECT base_small, base_medium, base_large, multiplier_fair, "
                            "attendance_levels, attendance_monthly_cap, pair_window_days, "
                            "max_points_offers, created_at, updated_at FROM points_config"
                        )
                    )
                )
                .mappings()
                .all()
            )
            classes = dict(
                (
                    await conn.execute(
                        text(
                            "SELECT id, size_class FROM categories "
                            "WHERE id IN (:root, :large, :large_leaf, :small)"
                        ),
                        ids,
                    )
                )
                .tuples()
                .all()
            )
            item_ids = {ids[item]: item for item in _ITEM_CONDITIONS}
            values = {
                item_ids[item_id]: value
                for item_id, value in (
                    await conn.execute(
                        text("SELECT id, points_value FROM inventory_items WHERE id = ANY(:ids)"),
                        {"ids": list(item_ids)},
                    )
                ).tuples()
            }
            terms = {
                row.id: row
                for row in (
                    await conn.execute(
                        text(
                            "SELECT id, attendance_closed_at, attendance_min_present, "
                            "attendance_present_count, attendance_rewarded, attendance_points "
                            "FROM terms WHERE id IN (:past, :future)"
                        ),
                        ids,
                    )
                ).all()
            }
        await engine.dispose()

        assert tuple(emission) == (1, 0)
        assert len(config) == 1
        assert config[0]["base_small"] == 20
        assert config[0]["base_medium"] == 40
        assert config[0]["base_large"] == 60
        assert config[0]["multiplier_fair"] == Decimal("0.75")
        assert config[0]["attendance_levels"] == [0, 10, 20]
        assert config[0]["attendance_monthly_cap"] == 40
        assert config[0]["pair_window_days"] == 30
        assert config[0]["max_points_offers"] == 5
        assert config[0]["created_at"] is not None and config[0]["updated_at"] is not None
        assert classes == {
            ids["root"]: "MEDIUM",
            ids["large"]: "LARGE",
            ids["large_leaf"]: None,
            ids["small"]: "SMALL",
        }
        assert values == {
            "good_medium": 40,
            "like_new_medium": 60,
            "fair_medium": 40,
            "new_large": 60,
            "poor_small": 20,
        }
        past, future = terms[ids["past"]], terms[ids["future"]]
        assert past.attendance_closed_at is not None
        assert (
            past.attendance_rewarded,
            past.attendance_present_count,
            past.attendance_min_present,
        ) == (False, 0, 3)
        assert future.attendance_closed_at is None
        assert (
            future.attendance_rewarded,
            future.attendance_present_count,
            future.attendance_min_present,
        ) == (None, None, None)
        assert past.attendance_points == future.attendance_points == 0
    finally:
        await _cleanup_seed(engine, ids)


async def test_downgrade0105_pointTransactionsExist_refusesNamingRecovery(
    engine: AsyncEngine, database_url: str
) -> None:
    ids = {"party": uuid.uuid4(), "other": uuid.uuid4(), "transaction": uuid.uuid4()}
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                "VALUES (:party, 'PERSON', true, now(), now()), "
                "(:other, 'PERSON', true, now(), now())"
            ),
            ids,
        )
        await conn.execute(
            text(
                "INSERT INTO point_transactions (id, transaction_type, source_type, source_id, "
                "party_id, counterparty_party_id, description, occurred_at, created_at, "
                "updated_at) VALUES (:transaction, 'GIVE_FREE', 'RESERVATION', "
                "gen_random_uuid(), :party, :other, 'Rower', now(), now(), now())"
            ),
            ids,
        )
    await engine.dispose()
    try:
        refused = _alembic(database_url, "downgrade", "0104")
        await engine.dispose()

        assert refused.returncode != 0
        assert "Cannot downgrade 0105" in refused.stderr
        assert "pre-0103 dump" in refused.stderr
        assert "point_entries" in refused.stderr
        async with engine.connect() as conn:
            config_rows = (
                await conn.execute(text("SELECT count(*) FROM points_config"))
            ).scalar_one()
        await engine.dispose()
        assert config_rows == 1
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM point_transactions WHERE id = :transaction"), ids)
            await conn.execute(text("DELETE FROM parties WHERE id IN (:party, :other)"), ids)
        await engine.dispose()
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
