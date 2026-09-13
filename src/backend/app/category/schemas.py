"""Pydantic request/response models for `/api/categories` (spec.md's API
Route Spec, Category section). Follows `app/product/schemas.py`'s pattern.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from .models import Category


class CategoryResponse(BaseModel):
    """`product_count` is an aggregated value, never a plain ORM attribute
    on `Category` — so `category_response_from` below is the construction
    entry point routers/service use instead of a plain
    `model_validate(from_attributes)` call, mirroring `app/plugin/
    schemas.py`'s `plugin_response_from_descriptor`."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    sort_order: int
    product_count: int
    created_at: datetime
    updated_at: datetime


def category_response_from(category: Category, product_count: int) -> CategoryResponse:
    return CategoryResponse(
        id=category.id,
        name=category.name,
        description=category.description,
        sort_order=category.sort_order,
        product_count=product_count,
        created_at=category.created_at,
        updated_at=category.updated_at,
    )


class CreateCategoryRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class UpdateCategoryRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class MoveCategoryRequest(BaseModel):
    direction: Literal["up", "down"]
