"""Read-only ACL over `app.category`: the size class an item's product
inherits. Ad-hoc Core refs for `products` and `categories`, so points imports
neither the category nor the product module."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Select, column, literal, select, table
from sqlalchemy.ext.asyncio import AsyncSession

from app.points.domain.valuation import DEFAULT_SIZE_CLASS

_products = table("products", column("id"), column("category_id"))
_categories = table("categories", column("id"), column("parent_id"), column("size_class"))


def _chain_statement(start: Select[Any]) -> Select[Any]:
    """The size classes from the `start` category up to the root, nearest
    first; the climb stops at the first category that sets one, so the
    first non-NULL row is the inherited class."""
    chain = start.cte("size_class_chain", recursive=True)
    parent = _categories.alias("parent")
    chain = chain.union_all(
        select(parent.c.parent_id, parent.c.size_class, chain.c.depth + 1)
        .join_from(chain, parent, parent.c.id == chain.c.parent_id)
        .where(chain.c.size_class.is_(None))
    )
    return select(chain.c.size_class).order_by(chain.c.size_class.is_(None), chain.c.depth).limit(1)


def size_class_statement(product_id: uuid.UUID) -> Select[Any]:
    """The nearest `size_class` from the product's category up to the root;
    NULL or no row when none in the chain sets one."""
    return _chain_statement(
        select(
            _categories.c.parent_id,
            _categories.c.size_class,
            literal(0).label("depth"),
        )
        .join_from(_products, _categories, _categories.c.id == _products.c.category_id)
        .where(_products.c.id == product_id)
    )


async def resolve_size_class(db: AsyncSession, product_id: uuid.UUID) -> str:
    size_class = (await db.execute(size_class_statement(product_id))).scalar_one_or_none()
    return DEFAULT_SIZE_CLASS if size_class is None else str(size_class)


async def resolve_category_size_class(db: AsyncSession, category_id: uuid.UUID) -> str | None:
    """The size class a product in `category_id` would inherit; `None` for
    an unknown category."""
    row = (
        await db.execute(
            _chain_statement(
                select(
                    _categories.c.parent_id,
                    _categories.c.size_class,
                    literal(0).label("depth"),
                ).where(_categories.c.id == category_id)
            )
        )
    ).first()
    if row is None:
        return None
    return DEFAULT_SIZE_CLASS if row.size_class is None else str(row.size_class)
