"""Request/response models for the ADMIN-only `/api/moderation` routes."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.organizations.models import MediaKind

from .models import ModerationSubjectType
from .status import ModerationStatus


class ModerationQueueEntryResponse(BaseModel):
    """One photo awaiting (or past) a decision. `scores` are the latest
    model scores, `null` when no model has scored it."""

    model_config = ConfigDict(from_attributes=True)

    subject_type: ModerationSubjectType
    subject_id: uuid.UUID
    # `None` for an avatar or organization media; `product_name` then holds
    # the profile's or the organization's name.
    product_id: uuid.UUID | None
    product_name: str
    photo_url: str | None
    status: ModerationStatus
    model_id: str | None
    scores: dict[str, Any] | None
    submitted_at: datetime
    # Only for organization media.
    media_kind: MediaKind | None = None


class ModerationDecisionRequest(BaseModel):
    """Uploaded images only (product photos, avatars, organization media):
    texts are checked synchronously on write, so a `PRODUCT_TEXT` decision
    is a 400 validation error."""

    subject_type: Literal[
        ModerationSubjectType.PHOTO,
        ModerationSubjectType.AVATAR,
        ModerationSubjectType.ORGANIZATION_MEDIA,
    ]
    subject_id: uuid.UUID
    outcome: Literal[ModerationStatus.APPROVED, ModerationStatus.REJECTED]
    note: str | None = Field(default=None, max_length=1000)
