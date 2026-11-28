"""Pydantic request/response models for `/api/admin/settings`. The request
checks only the shape; the range with a Polish message is applied by
`service.py`, so an out-of-range value is a 400 with that message."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, StrictInt


class AppSettingsResponse(BaseModel):
    """Every setting plus `updated_at`, the token the PUT sends back."""

    model_config = ConfigDict(from_attributes=True)

    max_featured_items: int
    updated_at: datetime


class AppSettingsUpdateRequest(BaseModel):
    """A full replace; `updated_at` is the value the client read."""

    model_config = ConfigDict(extra="forbid")

    max_featured_items: StrictInt
    updated_at: datetime
