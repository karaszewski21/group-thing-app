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


class EventResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    starts_at: datetime
    ends_at: datetime | None
    location: LocationRefResponse | None
    created_at: datetime
    updated_at: datetime


class EventBannerResponse(BaseModel):
    url: str
    status: ModerationStatus
