"""Pydantic request/response models for `/api/organizations`."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

_HEX_COLOR_REGEX = r"^#[0-9a-fA-F]{6}$"


class OrganizationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    party_id: int
    name: str
    slug: str
    primary_color: str | None
    accent_color: str | None
    created_at: datetime
    updated_at: datetime


class PublicOrganizationResponse(BaseModel):
    """Served from the unauthenticated `/api/organizations/public/{slug}`
    endpoint — deliberately a narrower shape than `OrganizationResponse`:
    no `party_id`/timestamps, nothing beyond what the public page itself
    displays."""

    model_config = ConfigDict(from_attributes=True)

    slug: str
    name: str
    primary_color: str | None
    accent_color: str | None


class CreateOwnOrganizationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class UpdateOrganizationRequest(BaseModel):
    """All fields optional — a `PATCH`, not a full replace. `null`/omitted
    color fields leave the existing value untouched (there's no way to
    *clear* a previously-set color via this endpoint today; not needed
    yet — the profile page always sends both colors together)."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)
    accent_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)
