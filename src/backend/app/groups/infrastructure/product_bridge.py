"""Anti-corruption layer over `app.product`: the ONLY `app.groups` module
that imports the product vertical for a *write-path* dependency.
`application/terms` validates a `NeededItem.product_id` through this thin
pass-through so an unknown id fails fast as a clean 404 rather than an FK
`IntegrityError` (wrong-semantics 409). The read-side product join lives in
`infrastructure/repository` (the `UserProfile` precedent).

The photo-moderation reads (`has_unmoderated_photos`,
`product_ids_with_unmoderated_photos`,
`list_product_ids_with_unmoderated_photos`) back the publish gate, the
"Moje rzeczy" pending flag and the one-time withdraw cleanup script.
`first_approved_photo_by_product` backs the organizer page and term page
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
    "has_unmoderated_photos",
    "list_product_ids_with_unmoderated_photos",
    "product_ids_with_unmoderated_photos",
]


async def get_product(db: AsyncSession, product_id: uuid.UUID) -> Product:
    return await product_service.get_product(db, product_id)


async def has_unmoderated_photos(db: AsyncSession, product_id: uuid.UUID) -> bool:
    """FOR SHARE on the product row, serializing with a concurrent upload —
    see `app.product.service.has_unmoderated_photos`."""
    return await product_service.has_unmoderated_photos(db, product_id)


async def product_ids_with_unmoderated_photos(
    db: AsyncSession, product_ids: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    return await product_service.product_ids_with_unmoderated_photos(db, product_ids)


async def first_approved_photo_by_product(
    db: AsyncSession, product_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, ProductPhoto]:
    return await product_service.first_approved_photo_by_product(db, product_ids)


async def list_product_ids_with_unmoderated_photos(db: AsyncSession) -> list[uuid.UUID]:
    return await product_service.list_product_ids_with_unmoderated_photos(db)
