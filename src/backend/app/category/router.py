"""`/api/categories` routes (spec.md's API Route Spec). Reference module for
the migration's router pattern — Groups 8/9 follow this shape.

Permission matrix (spec.md rows 11/18): GET -> `READ`/`mcp:read`;
POST/PUT/DELETE -> `EDIT`/`mcp:edit`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db

from . import service
from .schemas import CategoryResponse, CreateCategoryRequest, UpdateCategoryRequest

router = APIRouter(prefix="/api/categories", tags=["categories"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.get("", response_model=list[CategoryResponse])
async def list_categories(db: DbSession, principal: ReadPrincipal) -> list[CategoryResponse]:
    categories = await service.list_categories(db)
    return [CategoryResponse.model_validate(category) for category in categories]


@router.get("/{category_id}", response_model=CategoryResponse)
async def get_category(
    category_id: int, db: DbSession, principal: ReadPrincipal
) -> CategoryResponse:
    category = await service.get_category(db, category_id)
    return CategoryResponse.model_validate(category)


@router.post("", response_model=CategoryResponse, status_code=status.HTTP_201_CREATED)
async def create_category(
    body: CreateCategoryRequest, db: DbSession, principal: EditPrincipal
) -> CategoryResponse:
    category = await service.create_category(db, body)
    return CategoryResponse.model_validate(category)


@router.put("/{category_id}", response_model=CategoryResponse)
async def update_category(
    category_id: int, body: UpdateCategoryRequest, db: DbSession, principal: EditPrincipal
) -> CategoryResponse:
    category = await service.update_category(db, category_id, body)
    return CategoryResponse.model_validate(category)


@router.delete("/{category_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_category(category_id: int, db: DbSession, principal: EditPrincipal) -> None:
    await service.delete_category(db, category_id)
