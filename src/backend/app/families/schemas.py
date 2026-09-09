"""Pydantic request/response models for `/api/families`."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FamilyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    party_id: int
    name: str
    created_at: datetime
    updated_at: datetime
    # Derived (not an ORM column): active CHILD-role member count of the
    # caller's family. Populated only by the "mine" reads (`GET
    # /api/families/mine`, the `POST /api/families/mine` response); every
    # other `FamilyOut.model_validate(row)` site keeps working via this
    # default since the ORM row has no such attribute.
    child_count: int = Field(default=0)


def _reject_blank_name(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("name must not be blank")
    return trimmed


class CreateOwnFamilyRequest(BaseModel):
    """Self-service "create my family" with a caller-supplied name — the
    caller's party id always comes from the principal, never the body."""

    name: str = Field(min_length=1, max_length=255)

    _strip_name = field_validator("name")(_reject_blank_name)


class UpdateFamilyRequest(BaseModel):
    """Guardian-only in-place rename — the guardian check lives in
    `service.rename_family`, not the matrix."""

    name: str = Field(min_length=1, max_length=255)

    _strip_name = field_validator("name")(_reject_blank_name)


class CreateFamilyRequest(BaseModel):
    """Bootstraps a Family group and its first guardian in one call —
    creates a brand new login (`auth.User`) for the guardian, since there is
    no other identity primitive available."""

    family_name: str = Field(min_length=1, max_length=255)
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1)
    display_name: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=255)


class AddGuardianRequest(BaseModel):
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1)
    display_name: str = Field(min_length=1, max_length=255)
    email: str | None = Field(default=None, max_length=255)


class CreateLightweightMemberRequest(BaseModel):
    """One entry of a `POST /api/families/mine/members` batch — a family
    member with no login of their own (see
    `app.families.service.create_lightweight_family_member`)."""

    name: str = Field(min_length=1, max_length=255)
    role_type: Literal["GUARDIAN", "CHILD"]


class CreateLightweightMembersBatchRequest(BaseModel):
    members: list[CreateLightweightMemberRequest]


class GuardianResponse(BaseModel):
    """Denormalized join of `FamilyMembership` + `UserProfile` — the
    caller shouldn't need a second round trip to find out who a guardian
    is or whether they're the family's primary contact."""

    family_membership_id: int
    party_id: int
    user_profile_id: int
    display_name: str
    email: str | None
    is_primary_contact: bool
    valid_from: date
    valid_to: date | None


class FamilyResponse(BaseModel):
    family: FamilyOut
    guardians: list[GuardianResponse]
