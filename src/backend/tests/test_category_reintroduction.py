"""`0025_category_reintroduction` migration + `Permission.ADMIN` tests
(implementation/spec.md Core Requirements #1-2). Verifies that the legacy
`categories` rows are gone at head, the `ADMIN` permission grant to the seeded
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


async def test_categoriesTable_atHead_hasNoLegacyRootRows(
    db_session: AsyncSession,
) -> None:
    """`0069_vinted_categories` replaces the 5 legacy rows seeded here with
    the Vinted tree; "Inne" survives only as a Vinted leaf name."""
    rows = (
        (
            await db_session.execute(
                text("SELECT name FROM categories WHERE parent_id IS NULL AND name = ANY(:names)"),
                {"names": ["Zabawka", "Książka", "Gra", "Ubranie", "Inne"]},
            )
        )
        .scalars()
        .all()
    )

    assert rows == []


def test_permissionAdmin_existsAndIsDistinctFromPluginManagement() -> None:
    assert Permission.ADMIN == "ADMIN"
    assert Permission.ADMIN != Permission.PLUGIN_MANAGEMENT


async def test_seededAdminAccount_afterMigration_hasAdminPermission(
    db_session: AsyncSession,
) -> None:
    result = (
        (
            await db_session.execute(
                text(
                    "SELECT p.permission FROM user_permissions p "
                    "JOIN users u ON u.id = p.user_id "
                    "WHERE u.username = 'admin'"
                )
            )
        )
        .scalars()
        .all()
    )

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
                "(gen_random_uuid(), 'Invalid FK Product', 'SKU-INVALID', "
                "gen_random_uuid(), now(), now())"
            )
        )
        await db_session.flush()
