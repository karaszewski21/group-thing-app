"""Pydantic request/response models for `/api/categories` (spec.md's API
Route Spec, `CategoryResponse`/`CreateCategoryRequest`/`UpdateCategoryRequest`).
Reference module for the migration's schema pattern — Groups 8/9 follow this
shape.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class CategoryResponse(BaseModel):
    """Field order is significant (mirrors the Java DTO): `id, name,
    description, created_at, updated_at`."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class CreateCategoryRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class UpdateCategoryRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=500)
