"""Pydantic request/response models for `/api/locations` and `/api/localities`.
Every place response carries its `locality` and the computed `label`
(`Location.label`), so the row must come from `service.load_location`/
`load_locations_by_ids`."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .models import LocalityKind, LocationSource


class LocalityResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    kind: LocalityKind
    gmina: str
    powiat: str
    voivodeship: str


class LocalitySearchResult(LocalityResponse):
    """`postal_code` is the smallest matching code in a postal-code search,
    null in a name search."""

    postal_code: str | None


class LocalitySearchResponse(BaseModel):
    """`total` counts every match, not only the returned `results`."""

    results: list[LocalitySearchResult]
    total: int


class LocationResponse(BaseModel):
    """The owner's view. `lat`/`lng` are `Numeric(9,6)` in the database and
    declared `float` here so JSON carries numbers, not strings."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    owner_party_id: uuid.UUID
    locality: LocalityResponse
    label: str
    formatted_address: str | None
    google_place_id: str | None
    lat: float | None
    lng: float | None
    source: LocationSource | None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None


class LocationRefResponse(BaseModel):
    """A place as attached to a Circle, Term or Event on READ-level endpoints
    any logged-in user may call: no owner party id, no coordinates."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    locality: LocalityResponse
    label: str
    formatted_address: str | None
    google_place_id: str | None
    deleted_at: datetime | None


class PublicLocationResponse(BaseModel):
    """The place as others see it: never the owner's party id, no timestamps."""

    model_config = ConfigDict(from_attributes=True)

    locality: LocalityResponse
    label: str
    formatted_address: str | None
    google_place_id: str | None
    lat: float | None
    lng: float | None


class LocationRequest(BaseModel):
    """`POST` and `PUT` (full replacement) body. A blank address is stored
    as null. `source` is required with an address and forbidden without
    one; GOOGLE requires `google_place_id`, `lat` and `lng`; MANUAL forbids
    `google_place_id` and takes an optional pinned point (`lat` and `lng`
    together). The owner is always the caller, never a body field."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    locality_id: str = Field(pattern=r"^\d{7}$")
    formatted_address: str | None = Field(default=None, max_length=500)
    source: LocationSource | None = None
    google_place_id: str | None = Field(default=None, min_length=1, max_length=255)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("formatted_address", mode="before")
    @classmethod
    def _blank_address_clears(cls, value: Any) -> Any:
        return None if isinstance(value, str) and not value.strip() else value

    @model_validator(mode="after")
    def _address_fields(self) -> LocationRequest:
        google_fields = (self.google_place_id, self.lat, self.lng)
        if self.formatted_address is None:
            if self.source is not None or any(v is not None for v in google_fields):
                raise ValueError("source, google_place_id, lat and lng require an address")
            return self
        if self.source is None:
            raise ValueError("an address requires a source")
        if self.source == LocationSource.GOOGLE and any(v is None for v in google_fields):
            raise ValueError("GOOGLE locations require google_place_id, lat and lng")
        if self.source == LocationSource.MANUAL:
            if self.google_place_id is not None:
                raise ValueError("MANUAL locations must not carry google_place_id")
            if (self.lat is None) != (self.lng is None):
                raise ValueError("MANUAL locations take lat and lng together or not at all")
        return self
