"""Pydantic request/response models for `/api/products` (spec.md's API
Route Spec, `ProductResponse`/`CreateProductRequest`/`UpdateProductRequest`).
`category_id` is a plain FK-id into the standalone `app.category` module's
`Category` table, not a nested `CategoryResponse`.
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_core import PydanticCustomError

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
    description, photo_url, sku, category_id, plugin_data, created_at,
    updated_at`."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    description: str | None
    photo_url: str | None
    sku: str
    category_id: uuid.UUID
    plugin_data: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime


class CreateProductRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    photo_url: str | None = Field(default=None, max_length=500)
    sku: str = Field(min_length=1, max_length=50)
    category_id: uuid.UUID

    @field_validator("photo_url")
    @classmethod
    def _check_photo_url(cls, value: str | None) -> str | None:
        return _validate_photo_url(value)


class UpdateProductRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    photo_url: str | None = Field(default=None, max_length=500)
    sku: str = Field(min_length=1, max_length=50)
    category_id: uuid.UUID

    @field_validator("photo_url")
    @classmethod
    def _check_photo_url(cls, value: str | None) -> str | None:
        return _validate_photo_url(value)


class ResolveProductRequest(BaseModel):
    """`POST /api/products/resolve` — resolves a freeform item name (e.g.
    typed during onboarding) to an existing `Product`, or creates one on the
    fly with a placeholder sku. Reuses `ProductResponse` as the return
    shape; no dedicated response schema."""

    name: str = Field(min_length=1, max_length=255)
    category_id: uuid.UUID


_GALLERY_URL_MESSAGE = "Podaj poprawny link zaczynający się od http:// lub https://"
# A whole http(s) URL with a host and no whitespace or control characters.
_GALLERY_URL_PATTERN = re.compile(r"https?://[^\s/$.?#\x00-\x1f\x7f][^\s\x00-\x1f\x7f]*")


class ProductPhotoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    url: str
    sort_order: int


class AddProductPhotoRequest(BaseModel):
    url: str = Field(max_length=500)

    @field_validator("url")
    @classmethod
    def _check_url(cls, value: str) -> str:
        trimmed = value.strip()
        if not _GALLERY_URL_PATTERN.fullmatch(trimmed):
            raise PydanticCustomError("value_error", _GALLERY_URL_MESSAGE)
        return trimmed


class ReorderProductPhotosRequest(BaseModel):
    photo_ids: list[uuid.UUID] = Field(max_length=10)


class UpdateProductDescriptionRequest(BaseModel):
    description: str | None = Field(default=None, max_length=2000)


class ProductDescriptionResponse(BaseModel):
    description: str | None
