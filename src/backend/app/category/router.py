"""`/api/categories` routes (spec.md's API Route Spec, Category section).
Follows `app/product/router.py`'s pattern.

Permission matrix: GET -> `READ`/`mcp:read` (the seeded `editor` account's
product-creation category dropdown depends on this staying READ-only, not
ADMIN); POST/PUT/DELETE/PATCH .../move -> `ADMIN` only — category
management is admin-only, unlike `app.product`'s EDIT-gated mutations.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
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
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
AdminPrincipal = Annotated[Principal, Depends(require_any("ADMIN"))]


@router.get("", response_model=list[CategoryResponse])
async def list_categories(db: DbSession, principal: ReadPrincipal) -> list[CategoryResponse]:
    return await service.list_categories(db)


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: int, db: DbSession, principal: ReadPrincipal
) -> CategoryResponse:
    return await service.get_category(db, category_id)


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    body: CreateCategoryRequest, db: DbSession, principal: AdminPrincipal
) -> CategoryResponse:
    return await service.create_category(db, body)


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int, body: UpdateCategoryRequest, db: DbSession, principal: AdminPrincipal
) -> CategoryResponse:
    return await service.update_category(db, category_id, body)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_category(category_id: int, db: DbSession, principal: AdminPrincipal) -> None:
    await service.delete_category(db, category_id)


@router.patch("/{category_id}/move", response_model=CategoryResponse)
async def move_category(
    category_id: int, body: MoveCategoryRequest, db: DbSession, principal: AdminPrincipal
) -> CategoryResponse:
    await service.move_category(db, category_id, body.direction)
    return await service.get_category(db, category_id)
