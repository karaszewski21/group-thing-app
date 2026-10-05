"""Request/response models for the ADMIN-only `/api/moderation` routes."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from .models import ModerationSubjectType
from .status import ModerationStatus


class ModerationQueueEntryResponse(BaseModel):
    """One photo awaiting (or past) a decision. `scores` are the latest
    model scores, `null` when no model has scored it."""

    model_config = ConfigDict(from_attributes=True)

    subject_type: ModerationSubjectType
    subject_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    photo_url: str | None
    status: ModerationStatus
    model_id: str | None
    scores: dict[str, Any] | None
    submitted_at: datetime


class ModerationDecisionRequest(BaseModel):
    """Photos only: texts are checked synchronously on write, so a
    `PRODUCT_TEXT` decision is a 400 validation error."""

    subject_type: Literal[ModerationSubjectType.PHOTO]
    subject_id: uuid.UUID
    outcome: Literal[ModerationStatus.APPROVED, ModerationStatus.REJECTED]
    note: str | None = Field(default=None, max_length=1000)
