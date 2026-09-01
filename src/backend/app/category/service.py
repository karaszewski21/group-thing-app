"""Category business logic: CRUD against `Category`, plus
`CategoryHasProductsException` — the DB FK violation on delete (a category
still referenced by `products.category_id`) translated into the exact
message spec.md requires. Reference module for the migration's service
pattern — Groups 8/9 follow this shape.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessConflictException, EntityNotFoundException

from .models import Category
from .schemas import CreateCategoryRequest, UpdateCategoryRequest


class CategoryHasProductsException(BusinessConflictException):
    """Raised when deleting a category still referenced by at least one
    product. Message is verbatim per spec.md — do not reword."""

    def __init__(self, category_id: int) -> None:
        super().__init__(
            f"Category with id {category_id} cannot be deleted because it has associated products"
        )


async def list_categories(db: AsyncSession) -> list[Category]:
    """Always sorted `created_at DESC` — no query params supported."""
    result = await db.execute(select(Category).order_by(Category.created_at.desc()))
    return list(result.scalars().all())


async def get_category(db: AsyncSession, category_id: int) -> Category:
    category = await db.get(Category, category_id)
    if category is None:
        raise EntityNotFoundException("Category", category_id)
    return category


async def create_category(db: AsyncSession, data: CreateCategoryRequest) -> Category:
    category = Category(name=data.name, description=data.description)
    db.add(category)
    await db.commit()
    await db.refresh(category)
    return category


async def update_category(
    db: AsyncSession, category_id: int, data: UpdateCategoryRequest
) -> Category:
    category = await get_category(db, category_id)
    category.name = data.name
    category.description = data.description
    await db.commit()
    await db.refresh(category)
    return category


async def delete_category(db: AsyncSession, category_id: int) -> None:
    category = await get_category(db, category_id)
    await db.delete(category)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise CategoryHasProductsException(category_id) from exc
    await db.commit()
