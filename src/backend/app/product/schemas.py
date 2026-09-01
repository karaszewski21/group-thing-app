"""Pydantic request/response models for `/api/products` (spec.md's API
Route Spec, `ProductResponse`/`CreateProductRequest`/`UpdateProductRequest`).
Follows `app/category/schemas.py`'s pattern (Group 7's reference module);
`ProductResponse` nests `CategoryResponse` directly (imported, never
redefined) rather than exposing a bare `category_id`.
"""

from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

from app.category.schemas import CategoryResponse

_PHOTO_URL_PATTERN = re.compile(r"^https?://.*")


def _validate_photo_url(value: str | None) -> str | None:
    """Shared by Create/Update — regex + exact error message per spec.md.
    Uses `PydanticCustomError` (not a plain `ValueError`) so the message
    reaches `fieldErrors` verbatim, without Pydantic's default "Value
    error, " prefix for validator-raised exceptions."""
    if value is not None and not _PHOTO_URL_PATTERN.match(value):
        raise PydanticCustomError(
            "value_error",
            "Photo URL must start with http:// or https://",
        )
    return value


class ProductResponse(BaseModel):
    """Field order is significant (mirrors the Java DTO): `id, name,
    description, photo_url, price, sku, category, plugin_data, created_at,
    updated_at`. `category` is always a full nested `CategoryResponse` —
    never a bare `category_id`."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    photo_url: str | None
    price: Decimal
    sku: str
    category: CategoryResponse
    plugin_data: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class CreateProductRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    photo_url: str | None = Field(default=None, max_length=500)
    price: Decimal = Field(gt=0)
    sku: str = Field(min_length=1, max_length=50)
    category_id: int

    @field_validator("photo_url")
    @classmethod
    def _check_photo_url(cls, value: str | None) -> str | None:
        return _validate_photo_url(value)


class UpdateProductRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    photo_url: str | None = Field(default=None, max_length=500)
    price: Decimal = Field(gt=0)
    sku: str = Field(min_length=1, max_length=50)
    category_id: int

    @field_validator("photo_url")
    @classmethod
    def _check_photo_url(cls, value: str | None) -> str | None:
        return _validate_photo_url(value)
