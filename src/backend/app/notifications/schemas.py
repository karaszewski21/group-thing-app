"""`app.notifications` request/response models."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from .models import NotificationKind


class NotificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: NotificationKind
    message: str
    link_path: str | None
    read_at: datetime | None
    created_at: datetime


class UnreadCountResponse(BaseModel):
    count: int
