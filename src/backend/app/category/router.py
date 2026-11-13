"""`/api/categories` routes (spec.md's API Route Spec, Category section).
Follows `app/product/router.py`'s pattern.

Permission matrix: GET -> PUBLIC (row 55; the tree also feeds the guest
search Kategoria filter); POST/PUT/DELETE/PATCH .../move -> `ADMIN` only — category
management is admin-only, unlike `app.product`'s EDIT-gated mutations.
An anonymous GET gets `product_count` 0 (the counts only gate the admin
tree's buttons and would expose per-category totals of private items) and a
shared-cacheable response; a principal gets the counts, uncached.
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import OptionalPrincipal, Principal, require_any
from app.db import get_db

from . import service
from .schemas import (
    CategoryResponse,
    CreateCategoryRequest,
    MoveCategoryRequest,
    UpdateCategoryRequest,
)

router = APIRouter(prefix="/api/categories", tags=["categories"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
AdminPrincipal = Annotated[Principal, Depends(require_any("ADMIN"))]

# The tree changes only on admin writes, so anonymous copies may be shared
# for a few minutes.
ANONYMOUS_CACHE_CONTROL = "public, max-age=60, s-maxage=300"


def _set_cache_headers(response: Response, principal: Principal | None) -> None:
    response.headers["Cache-Control"] = (
        ANONYMOUS_CACHE_CONTROL if principal is None else "private, no-store"
    )
    response.headers["Vary"] = "Authorization, Cookie"


@router.get("", response_model=list[CategoryResponse])
async def list_categories(
    db: DbSession, response: Response, principal: OptionalPrincipal = None
) -> list[CategoryResponse]:
    categories = await service.list_categories(db, with_product_counts=principal is not None)
    _set_cache_headers(response, principal)
    return categories


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: uuid.UUID, db: DbSession, response: Response, principal: OptionalPrincipal = None
) -> CategoryResponse:
    category = await service.get_category(db, category_id, with_product_count=principal is not None)
    _set_cache_headers(response, principal)
    return category


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    body: CreateCategoryRequest, db: DbSession, principal: AdminPrincipal
) -> CategoryResponse:
    return await service.create_category(db, body)


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: uuid.UUID, body: UpdateCategoryRequest, db: DbSession, principal: AdminPrincipal
) -> CategoryResponse:
    return await service.update_category(db, category_id, body)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_category(category_id: uuid.UUID, db: DbSession, principal: AdminPrincipal) -> None:
    await service.delete_category(db, category_id)


@router.patch("/{category_id}/move", response_model=CategoryResponse)
async def move_category(
    category_id: uuid.UUID, body: MoveCategoryRequest, db: DbSession, principal: AdminPrincipal
) -> CategoryResponse:
    await service.move_category(db, category_id, body.direction)
    return await service.get_category(db, category_id)
