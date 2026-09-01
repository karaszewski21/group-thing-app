"""Product business logic: CRUD against `Product`, delegating listing to
`query_service.list_products`. Every read path explicitly
`.options(joinedload(Product.category))` (see `models.py`'s `lazy="raise"`
note) so `ProductResponse`'s nested `CategoryResponse` is always populated.

Unlike `category/service.py`, `delete_product` is a plain delete with no
FK-violation handling — nothing in the schema references `products` by FK,
so there is no 409 path here (spec.md's product DELETE note).
"""

from __future__ import annotations

from typing import cast

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.category.models import Category
from app.core.errors import EntityNotFoundException

from . import query_service
from .models import Product
from .schemas import CreateProductRequest, UpdateProductRequest


def _product_select() -> Select[tuple[Product]]:
    return select(Product).options(joinedload(Product.category))


async def list_products(
    db: AsyncSession,
    *,
    category: int | None,
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


async def _require_category(db: AsyncSession, category_id: int) -> None:
    category = await db.get(Category, category_id)
    if category is None:
        raise EntityNotFoundException("Category", category_id)


async def create_product(db: AsyncSession, data: CreateProductRequest) -> Product:
    await _require_category(db, data.category_id)
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
    await _require_category(db, data.category_id)
    product.name = data.name
    product.description = data.description
    product.photo_url = data.photo_url
    product.price = data.price
    product.sku = data.sku
    product.category_id = data.category_id
    await db.commit()
    return await get_product(db, product_id)


async def delete_product(db: AsyncSession, product_id: int) -> None:
    product = await get_product(db, product_id)
    await db.delete(product)
    await db.commit()
