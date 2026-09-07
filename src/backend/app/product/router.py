"""`/api/products` routes (spec.md's API Route Spec, Product section).
Follows `app/category/router.py`'s pattern (Group 7's reference module).

Permission matrix (spec.md rows 12/19): GET -> `READ`/`mcp:read`;
POST/PUT/DELETE -> `EDIT`/`mcp:edit`.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db

from . import service
from .models import ProductCategory
from .schemas import (
    CreateProductRequest,
    ProductResponse,
    ResolveProductRequest,
    UpdateProductRequest,
)

router = APIRouter(prefix="/api/products", tags=["products"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.get("", response_model=list[ProductResponse])
async def list_products(
    db: DbSession,
    principal: ReadPrincipal,
    category: ProductCategory | None = None,
    search: str | None = None,
    sort: str | None = None,
    plugin_filter: Annotated[list[str] | None, Query(alias="pluginFilter")] = None,
) -> list[ProductResponse]:
    products = await service.list_products(
        db, category=category, search=search, sort=sort, plugin_filters=plugin_filter
    )
    return [ProductResponse.model_validate(product) for product in products]


@router.get("/{product_id}", response_model=ProductResponse)
async def get_product(
    product_id: int, db: DbSession, principal: ReadPrincipal
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
    product = await service.get_or_create_product_by_name(db, body.name, body.category)
    return ProductResponse.model_validate(product)


@router.put("/{product_id}", response_model=ProductResponse)
async def update_product(
    product_id: int, body: UpdateProductRequest, db: DbSession, principal: EditPrincipal
) -> ProductResponse:
    product = await service.update_product(db, product_id, body)
    return ProductResponse.model_validate(product)


@router.delete("/{product_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_product(product_id: int, db: DbSession, principal: EditPrincipal) -> None:
    await service.delete_product(db, product_id)
