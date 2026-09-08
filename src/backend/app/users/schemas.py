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
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class UserProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    party_id: int
    account_user_id: int | None
    display_name: str
    email: str | None
    created_at: datetime
    updated_at: datetime
    # Not a `UserProfile` column — populated by the router from
    # `service.is_active_organizer()` after `model_validate`. Authoritative
    # organizer status independent of Circle/Leadership ownership (a
    # freshly-registered ORGANIZER with no circle yet is still one).
    is_organizer: bool = False


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
    `derive_username_from_email`/`_derive_display_name`); no `Family`/`Circle` is
    created here (see spec.md Core Requirement 3)."""

    role: Literal["GUEST", "ORGANIZER"]
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def _validate_email_format(cls, value: str) -> str:
        if not EMAIL_PATTERN.match(value):
            raise ValueError("Invalid email format")
        return value


class RegisterResponse(BaseModel):
    token: str
    party_id: int
    role: str
