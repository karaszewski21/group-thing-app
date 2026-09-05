"""Product business logic: CRUD against `Product`, delegating listing to
`query_service.list_products`. `category` is a plain enum column (no
relationship to eager-load) since the standalone `Category` entity was
removed.

`delete_product` handles the FK violation raised when a product is still
referenced by an `app.circulation.InventoryItem` — mirroring the pattern
the now-removed `category/service.py` used for
`CategoryHasProductsException`.
"""

from __future__ import annotations

from typing import cast

from sqlalchemy import Select, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessConflictException, EntityNotFoundException

from . import query_service
from .models import Product, ProductCategory
from .schemas import CreateProductRequest, UpdateProductRequest


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
    category: ProductCategory | None,
    search: str | None,
    sort: str | None,
    plugin_filters: list[str] | None,
) -> list[Product]:
    return await query_service.list_products(
        db, category=category, search=search, sort=sort, plugin_filters=plugin_filters
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
        category=data.category,
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
    product.category = data.category
    await db.commit()
    return await get_product(db, product_id)


async def delete_product(db: AsyncSession, product_id: int) -> None:
    product = await get_product(db, product_id)
    await db.delete(product)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ProductHasInventoryItemsException(product_id) from exc
    await db.commit()
