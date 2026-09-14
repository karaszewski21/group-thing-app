"""`0025_category_reintroduction` migration + `Permission.ADMIN` tests
(implementation/spec.md Core Requirements #1-2). Verifies the seeded
`categories` reference table, the `ADMIN` permission grant to the seeded
dev `admin` account, and the `products.category_id` FK/NOT NULL schema
shape — the migration itself already ran against the test database by the
time `db_session` is available (see `conftest.py`'s `database_url` fixture,
which runs `alembic upgrade head`)."""

from __future__ import annotations

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Permission


async def test_categoriesTable_afterMigration_hasExactlyFiveSeededPolishRows(
    db_session: AsyncSession,
) -> None:
    rows = (
        await db_session.execute(
            text("SELECT name, sort_order FROM categories ORDER BY sort_order")
        )
    ).all()

    assert [(row.name, row.sort_order) for row in rows] == [
        ("Zabawka", 0),
        ("Książka", 1),
        ("Gra", 2),
        ("Ubranie", 3),
        ("Inne", 4),
    ]


def test_permissionAdmin_existsAndIsDistinctFromPluginManagement() -> None:
    assert Permission.ADMIN == "ADMIN"
    assert Permission.ADMIN != Permission.PLUGIN_MANAGEMENT


async def test_seededAdminAccount_afterMigration_hasAdminPermission(
    db_session: AsyncSession,
) -> None:
    result = (
        await db_session.execute(
            text(
                "SELECT p.permission FROM user_permissions p "
                "JOIN users u ON u.id = p.user_id "
                "WHERE u.username = 'admin'"
            )
        )
    ).scalars().all()

    assert "ADMIN" in result


async def test_productsCategoryId_afterMigration_isNotNullAndFkConstrained(
    db_session: AsyncSession,
) -> None:
    column = (
        await db_session.execute(
            text(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_name = 'products' AND column_name = 'category_id'"
            )
        )
    ).one()
    assert column.is_nullable == "NO"

    with pytest.raises(IntegrityError):
        await db_session.execute(
            text(
                "INSERT INTO products "
                "(id, name, sku, category_id, created_at, updated_at) "
                "VALUES "
                "(nextval('product_seq'), 'Invalid FK Product', 'SKU-INVALID', "
                "999999, now(), now())"
            )
        )
        await db_session.flush()
