"""Migration `0102_item_owner_inventory`. Each test moves the shared session
database down to 0101 and always upgrades it back to head, so later tests
see the full schema."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_personal_pickup_migration import _alembic

_KEYS = (
    "user",
    "owner",
    "borrower",
    "virtual",
    "virtual_account",
    "category",
    "product",
    "lent",
    "home",
    "home_balance",
)


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        "items": {col["name"] for col in inspector.get_columns("inventory_items")},
        "balances": {col["name"] for col in inspector.get_columns("inventory_balances")},
        "indexes": {index["name"] for index in inspector.get_indexes("inventories")},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def _seed(engine: AsyncEngine, ids: dict[str, uuid.UUID]) -> None:
    """At head: one item lent from `owner` to `borrower` and one at home."""
    statements = (
        "INSERT INTO users (id, username, password_hash, created_at, updated_at) "
        "VALUES (:user, :tag, 'x', now(), now())",
        "INSERT INTO inventories (id, owner_user_id, inventory_type, created_at, updated_at) "
        "VALUES (:owner, :user, 'PERSONAL', now(), now()), "
        "(:borrower, :user, 'PICKUP_POINT', now(), now())",
        "INSERT INTO categories (id, name, sort_order, created_at, updated_at) "
        "VALUES (:category, :tag, 99, now(), now())",
        "INSERT INTO products (id, name, sku, category_id, created_at, updated_at) "
        "VALUES (:product, 'm0102', :tag, :category, now(), now())",
        "INSERT INTO inventory_items (id, inventory_id, owner_inventory_id, product_id, "
        "condition, added_at, created_at, updated_at) VALUES "
        "(:lent, :borrower, :owner, :product, 'GOOD', now(), now(), now()), "
        "(:home, :owner, :owner, :product, 'GOOD', now(), now(), now())",
    )
    async with engine.begin() as conn:
        for statement in statements:
            await conn.execute(text(statement), {**ids, "tag": f"m0102-{ids['user'].hex[:12]}"})
    await engine.dispose()


async def _cleanup(engine: AsyncEngine, ids: dict[str, uuid.UUID]) -> None:
    statements = (
        "DELETE FROM inventory_balances WHERE item_id IN (:lent, :home)",
        "DELETE FROM inventory_items WHERE id IN (:lent, :home)",
        "DELETE FROM products WHERE id = :product",
        "DELETE FROM categories WHERE id = :category",
        "DELETE FROM accounts WHERE inventory_id IN (:owner, :borrower, :virtual)",
        "DELETE FROM inventories WHERE id IN (:owner, :borrower, :virtual)",
        "DELETE FROM users WHERE id = :user",
    )
    async with engine.begin() as conn:
        for statement in statements:
            await conn.execute(text(statement), ids)
    await engine.dispose()


async def _add_virtual_inventory(engine: AsyncEngine, ids: dict[str, uuid.UUID]) -> None:
    """At 0101: an old-model VIRTUAL inventory with its ledger account."""
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO inventories (id, owner_user_id, inventory_type, created_at, "
                "updated_at) VALUES (:virtual, :user, 'VIRTUAL', now(), now())"
            ),
            ids,
        )
        await conn.execute(
            text(
                "INSERT INTO accounts (id, account_type, inventory_id, created_at, updated_at) "
                "VALUES (:virtual_account, 'INVENTORY', :virtual, now(), now())"
            ),
            ids,
        )
    await engine.dispose()


async def test_migration0102_downgradeUpgrade_mapsOwnerAndDropsLoanLeftovers(
    engine: AsyncEngine, database_url: str
) -> None:
    ids = {key: uuid.uuid4() for key in _KEYS}
    await _seed(engine, ids)
    try:
        result = _alembic(database_url, "downgrade", "0101")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        below = await _read_schema(engine)
        async with engine.begin() as conn:
            homes = dict(
                (
                    await conn.execute(
                        text(
                            "SELECT id, home_inventory_id FROM inventory_items "
                            "WHERE id IN (:lent, :home)"
                        ),
                        ids,
                    )
                )
                .tuples()
                .all()
            )
            await conn.execute(
                text(
                    "INSERT INTO inventory_balances (id, item_id, status, created_at, updated_at) "
                    "VALUES (:home_balance, :home, 'RETURNED', now(), now())"
                ),
                ids,
            )
        await engine.dispose()
        await _add_virtual_inventory(engine, ids)

        assert "home_inventory_id" in below["items"]
        assert "owner_inventory_id" not in below["items"]
        assert {"lent_at", "returned_at"} <= below["balances"]
        assert "uq_inventories_owner_type_personal_virtual" in below["indexes"]
        assert homes == {ids["lent"]: ids["owner"], ids["home"]: None}
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    try:
        assert result.returncode == 0, result.stderr
        head = await _read_schema(engine)
        async with engine.connect() as conn:
            owners = dict(
                (
                    await conn.execute(
                        text(
                            "SELECT id, owner_inventory_id FROM inventory_items "
                            "WHERE id IN (:lent, :home)"
                        ),
                        ids,
                    )
                )
                .tuples()
                .all()
            )
            balance = (
                await conn.execute(
                    text("SELECT status FROM inventory_balances WHERE id = :home_balance"), ids
                )
            ).scalar_one()
            virtuals = (
                await conn.execute(
                    text("SELECT count(*) FROM inventories WHERE inventory_type = 'VIRTUAL'")
                )
            ).scalar_one()
        await engine.dispose()

        assert owners == {ids["lent"]: ids["owner"], ids["home"]: ids["owner"]}
        assert balance == "AVAILABLE"
        assert virtuals == 0
        assert "home_inventory_id" not in head["items"]
        assert not {"lent_at", "returned_at"} & head["balances"]
        assert "uq_inventories_owner_user_id_personal" in head["indexes"]
        assert "uq_inventories_owner_type_personal_virtual" not in head["indexes"]
    finally:
        await _cleanup(engine, ids)


async def test_upgrade0102_virtualInventoryHoldingItem_refusesNamingRecovery(
    engine: AsyncEngine, database_url: str
) -> None:
    ids = {key: uuid.uuid4() for key in _KEYS}
    await _seed(engine, ids)
    try:
        result = _alembic(database_url, "downgrade", "0101")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        await _add_virtual_inventory(engine, ids)
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE inventory_items SET inventory_id = :virtual WHERE id = :lent"), ids
            )
        await engine.dispose()

        refused = _alembic(database_url, "upgrade", "0102")
        await engine.dispose()

        assert refused.returncode != 0
        assert "VIRTUAL inventories still hold items" in refused.stderr
        assert "Return those items to their owners" in refused.stderr
    finally:
        async with engine.begin() as conn:
            await conn.execute(
                text("UPDATE inventory_items SET inventory_id = :owner WHERE id = :lent"), ids
            )
        await engine.dispose()
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()
        await _cleanup(engine, ids)
