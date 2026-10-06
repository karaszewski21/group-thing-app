"""`/api/products` routes (spec.md's API Route Spec, Product section).
Follows `app/category/router.py`'s pattern (Group 7's reference module).

Permission matrix (spec.md rows 12/19): GET -> `READ`/`mcp:read`;
POST/PUT/PATCH/DELETE -> `EDIT`/`mcp:edit` (gallery and shared description
included; those additionally require owning a non-deleted item of
the product, 403 otherwise).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups.application import term_item_listings
from app.storage.service import ObjectStorage, get_storage

from . import service
from .images import MAX_UPLOAD_BYTES
from .schemas import (
    CreateProductRequest,
    ProductDescriptionResponse,
    ProductPhotoResponse,
    ProductResponse,
    ReorderProductPhotosRequest,
    ResolveProductRequest,
    UpdateProductDescriptionRequest,
    UpdateProductRequest,
)

router = APIRouter(prefix="/api/products", tags=["products"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


@router.get("", response_model=list[ProductResponse])
async def list_products(
    db: DbSession,
    principal: ReadPrincipal,
    category_id: uuid.UUID | None = None,
    search: str | None = None,
    sort: str | None = None,
    plugin_filter: Annotated[list[str] | None, Query(alias="pluginFilter")] = None,
) -> list[ProductResponse]:
    products = await service.list_products(
        db, category_id=category_id, search=search, sort=sort, plugin_filters=plugin_filter
    )
    return [ProductResponse.model_validate(product) for product in products]


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> ProductResponse:
    product = await service.get_product(db, product_id)
    return ProductResponse.model_validate(product)


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: CreateProductRequest, db: DbSession, principal: EditPrincipal
) -> ProductResponse:
    product = await service.create_product(db, body)
    return ProductResponse.model_validate(product)


@router.post("/resolve", response_model=ProductResponse, status_code=status.HTTP_200_OK)
async def resolve_product(
    body: ResolveProductRequest, db: DbSession, principal: EditPrincipal
) -> ProductResponse:
    product = await service.get_or_create_product_by_name(db, body.name, body.category_id)
    return ProductResponse.model_validate(product)


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: uuid.UUID, body: UpdateProductRequest, db: DbSession, principal: EditPrincipal
) -> ProductResponse:
    product = await service.update_product(db, product_id, body)
    return ProductResponse.model_validate(product)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_product(product_id: uuid.UUID, db: DbSession, principal: EditPrincipal) -> None:
    await service.delete_product(db, product_id)


@router.get("/{product_id}/photos", response_model=list[ProductPhotoResponse])
async def list_product_photos(
    product_id: uuid.UUID, db: DbSession, principal: ReadPrincipal, storage: Storage
) -> list[ProductPhotoResponse]:
    photos = await service.list_product_photos(db, product_id, principal, storage)
    return [ProductPhotoResponse.model_validate(photo) for photo in photos]


@router.post(
    "/{product_id}/photos",
    response_model=ProductPhotoResponse,
    status_code=status.HTTP_201_CREATED,
)
async def add_product_photo(
    product_id: uuid.UUID,
    db: DbSession,
    principal: EditPrincipal,
    storage: Storage,
    file: Annotated[UploadFile, File()],
) -> ProductPhotoResponse:
    """Multipart upload of one image (`file`). Reads at most one byte past
    the limit, so an oversized upload is refused without buffering it all.
    A photo entering moderation withdraws the product's items from terms
    via the groups hook, injected here because `app.product` must not
    import `app.groups` (groups already imports product)."""
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    photo = await service.add_product_photo(
        db,
        product_id,
        data,
        principal,
        storage,
        on_pending_photo=term_item_listings.withdraw_product_listings,
    )
    return ProductPhotoResponse.model_validate(photo)


@router.put("/{product_id}/photos/order", response_model=list[ProductPhotoResponse])
async def reorder_product_photos(
    product_id: uuid.UUID,
    body: ReorderProductPhotosRequest,
    db: DbSession,
    principal: EditPrincipal,
    storage: Storage,
) -> list[ProductPhotoResponse]:
    photos = await service.reorder_product_photos(
        db, product_id, body.photo_ids, principal, storage
    )
    return [ProductPhotoResponse.model_validate(photo) for photo in photos]


@router.delete(
    "/{product_id}/photos/{photo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def remove_product_photo(
    product_id: uuid.UUID, photo_id: uuid.UUID, db: DbSession, principal: EditPrincipal
) -> None:
    await service.remove_product_photo(db, product_id, photo_id, principal)


@router.patch("/{product_id}/description", response_model=ProductDescriptionResponse)
async def update_product_description(
    product_id: uuid.UUID,
    body: UpdateProductDescriptionRequest,
    db: DbSession,
    principal: EditPrincipal,
) -> ProductDescriptionResponse:
    description = await service.set_shared_description(db, product_id, body.description, principal)
    return ProductDescriptionResponse(description=description)
