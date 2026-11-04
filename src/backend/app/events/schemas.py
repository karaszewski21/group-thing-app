"""Pydantic request/response models for `/api/events`. The request checks
only the shape: every field is optional so the service can answer each
domain rule with its Polish message."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.moderation.status import ModerationStatus

from .infrastructure.locations_acl import LocationRefResponse


class CreateEventRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    location_id: uuid.UUID | None = None


class UpdateEventRequest(BaseModel):
    """Only the fields present in the body change; each one is checked by
    the same rules as on create."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    description: str | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    location_id: uuid.UUID | None = None


class EventResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    starts_at: datetime
    ends_at: datetime | None
    location: LocationRefResponse | None
    created_at: datetime
    updated_at: datetime
    author_slug: str


class EventOrganizationResponse(BaseModel):
    """The author's own Organization: its name and stored theme colors."""

    name: str
    primary_color: str | None
    accent_color: str | None
    palette_preset: str | None


class ReservedByResponse(BaseModel):
    """The groups reserved badge: `by_name` (the party who would receive the
    item, `None` for an anonymous viewer) and whether that is the viewer."""

    by_name: str | None
    by_me: bool


class EventParticipantItemResponse(BaseModel):
    """`added_at` is the listing preference's `created_at` (naive UTC);
    `reservation` is `None` while the item is available."""

    item_id: uuid.UUID
    product_name: str
    mode: str
    thumb_url: str | None
    added_at: datetime
    reservation: ReservedByResponse | None


class EventParticipantResponse(BaseModel):
    """`items` holds at most the 3 newest listed items; `items_total` counts
    them all."""

    party_id: uuid.UUID
    display_name: str
    is_author: bool
    is_me: bool
    items: list[EventParticipantItemResponse]
    items_total: int


class EventOpenReservationsResponse(BaseModel):
    """What deleting the event would cancel: open gift reservations plus
    open swaps (`total`), of which `swaps` are swaps."""

    total: int
    swaps: int


class EventDetailResponse(EventResponse):
    """The event page: the public event plus what the page needs around it.
    `participants` lists the author first, then active attendees in sign-up
    order; `attendee_count` excludes the author. `open_reservations` is
    filled for the author only."""

    banner_url: str | None
    attendee_count: int
    is_author: bool
    author_display_name: str
    organization: EventOrganizationResponse | None
    participants: list[EventParticipantResponse]
    is_attending: bool
    has_ended: bool
    open_reservations: EventOpenReservationsResponse | None


class EventAttendanceResponse(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    user_profile_id: uuid.UUID


class EventBannerResponse(BaseModel):
    url: str
    status: ModerationStatus
