"""Product business logic: CRUD against `Product`, delegating listing to
`query_service.list_products`. `category_id` is a plain FK-id column (no
relationship to eager-load, per `standards/backend/models.md`'s cross-module
rule) into the standalone `app.category` module's `Category` table.

`delete_product` handles the FK violation raised when a product is still
referenced by an `app.circulation.InventoryItem` — mirroring the pattern
the now-removed `category/service.py` used for
`CategoryHasProductsException`.
"""

from __future__ import annotations

import time
from decimal import Decimal
from typing import cast

from sqlalchemy import Select, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessConflictException, EntityNotFoundException

from . import query_service
from .models import Product
from .schemas import CreateProductRequest, UpdateProductRequest

# Placeholder price/sku for a Product auto-created from a freeform item
# name — mirrors the exact client-side synthesis previously in
# `PanelPage.tsx:401-410` (`price: 0.01`, `sku: "<NAME[:10].upper()>-
# <epoch millis>"`), moved server-side so the client no longer needs to
# fabricate these values itself.
_PLACEHOLDER_PRICE = Decimal("0.01")


class ProductHasInventoryItemsException(BusinessConflictException):
    """Raised when deleting a product still referenced by at least one
    `app.circulation.InventoryItem`."""

    def __init__(self, product_id: int) -> None:
        super().__init__(
            f"Product with id {product_id} cannot be deleted because it has "
            "associated inventory items"
        )


def _product_select() -> Select[tuple[Product]]:
    return select(Product)


async def list_products(
    db: AsyncSession,
    *,
    category_id: int | None,
    search: str | None,
    sort: str | None,
    plugin_filters: list[str] | None,
) -> list[Product]:
    return await query_service.list_products(
        db, category_id=category_id, search=search, sort=sort, plugin_filters=plugin_filters
    )


async def get_product(db: AsyncSession, product_id: int) -> Product:
    result = await db.execute(_product_select().where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if product is None:
        raise EntityNotFoundException("Product", product_id)
    return product


async def create_product(db: AsyncSession, data: CreateProductRequest) -> Product:
    product = Product(
        name=data.name,
        description=data.description,
        photo_url=data.photo_url,
        price=data.price,
        sku=data.sku,
        category_id=data.category_id,
    )
    db.add(product)
    await db.commit()
    return await get_product(db, cast(int, product.id))


async def update_product(db: AsyncSession, product_id: int, data: UpdateProductRequest) -> Product:
    product = await get_product(db, product_id)
    product.name = data.name
    product.description = data.description
    product.photo_url = data.photo_url
    product.price = data.price
    product.sku = data.sku
    product.category_id = data.category_id
    await db.commit()
    return await get_product(db, product_id)


async def get_or_create_product_by_name(
    db: AsyncSession, name: str, category_id: int
) -> Product:
    """Resolves a freeform item name typed by a user (e.g. during
    onboarding) to an existing `Product` in the same `category_id` — matched
    case-insensitively — or creates a new one with a placeholder price/sku
    when no match exists. See `_PLACEHOLDER_PRICE` docstring above for the
    provenance of the placeholder values."""
    result = await db.execute(
        _product_select().where(
            func.lower(Product.name) == name.lower(), Product.category_id == category_id
        )
    )
    product = result.scalars().first()
    if product is not None:
        return product

    product = Product(
        name=name,
        description=None,
        photo_url=None,
        price=_PLACEHOLDER_PRICE,
        sku=f"{name[:10].upper()}-{int(time.time() * 1000)}",
        category_id=category_id,
    )
    db.add(product)
    await db.commit()
    return await get_product(db, cast(int, product.id))


async def delete_product(db: AsyncSession, product_id: int) -> None:
    product = await get_product(db, product_id)
    await db.delete(product)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ProductHasInventoryItemsException(product_id) from exc
    await db.commit()
