"""Pydantic request/response models for `/api/auth/register` and
`/api/people`."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# Basic `local-part@domain.tld` shape check — not a full RFC 5322
# validator, just enough to fail fast on obviously malformed input per
# `standards/global/validation.md`'s "validate early" guidance.
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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
    """Public self-registration: bootstraps a login + `Party(PERSON)` +
    `UserProfile` only. `username`/`display_name` are derived server-side
    from `email` (never accepted from the client — see `service.py`'s
    `_derive_username`/`_derive_display_name`); no `Family`/`Circle` is
    created here (see spec.md Core Requirement 3)."""

    role: Literal["GUEST", "ORGANIZER"]
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def _validate_email_format(cls, value: str) -> str:
        if not _EMAIL_PATTERN.match(value):
            raise ValueError("Invalid email format")
        return value


class RegisterResponse(BaseModel):
    token: str
    party_id: int
    role: str
