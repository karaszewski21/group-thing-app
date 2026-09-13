"""Category business logic: CRUD against `Category`, plus a `sort_order`
reordering operation (`move_category`).

`delete_category` handles the FK violation raised when a category is still
referenced by an `app.product.Product` row — mirroring the pattern
`app.product.service.ProductHasInventoryItemsException` uses for its own
FK-violation case.

Reaches `products.category_id` via a lightweight ad-hoc Core `table(...)`
reference (`_products` below), never `app.product.models.Product` — see
`models.py`'s module docstring for why that ORM model can't be relied on
here.
"""

from __future__ import annotations

from typing import Literal

from sqlalchemy import Select, column, func, select, table
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessConflictException, EntityNotFoundException

from .models import Category
from .schemas import (
    CategoryResponse,
    CreateCategoryRequest,
    UpdateCategoryRequest,
    category_response_from,
)

# Ad-hoc Core reference to the `products` table — only the 2 columns this
# module actually needs (`id` unused directly but kept for clarity/future
# use, `category_id` for the aggregation/count queries below).
_products = table("products", column("id"), column("category_id"))


class CategoryHasProductsException(BusinessConflictException):
    """Raised when deleting a category still referenced by at least one
    `app.product.Product` row. Mirrors `app.product.service.
    ProductHasInventoryItemsException`."""

    def __init__(self, category_id: int, product_count: int) -> None:
        super().__init__(
            f"Category with id {category_id} cannot be deleted because it has "
            f"{product_count} associated product(s)"
        )


def _category_select() -> Select[tuple[Category]]:
    return select(Category)


async def _get_category_entity(db: AsyncSession, category_id: int) -> Category:
    result = await db.execute(_category_select().where(Category.id == category_id))
    category = result.scalar_one_or_none()
    if category is None:
        raise EntityNotFoundException("Category", category_id)
    return category


async def _count_products(db: AsyncSession, category_id: int) -> int:
    result = await db.execute(
        select(func.count()).select_from(_products).where(_products.c.category_id == category_id)
    )
    return int(result.scalar_one())


async def list_categories(db: AsyncSession) -> list[CategoryResponse]:
    """Single aggregated `LEFT JOIN`/`GROUP BY` against `products.
    category_id` per `standards/backend/queries.md` — not one count query
    per category (no N+1)."""
    counts_subquery = (
        select(_products.c.category_id, func.count().label("product_count"))
        .group_by(_products.c.category_id)
        .subquery()
    )
    result = await db.execute(
        select(Category, func.coalesce(counts_subquery.c.product_count, 0))
        .outerjoin(counts_subquery, counts_subquery.c.category_id == Category.id)
        .order_by(Category.sort_order)
    )
    return [category_response_from(category, int(count)) for category, count in result.all()]


async def get_category(db: AsyncSession, category_id: int) -> CategoryResponse:
    category = await _get_category_entity(db, category_id)
    count = await _count_products(db, category_id)
    return category_response_from(category, count)


async def create_category(db: AsyncSession, data: CreateCategoryRequest) -> CategoryResponse:
    max_sort_order = (await db.execute(select(func.max(Category.sort_order)))).scalar_one()
    next_sort_order = 0 if max_sort_order is None else max_sort_order + 1
    category = Category(name=data.name, description=data.description, sort_order=next_sort_order)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category_response_from(category, 0)


async def update_category(
    db: AsyncSession, category_id: int, data: UpdateCategoryRequest
) -> CategoryResponse:
    category = await _get_category_entity(db, category_id)
    category.name = data.name
    category.description = data.description
    await db.commit()
    await db.refresh(category)
    count = await _count_products(db, category_id)
    return category_response_from(category, count)


async def delete_category(db: AsyncSession, category_id: int) -> None:
    category = await _get_category_entity(db, category_id)
    await db.delete(category)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        product_count = await _count_products(db, category_id)
        raise CategoryHasProductsException(category_id, product_count) from exc
    await db.commit()


async def move_category(
    db: AsyncSession, category_id: int, direction: Literal["up", "down"]
) -> None:
    """Swaps `sort_order` with the adjacent row in current order — one
    flush/commit covers both updates, so the swap is atomic. A no-op (not
    an error) when `category_id` is already at the boundary in that
    direction."""
    category = await _get_category_entity(db, category_id)
    if direction == "up":
        comparison = Category.sort_order < category.sort_order
        order_by = Category.sort_order.desc()
    else:
        comparison = Category.sort_order > category.sort_order
        order_by = Category.sort_order.asc()

    neighbor = (
        await db.execute(_category_select().where(comparison).order_by(order_by).limit(1))
    ).scalar_one_or_none()
    if neighbor is None:
        return

    category.sort_order, neighbor.sort_order = neighbor.sort_order, category.sort_order
    await db.commit()
