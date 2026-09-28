"""`app.notifications` request/response models."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from .models import NotificationKind


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: NotificationKind
    message: str
    link_path: str | None
    read_at: datetime | None
    created_at: datetime
    proposal_id: uuid.UUID | None = None
    join_request_id: uuid.UUID | None = None
    reservation_id: uuid.UUID | None = None


class UnreadCountResponse(BaseModel):
    count: int
