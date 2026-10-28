"""Anti-corruption layer over `app.product`: the ONLY `app.groups` module
that imports the product vertical. `get_product` resolves a listed item's
product name for the term item-listing flows; needed items are plain names
and no longer reference a product.

`product_ids_with_unmoderated_photos` backs the informational "Moje rzeczy"
pending flag. `first_approved_photo_by_product` backs the organizer page and term page
thumbnails; it returns entities only, the public URL is built by the
caller."""

from __future__ import annotations

import uuid
from collections.abc import Collection

from sqlalchemy.ext.asyncio import AsyncSession

from app.product import service as product_service
from app.product.models import Product, ProductPhoto

__all__ = [
    "first_approved_photo_by_product",
    "get_product",
    "product_ids_with_unmoderated_photos",
]


async def get_product(db: AsyncSession, product_id: uuid.UUID) -> Product:
    return await product_service.get_product(db, product_id)


async def product_ids_with_unmoderated_photos(
    db: AsyncSession, product_ids: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    return await product_service.product_ids_with_unmoderated_photos(db, product_ids)


async def first_approved_photo_by_product(
    db: AsyncSession, product_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, ProductPhoto]:
    return await product_service.first_approved_photo_by_product(db, product_ids)
