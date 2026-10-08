"""Pydantic request/response models for `/api/organizations`."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .page_layouts import PAGE_LAYOUT_KEYS, resolve_page_layout
from .palettes import PALETTE_PRESET_KEYS

_HEX_COLOR_REGEX = r"^#[0-9a-fA-F]{6}$"


class OrganizationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    party_id: uuid.UUID
    name: str
    slug: str
    primary_color: str | None
    accent_color: str | None
    palette_preset: str | None
    page_layout: str
    created_at: datetime
    updated_at: datetime


class PublicOrganizationResponse(BaseModel):
    """Served from the unauthenticated `/api/organizations/public/{slug}`
    endpoint — deliberately a narrower shape than `OrganizationResponse`:
    no `party_id`/timestamps, nothing beyond what the public page itself
    displays. `page_layout` is the effective layout (`resolve_page_layout`),
    unlike the owner's `OrganizationResponse`, which carries the stored key."""

    model_config = ConfigDict(from_attributes=True)

    slug: str
    name: str
    primary_color: str | None
    accent_color: str | None
    palette_preset: str | None
    page_layout: str

    @field_validator("page_layout")
    @classmethod
    def _effective_page_layout(cls, value: str) -> str:
        return resolve_page_layout(value)


class CreateOwnOrganizationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class UpdateOrganizationRequest(BaseModel):
    """A `PATCH`: an omitted field stays unchanged, an explicit `null`
    clears `palette_preset` / `primary_color` / `accent_color`. `name` and
    `page_layout` cannot be cleared, so `null` for them is rejected (400).
    Unknown keys are rejected too. The service applies exactly the fields
    present in `model_fields_set`."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    page_layout: str | None = None
    palette_preset: str | None = None
    primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)
    accent_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)

    @field_validator("name", "page_layout")
    @classmethod
    def _not_null(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("must not be null")
        return value

    @field_validator("page_layout")
    @classmethod
    def _known_page_layout(cls, value: str) -> str:
        if value not in PAGE_LAYOUT_KEYS:
            raise ValueError("unknown page layout")
        return value

    @field_validator("palette_preset")
    @classmethod
    def _known_palette_preset(cls, value: str | None) -> str | None:
        if value is not None and value not in PALETTE_PRESET_KEYS:
            raise ValueError("unknown palette preset")
        return value
