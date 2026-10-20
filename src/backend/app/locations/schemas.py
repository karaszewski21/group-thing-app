"""Pydantic request/response models for `/api/locations`."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import LocationSource


class LocationResponse(BaseModel):
    """The owner's view. `lat`/`lng` are `Numeric(9,6)` in the database and
    declared `float` here so JSON carries numbers, not strings."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_party_id: uuid.UUID
    name: str
    formatted_address: str
    google_place_id: str | None
    lat: float | None
    lng: float | None
    notes: str | None
    source: LocationSource
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class LocationRefResponse(BaseModel):
    """A place as attached to a Circle or Term on READ-level endpoints any
    logged-in user may call: no owner party id, no coordinates."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    formatted_address: str
    google_place_id: str | None
    notes: str | None
    deleted_at: datetime | None


class PublicLocationResponse(BaseModel):
    """The place as others see it: never the owner's party id, no timestamps."""

    model_config = ConfigDict(from_attributes=True)

    name: str
    formatted_address: str
    google_place_id: str | None
    lat: float | None
    lng: float | None
    notes: str | None


class CreateLocationRequest(BaseModel):
    """GOOGLE requires `google_place_id`, `lat` and `lng`; MANUAL forbids
    all three. A blank `notes` is stored as null."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=255)
    formatted_address: str = Field(min_length=1, max_length=500)
    source: LocationSource
    google_place_id: str | None = Field(default=None, min_length=1, max_length=255)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("notes")
    @classmethod
    def _blank_notes_clear(cls, value: str | None) -> str | None:
        return value or None

    @model_validator(mode="after")
    def _source_fields(self) -> CreateLocationRequest:
        google_fields = (self.google_place_id, self.lat, self.lng)
        if self.source == LocationSource.GOOGLE and any(v is None for v in google_fields):
            raise ValueError("GOOGLE locations require google_place_id, lat and lng")
        if self.source == LocationSource.MANUAL and any(v is not None for v in google_fields):
            raise ValueError("MANUAL locations must not carry google_place_id, lat or lng")
        return self


class UpdateLocationRequest(BaseModel):
    """A `PATCH`: an omitted field stays unchanged; an explicit `null` or a
    blank value clears `notes`. `name` and `formatted_address` cannot be
    cleared, and `formatted_address` is editable only on MANUAL rows (the
    service answers 409 for GOOGLE). Unknown keys — including
    `google_place_id`, `source`, `lat`, `lng` — are rejected. The service
    applies exactly the fields present in `model_fields_set`."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=255)
    formatted_address: str | None = Field(default=None, min_length=1, max_length=500)
    notes: str | None = Field(default=None, max_length=500)

    @field_validator("name", "formatted_address")
    @classmethod
    def _not_null(cls, value: str | None) -> str | None:
        if value is None:
            raise ValueError("must not be null")
        return value

    @field_validator("notes")
    @classmethod
    def _blank_notes_clear(cls, value: str | None) -> str | None:
        return value or None
