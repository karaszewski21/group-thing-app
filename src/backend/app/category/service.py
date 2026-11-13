"""Category business logic: the flat category tree (CRUD, sibling-scoped
`sort_order` reordering) and `require_leaf_category`, the leaf-only guard
product writes call.

`path_text` (the folded root-to-self path search matches against) is
computed in SQL with `fold_pl()`, never Python `fold_polish`, so it equals
migration 0092's backfill byte for byte: on create from the parent's path,
on rename for the whole subtree. `move_category` only reorders siblings.

Reaches `products.category_id` via a lightweight ad-hoc Core `table(...)`
reference (`_products` below), never `app.product.models.Product` — see
`models.py`'s module docstring for why that ORM model can't be relied on
here.
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import ColumnElement, Select, column, exists, func, literal, select, table, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessConflictException, EntityNotFoundException

from .models import Category
from .schemas import (
    CategoryResponse,
    CreateCategoryRequest,
    UpdateCategoryRequest,
    category_response_from,
)

_products = table("products", column("id"), column("category_id"))

# Refreshes `path_text` of `:category_id` and every descendant, as 0092.
_REFRESH_SUBTREE_PATH_TEXT = text(
    """
    WITH RECURSIVE subtree (id, path_text) AS (
        SELECT category.id,
               coalesce(parent.path_text || ' / ', '') || fold_pl(category.name)
        FROM categories category
        LEFT JOIN categories parent ON parent.id = category.parent_id
        WHERE category.id = :category_id
        UNION ALL
        SELECT child.id, subtree.path_text || ' / ' || fold_pl(child.name)
        FROM categories child
        JOIN subtree ON child.parent_id = subtree.id
    )
    UPDATE categories
    SET path_text = subtree.path_text
    FROM subtree
    WHERE categories.id = subtree.id
    """
)


class CategoryHasProductsException(BusinessConflictException):
    """Deleting a category that products still point at."""

    def __init__(self, name: str) -> None:
        super().__init__(f"Nie można usunąć „{name}”: kategoria ma przypisane rzeczy.")


class CategoryHasChildrenException(BusinessConflictException):
    """Deleting a category that still has subcategories."""

    def __init__(self, name: str) -> None:
        super().__init__(f"Nie można usunąć „{name}”: kategoria ma podkategorie.")


class ParentCategoryHasProductsException(BusinessConflictException):
    """Adding a child under a leaf that already holds products."""

    def __init__(self) -> None:
        super().__init__("Kategoria ma przypisane rzeczy")


class DuplicateSiblingCategoryException(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__("Kategoria o tej nazwie już istnieje na tym poziomie")


class CategoryNotLeafException(BusinessConflictException):
    """A product may only point at a category without children."""

    def __init__(self) -> None:
        super().__init__("Wybierz najbardziej szczegółową kategorię (bez podkategorii).")


def _category_select() -> Select[tuple[Category]]:
    return select(Category)


def _siblings_of(parent_id: uuid.UUID | None) -> ColumnElement[bool]:
    if parent_id is None:
        return Category.parent_id.is_(None)
    return Category.parent_id == parent_id


async def _get_category_entity(db: AsyncSession, category_id: uuid.UUID) -> Category:
    result = await db.execute(_category_select().where(Category.id == category_id))
    category = result.scalar_one_or_none()
    if category is None:
        raise EntityNotFoundException("Category", category_id)
    return category


async def _count_products(db: AsyncSession, category_id: uuid.UUID) -> int:
    result = await db.execute(
        select(func.count()).select_from(_products).where(_products.c.category_id == category_id)
    )
    return int(result.scalar_one())


async def _has_products(db: AsyncSession, category_id: uuid.UUID) -> bool:
    return bool(
        (
            await db.execute(select(exists().where(_products.c.category_id == category_id)))
        ).scalar_one()
    )


async def _has_children(db: AsyncSession, category_id: uuid.UUID) -> bool:
    return bool(
        (await db.execute(select(exists().where(Category.parent_id == category_id)))).scalar_one()
    )


async def _ensure_unique_sibling_name(
    db: AsyncSession,
    parent_id: uuid.UUID | None,
    name: str,
    exclude_id: uuid.UUID | None = None,
) -> None:
    condition = exists().where(_siblings_of(parent_id), Category.name == name)
    if exclude_id is not None:
        condition = condition.where(Category.id != exclude_id)
    if (await db.execute(select(condition))).scalar_one():
        raise DuplicateSiblingCategoryException()


def _path_text_of_new(parent_id: uuid.UUID | None, name: str) -> ColumnElement[str]:
    """SQL for a new category's `path_text`: the parent's path, `' / '` and
    its own folded name."""
    folded_name = func.fold_pl(literal(name))
    if parent_id is None:
        return folded_name
    return (
        select(Category.path_text + " / " + folded_name)
        .where(Category.id == parent_id)
        .scalar_subquery()
    )


async def require_leaf_category(db: AsyncSession, category_id: uuid.UUID) -> None:
    """404 for an unknown category, 409 for one that has children."""
    row = (
        await db.execute(
            select(Category.id, exists().where(Category.parent_id == category_id)).where(
                Category.id == category_id
            )
        )
    ).one_or_none()
    if row is None:
        raise EntityNotFoundException("Category", category_id)
    if row[1]:
        raise CategoryNotLeafException()


async def list_categories(
    db: AsyncSession, *, with_product_counts: bool = True
) -> list[CategoryResponse]:
    """Single aggregated `LEFT JOIN`/`GROUP BY` against `products.
    category_id` per `standards/backend/queries.md` — not one count query
    per category (no N+1). Without `with_product_counts` (anonymous callers)
    no aggregate runs and every `product_count` is 0."""
    if not with_product_counts:
        categories = await db.scalars(select(Category).order_by(Category.sort_order, Category.name))
        return [category_response_from(category, 0) for category in categories]
    counts_subquery = (
        select(_products.c.category_id, func.count().label("product_count"))
        .group_by(_products.c.category_id)
        .subquery()
    )
    result = await db.execute(
        select(Category, func.coalesce(counts_subquery.c.product_count, 0))
        .outerjoin(counts_subquery, counts_subquery.c.category_id == Category.id)
        .order_by(Category.sort_order, Category.name)
    )
    return [category_response_from(category, int(count)) for category, count in result.all()]


async def get_category(
    db: AsyncSession, category_id: uuid.UUID, *, with_product_count: bool = True
) -> CategoryResponse:
    category = await _get_category_entity(db, category_id)
    count = await _count_products(db, category_id) if with_product_count else 0
    return category_response_from(category, count)


async def create_category(db: AsyncSession, data: CreateCategoryRequest) -> CategoryResponse:
    if data.parent_id is not None:
        await _get_category_entity(db, data.parent_id)
        if await _has_products(db, data.parent_id):
            raise ParentCategoryHasProductsException()
    await _ensure_unique_sibling_name(db, data.parent_id, data.name)

    max_sort_order = (
        await db.execute(select(func.max(Category.sort_order)).where(_siblings_of(data.parent_id)))
    ).scalar_one()
    category = Category(
        parent_id=data.parent_id,
        name=data.name,
        description=data.description,
        sort_order=0 if max_sort_order is None else max_sort_order + 1,
        path_text=_path_text_of_new(data.parent_id, data.name),
    )
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category_response_from(category, 0)


async def update_category(
    db: AsyncSession, category_id: uuid.UUID, data: UpdateCategoryRequest
) -> CategoryResponse:
    category = await _get_category_entity(db, category_id)
    await _ensure_unique_sibling_name(db, category.parent_id, data.name, exclude_id=category_id)
    renamed = category.name != data.name
    category.name = data.name
    category.description = data.description
    if renamed:
        await db.flush()
        await db.execute(_REFRESH_SUBTREE_PATH_TEXT, {"category_id": category_id})
    await db.commit()
    await db.refresh(category)
    count = await _count_products(db, category_id)
    return category_response_from(category, count)


async def delete_category(db: AsyncSession, category_id: uuid.UUID) -> None:
    """Children are checked before products: the self-FK would otherwise
    surface as a generic integrity conflict."""
    category = await _get_category_entity(db, category_id)
    if await _has_children(db, category_id):
        raise CategoryHasChildrenException(category.name)
    if await _has_products(db, category_id):
        raise CategoryHasProductsException(category.name)
    await db.delete(category)
    await db.commit()


async def move_category(
    db: AsyncSession, category_id: uuid.UUID, direction: Literal["up", "down"]
) -> None:
    """Swaps `sort_order` with the adjacent sibling (same `parent_id`) — one
    commit covers both updates. A no-op at the sibling boundary."""
    category = await _get_category_entity(db, category_id)
    if direction == "up":
        comparison = Category.sort_order < category.sort_order
        order_by = Category.sort_order.desc()
    else:
        comparison = Category.sort_order > category.sort_order
        order_by = Category.sort_order.asc()

    neighbor = (
        await db.execute(
            _category_select()
            .where(_siblings_of(category.parent_id), comparison)
            .order_by(order_by)
            .limit(1)
        )
    ).scalar_one_or_none()
    if neighbor is None:
        return

    category.sort_order, neighbor.sort_order = neighbor.sort_order, category.sort_order
    await db.commit()
