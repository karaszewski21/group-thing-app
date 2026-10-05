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

import asyncio
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, cast

from sqlalchemy import DateTime, Select, column, delete, exists, func, select, table
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.config import settings
from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.moderation import rules
from app.moderation.events import PHOTO_MODERATION_REQUESTED
from app.moderation.status import ModerationStatus
from app.moderation.text_guard import TextField, check_text
from app.outbox import service as outbox_service
from app.storage.outbox_listener import OBJECTS_DELETE
from app.storage.service import ObjectStorage

from . import images, query_service
from .models import Product, ProductPhoto
from .schemas import CreateProductRequest, UpdateProductRequest

# The product description shared by every item of a product lives in
# `plugin_data[SHARED_DESCRIPTION_PLUGIN_ID][SHARED_DESCRIPTION_FIELD]`.
SHARED_DESCRIPTION_PLUGIN_ID = "ai-description"
SHARED_DESCRIPTION_FIELD = "description"


# Ad-hoc, typed Core references to `app.circulation`'s tables — never its
# ORM models (`app.product` must not depend on `app.circulation`), per
# `standards/backend/models.md`'s cross-module rule. Only the columns the
# item-owner check reads are declared.
_inventory_items = table(
    "inventory_items",
    column("product_id", postgresql.UUID(as_uuid=True)),
    column("inventory_id", postgresql.UUID(as_uuid=True)),
    column("home_inventory_id", postgresql.UUID(as_uuid=True)),
    column("deleted_at", DateTime),
)
_inventories = table(
    "inventories",
    column("id", postgresql.UUID(as_uuid=True)),
    column("owner_user_id", postgresql.UUID(as_uuid=True)),
)

NOT_ITEM_OWNER_MESSAGE = "Możesz edytować tylko produkty swoich rzeczy"


def get_shared_description(
    plugin_data: Mapping[str, Any] | None, fallback: str | None
) -> str | None:
    """The shared description when the key is present (a blank value is
    the owner's explicit "no description" and gives `None`); `fallback`
    (the admin-edited `Product.description`) only when the key is absent."""
    shared = (plugin_data or {}).get(SHARED_DESCRIPTION_PLUGIN_ID)
    if isinstance(shared, Mapping):
        value = shared.get(SHARED_DESCRIPTION_FIELD)
        if isinstance(value, str):
            return value if value.strip() else None
    return fallback


MAX_PRODUCT_PHOTOS = 10


class ProductHasInventoryItemsException(BusinessConflictException):
    """Raised when deleting a product still referenced by at least one
    `app.circulation.InventoryItem`."""

    def __init__(self, product_id: uuid.UUID) -> None:
        super().__init__(
            f"Product with id {product_id} cannot be deleted because it has "
            "associated inventory items"
        )


def _product_select() -> Select[tuple[Product]]:
    return select(Product)


async def list_products(
    db: AsyncSession,
    *,
    category_id: uuid.UUID | None,
    search: str | None,
    sort: str | None,
    plugin_filters: list[str] | None,
) -> list[Product]:
    return await query_service.list_products(
        db, category_id=category_id, search=search, sort=sort, plugin_filters=plugin_filters
    )


async def get_product(db: AsyncSession, product_id: uuid.UUID) -> Product:
    result = await db.execute(_product_select().where(Product.id == product_id))
    product = result.scalar_one_or_none()
    if product is None:
        raise EntityNotFoundException("Product", product_id)
    return product


async def create_product(db: AsyncSession, data: CreateProductRequest) -> Product:
    rules.ensure_no_contact_info(data.name, data.description)
    await check_text(TextField.PRODUCT_NAME, data.name)
    await check_text(TextField.PRODUCT_DESCRIPTION, data.description)
    product = Product(
        name=data.name,
        description=data.description,
        photo_url=data.photo_url,
        sku=data.sku,
        category_id=data.category_id,
    )
    db.add(product)
    await db.commit()
    return await get_product(db, cast(uuid.UUID, product.id))


async def update_product(
    db: AsyncSession, product_id: uuid.UUID, data: UpdateProductRequest
) -> Product:
    product = await get_product(db, product_id)
    rules.ensure_no_contact_info(data.name, data.description)
    await check_text(TextField.PRODUCT_NAME, data.name, product.name)
    await check_text(TextField.PRODUCT_DESCRIPTION, data.description, product.description)
    product.name = data.name
    product.description = data.description
    product.photo_url = data.photo_url
    product.sku = data.sku
    product.category_id = data.category_id
    await db.commit()
    return await get_product(db, product_id)


async def get_or_create_product_by_name(
    db: AsyncSession, name: str, category_id: uuid.UUID
) -> Product:
    """Resolves a freeform item name typed by a user (e.g. during
    onboarding) to an existing `Product` in the same `category_id` — matched
    case-insensitively — or creates a new one with a placeholder sku
    (`"<NAME[:10].upper()>-<epoch millis>"`) when no match exists."""
    result = await db.execute(
        _product_select().where(
            func.lower(Product.name) == name.lower(), Product.category_id == category_id
        )
    )
    product = result.scalars().first()
    if product is not None:
        return product

    rules.ensure_no_contact_info(name)
    await check_text(TextField.PRODUCT_NAME, name)
    product = Product(
        name=name,
        description=None,
        photo_url=None,
        sku=f"{name[:10].upper()}-{int(time.time() * 1000)}",
        category_id=category_id,
    )
    db.add(product)
    await db.commit()
    return await get_product(db, cast(uuid.UUID, product.id))


async def delete_product(db: AsyncSession, product_id: uuid.UUID) -> None:
    """The gallery goes with the product; a remaining inventory-item
    reference still fails the delete (and rolls the photo delete back)."""
    product = await get_product(db, product_id)
    photos = await product_photos(db, product_id)
    await db.execute(delete(ProductPhoto).where(ProductPhoto.product_id == product_id))
    await _stage_photo_files_delete(db, photos)
    await db.delete(product)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise ProductHasInventoryItemsException(product_id) from exc
    await db.commit()


async def _stage_photo_files_delete(db: AsyncSession, photos: list[ProductPhoto]) -> None:
    """Stages deletion of the photos' files in the caller's commit; the
    outbox deletes them once the rows are gone."""
    if photos:
        await outbox_service.append(
            db,
            event_type=OBJECTS_DELETE,
            payload={"keys": [key for p in photos for key in (p.large_key, p.thumb_key)]},
        )


async def _lock_product(db: AsyncSession, product_id: uuid.UUID) -> Product:
    """Row-locks the product so every photo change of one product is
    serialized: the limit, the duplicate check and the dense order hold."""
    result = await db.execute(_product_select().where(Product.id == product_id).with_for_update())
    product = result.scalar_one_or_none()
    if product is None:
        raise EntityNotFoundException("Product", product_id)
    return product


async def _find_item_owner(
    db: AsyncSession, product_id: uuid.UUID, principal: Principal
) -> uuid.UUID | None:
    """The caller's user id when they own a non-deleted item of the
    product, else `None`. Ownership is the home inventory's owner, so an
    owner keeps the right while the item is lent out."""
    user_id = (
        await db.execute(select(User.id).where(User.username == principal.username))
    ).scalar_one_or_none()
    if user_id is None:
        return None
    owning_inventory_id = func.coalesce(
        _inventory_items.c.home_inventory_id, _inventory_items.c.inventory_id
    )
    owns_item = await db.scalar(
        select(
            exists().where(
                _inventory_items.c.product_id == product_id,
                _inventory_items.c.deleted_at.is_(None),
                _inventories.c.id == owning_inventory_id,
                _inventories.c.owner_user_id == user_id,
            )
        )
    )
    return user_id if owns_item else None


async def _require_item_owner(
    db: AsyncSession, product_id: uuid.UUID, principal: Principal
) -> uuid.UUID:
    """Gallery and shared-description edits belong to owners of a
    non-deleted item of the product; returns the owner's user id."""
    user_id = await _find_item_owner(db, product_id, principal)
    if user_id is None:
        raise AccessDeniedException(NOT_ITEM_OWNER_MESSAGE)
    return user_id


async def product_photos(db: AsyncSession, product_id: uuid.UUID) -> list[ProductPhoto]:
    """The product's gallery in display order, without the product
    existence check (for read models that already hold the product id)."""
    result = await db.execute(
        select(ProductPhoto)
        .where(ProductPhoto.product_id == product_id)
        .order_by(ProductPhoto.sort_order, ProductPhoto.created_at)
    )
    return list(result.scalars().all())


@dataclass(frozen=True)
class PhotoView:
    """A gallery photo as shown to one viewer. Approved files are public on
    the CDN; others are private, so their URLs are short-lived signed links."""

    id: uuid.UUID
    url: str
    thumb_url: str
    status: ModerationStatus
    sort_order: int


def photo_view(photo: ProductPhoto, storage: ObjectStorage) -> PhotoView:
    link = (
        storage.public_url if photo.status == ModerationStatus.APPROVED else storage.presigned_url
    )
    return PhotoView(
        id=cast(uuid.UUID, photo.id),
        url=link(photo.large_key),
        thumb_url=link(photo.thumb_key),
        status=photo.status,
        sort_order=photo.sort_order,
    )


def visible_photo_views(
    photos: list[ProductPhoto], storage: ObjectStorage | None, *, is_owner: bool
) -> list[PhotoView]:
    """Owners see every photo with its moderation status; everyone else
    only approved ones. Without configured storage there is no gallery."""
    if storage is None:
        return []
    return [
        photo_view(photo, storage)
        for photo in photos
        if is_owner or photo.status == ModerationStatus.APPROVED
    ]


def _renumber(photos: list[ProductPhoto]) -> None:
    for index, photo in enumerate(photos):
        if photo.sort_order != index:
            photo.sort_order = index


async def list_product_photos(
    db: AsyncSession, product_id: uuid.UUID, principal: Principal, storage: ObjectStorage | None
) -> list[PhotoView]:
    await get_product(db, product_id)
    is_owner = await _find_item_owner(db, product_id, principal) is not None
    return visible_photo_views(await product_photos(db, product_id), storage, is_owner=is_owner)


PHOTO_UPLOAD_DISABLED_MESSAGE = "Dodawanie zdjęć jest chwilowo niedostępne"


async def add_product_photo(
    db: AsyncSession,
    product_id: uuid.UUID,
    data: bytes,
    principal: Principal,
    storage: ObjectStorage | None,
) -> PhotoView:
    """Sanitizes the upload (outside the product lock, as it is CPU work),
    stores both WebP sizes and records the photo. With moderation on, the
    files stay private and the worker is asked to score the photo. A
    rejected photo still counts as a duplicate, so it cannot be re-uploaded."""
    if storage is None:
        raise BusinessConflictException(PHOTO_UPLOAD_DISABLED_MESSAGE)
    processed = await asyncio.to_thread(images.process_upload, data)

    await _lock_product(db, product_id)
    user_id = await _require_item_owner(db, product_id, principal)
    photos = await product_photos(db, product_id)
    if any(photo.content_sha256 == processed.sha256 for photo in photos):
        raise BusinessConflictException("To zdjęcie jest już w galerii")
    if sum(photo.status != ModerationStatus.REJECTED for photo in photos) >= MAX_PRODUCT_PHOTOS:
        raise BusinessConflictException(f"Osiągnięto limit {MAX_PRODUCT_PHOTOS} zdjęć")

    photo_id = uuid.uuid4()
    approved = not settings.moderation_image_enabled
    photo = ProductPhoto(
        id=photo_id,
        product_id=product_id,
        storage_key=f"products/{product_id}/{photo_id}",
        width=processed.width,
        height=processed.height,
        size_bytes=len(processed.large),
        content_sha256=processed.sha256,
        status=ModerationStatus.APPROVED if approved else ModerationStatus.PENDING,
        uploaded_by_user_id=user_id,
        sort_order=len(photos),
    )
    await storage.put(photo.large_key, processed.large, "image/webp", public=approved)
    await storage.put(photo.thumb_key, processed.thumb, "image/webp", public=approved)
    db.add(photo)
    if not approved:
        await outbox_service.append(
            db, event_type=PHOTO_MODERATION_REQUESTED, payload={"photo_id": photo_id}
        )
    try:
        await db.commit()
    except Exception:
        await storage.delete([photo.large_key, photo.thumb_key])
        raise
    return photo_view(photo, storage)


async def remove_product_photo(
    db: AsyncSession, product_id: uuid.UUID, photo_id: uuid.UUID, principal: Principal
) -> None:
    await _lock_product(db, product_id)
    await _require_item_owner(db, product_id, principal)
    photos = await product_photos(db, product_id)
    photo = next((p for p in photos if p.id == photo_id), None)
    if photo is None:
        raise EntityNotFoundException("ProductPhoto", photo_id)
    await db.delete(photo)
    await db.flush()
    _renumber([p for p in photos if p is not photo])
    await _stage_photo_files_delete(db, [photo])
    await db.commit()


async def reorder_product_photos(
    db: AsyncSession,
    product_id: uuid.UUID,
    photo_ids: list[uuid.UUID],
    principal: Principal,
    storage: ObjectStorage | None,
) -> list[PhotoView]:
    """`photo_ids` is the owner's full gallery (every status) in the new order."""
    await _lock_product(db, product_id)
    await _require_item_owner(db, product_id, principal)
    photos = await product_photos(db, product_id)
    by_id = {cast(uuid.UUID, photo.id): photo for photo in photos}
    if len(photo_ids) != len(photos) or set(photo_ids) != set(by_id):
        raise BusinessConflictException("Lista zdjęć jest nieaktualna — odśwież stronę")
    ordered = [by_id[photo_id] for photo_id in photo_ids]
    _renumber(ordered)
    await db.commit()
    return visible_photo_views(ordered, storage, is_owner=True)


async def set_shared_description(
    db: AsyncSession, product_id: uuid.UUID, description: str | None, principal: Principal
) -> str | None:
    """Merges the shared description into
    `plugin_data[SHARED_DESCRIPTION_PLUGIN_ID]`, keeping its other fields
    and other plugins' keys. Blank stores `""` so a cleared description
    stays cleared instead of falling back to `Product.description`."""
    product = await get_product(db, product_id)
    await _require_item_owner(db, product_id, principal)
    value = (description or "").strip()
    rules.ensure_no_contact_info(value)
    await check_text(
        TextField.PRODUCT_DESCRIPTION,
        value,
        get_shared_description(product.plugin_data, product.description),
    )
    updated = dict(product.plugin_data or {})
    current = updated.get(SHARED_DESCRIPTION_PLUGIN_ID)
    shared = dict(current) if isinstance(current, Mapping) else {}
    shared[SHARED_DESCRIPTION_FIELD] = value
    updated[SHARED_DESCRIPTION_PLUGIN_ID] = shared
    product.plugin_data = updated
    await db.commit()
    return value or None
