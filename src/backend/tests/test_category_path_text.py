"""`categories.path_text`: maintained by `create_category`/`update_category`
in SQL with `fold_pl()`, byte for byte equal to the 0092 backfill."""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.category.models import Category
from app.category.schemas import CreateCategoryRequest, UpdateCategoryRequest
from app.category.service import create_category, update_category

_BACKFILL_MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "0092_backfill_categories_path_text.py"
)


def _backfill_sql() -> str:
    spec = importlib.util.spec_from_file_location("migration_0092", _BACKFILL_MIGRATION)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return str(module.BACKFILL_SQL)


async def _paths(db_session: AsyncSession, ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    rows = await db_session.execute(
        select(Category.id, Category.path_text).where(Category.id.in_(ids))
    )
    return {row.id: row.path_text for row in rows}


async def _create(db_session: AsyncSession, name: str, parent_id: uuid.UUID | None) -> uuid.UUID:
    created = await create_category(
        db_session, CreateCategoryRequest(name=name, parent_id=parent_id)
    )
    return created.id


async def _tree(db_session: AsyncSession) -> list[uuid.UUID]:
    root = await _create(db_session, "Dziecięce Ścieżki", None)
    inner = await _create(db_session, "Ubranka  ŁÓDŹ", root)
    leaf = await _create(db_session, "Kurtki zimowe", inner)
    return [root, inner, leaf]


async def _assert_matches_backfill(db_session: AsyncSession, ids: list[uuid.UUID]) -> None:
    maintained = await _paths(db_session, ids)
    await db_session.execute(text(_backfill_sql()))
    assert await _paths(db_session, ids) == maintained


async def test_createCategory_nestedTree_pathTextFoldedFromRoot(
    db_session: AsyncSession,
) -> None:
    root, inner, leaf = await _tree(db_session)

    assert await _paths(db_session, [root, inner, leaf]) == {
        root: "dzieciece sciezki",
        inner: "dzieciece sciezki / ubranka lodz",
        leaf: "dzieciece sciezki / ubranka lodz / kurtki zimowe",
    }
    await _assert_matches_backfill(db_session, [root, inner, leaf])


async def test_updateCategory_innerRename_subtreeRefreshedEqualsBackfill(
    db_session: AsyncSession,
) -> None:
    root, inner, leaf = await _tree(db_session)

    await update_category(db_session, inner, UpdateCategoryRequest(name="Odzież Ąę"))

    assert await _paths(db_session, [root, inner, leaf]) == {
        root: "dzieciece sciezki",
        inner: "dzieciece sciezki / odziez ae",
        leaf: "dzieciece sciezki / odziez ae / kurtki zimowe",
    }
    await _assert_matches_backfill(db_session, [root, inner, leaf])
