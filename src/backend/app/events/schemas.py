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


class EventParticipantItemResponse(BaseModel):
    item_id: uuid.UUID
    product_name: str
    mode: str
    thumb_url: str | None


class EventParticipantResponse(BaseModel):
    party_id: uuid.UUID
    display_name: str
    is_author: bool
    is_me: bool
    items: list[EventParticipantItemResponse]


class EventDetailResponse(EventResponse):
    """The event page: the public event plus what the page needs around it.
    `participants` lists the author first, then active attendees in sign-up
    order; `attendee_count` excludes the author."""

    banner_url: str | None
    attendee_count: int
    is_author: bool
    author_display_name: str
    organization: EventOrganizationResponse | None
    participants: list[EventParticipantResponse]
    is_attending: bool
    has_ended: bool


class EventAttendanceRequest(BaseModel):
    """`guest_name` is needed only without an account and ignored otherwise."""

    model_config = ConfigDict(extra="forbid")

    guest_name: str | None = None


class EventAttendanceResponse(BaseModel):
    id: uuid.UUID
    event_id: uuid.UUID
    user_profile_id: uuid.UUID
    attached_to_account: bool


class EventBannerResponse(BaseModel):
    url: str
    status: ModerationStatus
