"""Migration `0066_category_tree`. The round-trip test moves the shared
session database to 0065 and always upgrades it back to head, so later tests
see the full schema; the uniqueness tests run at head and delete their own
rows."""

from __future__ import annotations

import os
import subprocess
import sys
import uuid
from typing import Any

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from tests.conftest import BACKEND_ROOT

PARENT_FK = "fk_categories_parent_id_categories"
NEW_INDEXES = {"ix_categories_parent_id", "uq_categories_root_name"}
NEW_UNIQUES = {"uq_categories_external_id", "uq_categories_parent_id_name"}


def _alembic(database_url: str, *args: str) -> None:
    env = os.environ.copy()
    env["DATABASE_URL"] = database_url
    subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=str(BACKEND_ROOT),
        env=env,
        check=True,
    )


def _schema(sync_conn: Connection) -> dict[str, Any]:
    inspector = inspect(sync_conn)
    return {
        "columns": {col["name"] for col in inspector.get_columns("categories")},
        "fks": {fk["name"]: fk for fk in inspector.get_foreign_keys("categories")},
        "indexes": {index["name"] for index in inspector.get_indexes("categories")},
        "uniques": {uq["name"] for uq in inspector.get_unique_constraints("categories")},
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        return await conn.run_sync(_schema)


async def _insert(conn: AsyncConnection, name: str, parent_id: uuid.UUID | None) -> uuid.UUID:
    category_id = uuid.uuid4()
    await conn.execute(
        text(
            "INSERT INTO categories (id, name, parent_id, sort_order, created_at, updated_at) "
            "VALUES (:id, :name, :parent_id, 0, now(), now())"
        ),
        {"id": category_id, "name": name, "parent_id": parent_id},
    )
    return category_id


async def _delete_prefixed(engine: AsyncEngine, prefix: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text("DELETE FROM categories WHERE name LIKE :p AND parent_id IS NOT NULL"),
            {"p": f"{prefix}%"},
        )
        await conn.execute(text("DELETE FROM categories WHERE name LIKE :p"), {"p": f"{prefix}%"})


async def test_migration_downgradeTo0065AndUpgradeHead_roundTripsTree(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        _alembic(database_url, "downgrade", "0065")
        await engine.dispose()
        schema = await _read_schema(engine)
        assert {"parent_id", "external_id"}.isdisjoint(schema["columns"])
        assert PARENT_FK not in schema["fks"]
        assert NEW_INDEXES.isdisjoint(schema["indexes"])
        assert NEW_UNIQUES.isdisjoint(schema["uniques"])
        assert "uq_categories_name" in schema["uniques"]
    finally:
        _alembic(database_url, "upgrade", "head")
        await engine.dispose()

    schema = await _read_schema(engine)
    assert {"parent_id", "external_id"} <= schema["columns"]
    fk = schema["fks"][PARENT_FK]
    assert fk["constrained_columns"] == ["parent_id"]
    assert fk["referred_table"] == "categories"
    assert fk["options"].get("ondelete") == "RESTRICT"
    assert schema["indexes"] >= NEW_INDEXES
    assert schema["uniques"] >= NEW_UNIQUES
    assert "uq_categories_name" not in schema["uniques"]


async def test_insertCategory_sameNameUnderTwoParents_allowedButDuplicateSiblingFails(
    engine: AsyncEngine,
) -> None:
    prefix = f"m0066-{uuid.uuid4().hex[:8]}-"
    try:
        async with engine.begin() as conn:
            first = await _insert(conn, f"{prefix}A", None)
            second = await _insert(conn, f"{prefix}B", None)
            await _insert(conn, f"{prefix}Kurtki", first)
            await _insert(conn, f"{prefix}Kurtki", second)

        with pytest.raises(IntegrityError, match="uq_categories_parent_id_name"):
            async with engine.begin() as conn:
                await _insert(conn, f"{prefix}Kurtki", first)
    finally:
        await _delete_prefixed(engine, prefix)


async def test_insertCategory_duplicateRootName_fails(engine: AsyncEngine) -> None:
    prefix = f"m0066-{uuid.uuid4().hex[:8]}-"
    try:
        async with engine.begin() as conn:
            await _insert(conn, f"{prefix}Root", None)

        with pytest.raises(IntegrityError, match="uq_categories_root_name"):
            async with engine.begin() as conn:
                await _insert(conn, f"{prefix}Root", None)
    finally:
        await _delete_prefixed(engine, prefix)
