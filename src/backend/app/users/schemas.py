"""Pydantic request/response models for `/api/auth/register` and
`/api/people`."""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.media.schemas import OwnerMediaResponse
from app.organizations.palettes import PALETTE_PRESET_KEYS

from .profile_layouts import PROFILE_PAGE_LAYOUT_KEYS, resolve_profile_page_layout

_HEX_COLOR_REGEX = r"^#[0-9a-fA-F]{6}$"

# Basic `local-part@domain.tld` shape check — not a full RFC 5322
# validator, just enough to fail fast on obviously malformed input per
# `standards/global/validation.md`'s "validate early" guidance.
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def normalize_email(value: str) -> str:
    """Trim surrounding whitespace and lowercase — the canonical form
    stored in `user_profiles.email` and matched on at login. Every request
    schema that carries a login/account email (`RegisterRequest`,
    `LoginRequest`, `MergeAnonymousProfileRequest`) runs this in a
    `field_validator` so registration and login can never disagree on
    casing (`standards/global/validation.md` — normalize before you
    compare)."""
    return value.strip().lower()


class UserProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    party_id: uuid.UUID
    account_user_id: uuid.UUID | None
    display_name: str
    email: str | None
    bio: str | None
    created_at: datetime
    updated_at: datetime
    # Not a `UserProfile` column — populated by the router from
    # `service.is_active_organizer()` after `model_validate`. Authoritative
    # organizer status independent of Circle/Leadership ownership (a
    # freshly-registered ORGANIZER with no circle yet is still one).
    is_organizer: bool = False
    # The public profile's appearance; `page_layout` is the effective key.
    page_layout: str
    palette_preset: str | None
    primary_color: str | None
    accent_color: str | None
    # Filled only on the caller's own profile (`/api/people/me`): every
    # avatar, cover and gallery row in any moderation status.
    media: list[OwnerMediaResponse] = []

    @field_validator("page_layout", mode="before")
    @classmethod
    def _effective_page_layout(cls, value: str | None) -> str:
        return resolve_profile_page_layout(value)


class UpdateMyProfileRequest(BaseModel):
    """The caller's own editable profile fields. A blank `bio` clears it."""

    model_config = ConfigDict(str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=255)
    bio: str | None = Field(default=None, max_length=1000)


class UpdateMyProfileAppearanceRequest(BaseModel):
    """A `PATCH` of the caller's public profile appearance ("Wygląd strony"):
    an omitted field stays unchanged, an explicit `null` clears
    `palette_preset` / `primary_color` / `accent_color` / `bio` (a blank `bio`
    clears it too). `page_layout` cannot be cleared, so `null` is rejected
    (400). Unknown keys are rejected too. The service applies exactly the
    fields present in `model_fields_set`."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    page_layout: str | None = None
    palette_preset: str | None = None
    primary_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)
    accent_color: str | None = Field(default=None, pattern=_HEX_COLOR_REGEX)
    bio: str | None = Field(default=None, max_length=1000)

    @field_validator("page_layout")
    @classmethod
    def _known_page_layout(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("must not be null")
        if value not in PROFILE_PAGE_LAYOUT_KEYS:
            raise ValueError("unknown page layout")
        return value

    @field_validator("palette_preset")
    @classmethod
    def _known_palette_preset(cls, value: str | None) -> str | None:
        if value is not None and value not in PALETTE_PRESET_KEYS:
            raise ValueError("unknown palette preset")
        return value

    @field_validator("bio")
    @classmethod
    def _blank_bio_clears(cls, value: str | None) -> str | None:
        return value or None


class UserRoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    party_id: uuid.UUID
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
    def _normalize_and_validate_email(cls, value: str) -> str:
        normalized = normalize_email(value)
        if not EMAIL_PATTERN.match(normalized):
            raise ValueError("Invalid email format")
        return normalized


class RegisterResponse(BaseModel):
    token: str
    party_id: uuid.UUID
    role: str
