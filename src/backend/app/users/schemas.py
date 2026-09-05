"""Pydantic request/response models for `/api/auth/register` and
`/api/people`."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class UserProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    party_id: int
    account_user_id: int
    display_name: str
    email: str | None
    created_at: datetime
    updated_at: datetime


class UserRoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    party_id: int
    role_type: str
    valid_from: date
    valid_to: date | None


class RegisterRequest(BaseModel):
    """Public self-registration: bootstraps a Family + guardian login, and
    — when `role == "ORGANIZER"` — also creates the guardian's own Circle
    and assigns them as its leader, atomically."""

    role: Literal["GUEST", "ORGANIZER"]
    family_name: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1)
    display_name: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=255)
    circle_name: str | None = Field(default=None, min_length=1, max_length=255)

    @model_validator(mode="after")
    def _require_circle_name_for_organizer(self) -> RegisterRequest:
        if self.role == "ORGANIZER" and not self.circle_name:
            raise ValueError("circle_name is required when role is ORGANIZER")
        return self


class RegisterResponse(BaseModel):
    token: str
