"""Pydantic request/response models for `/api/families`."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class FamilyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    party_id: uuid.UUID
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


def _birth_year_not_in_future(value: int | None) -> int | None:
    """Upper bound of a child's birth year. Reads `date.today()` on every
    call, so the bound moves with the calendar (a static `le=` would freeze
    it at import time)."""
    if value is not None and value > date.today().year:
        raise ValueError("Rok urodzenia nie może być z przyszłości")
    return value


class CreateLightweightMemberRequest(BaseModel):
    """One entry of a `POST /api/families/mine/members` batch — a family
    member with no login of their own (see
    `app.families.service.create_lightweight_family_member`)."""

    name: str = Field(min_length=1, max_length=255)
    role_type: Literal["GUARDIAN", "CHILD"]
    birth_year: int | None = Field(default=None, ge=1900)

    _check_birth_year = field_validator("birth_year")(_birth_year_not_in_future)

    @model_validator(mode="after")
    def _birth_year_only_for_child(self) -> CreateLightweightMemberRequest:
        if self.birth_year is not None and self.role_type == "GUARDIAN":
            raise ValueError("Rok urodzenia można podać tylko dla dziecka")
        return self


class CreateLightweightMembersBatchRequest(BaseModel):
    members: list[CreateLightweightMemberRequest]


class UpdateFamilyMemberRequest(BaseModel):
    """Birth-year-only edit of a CHILD member. The key is required (an
    explicit `null` clears the year) and nothing else may be sent."""

    model_config = ConfigDict(extra="forbid")

    birth_year: int | None = Field(..., ge=1900)

    _check_birth_year = field_validator("birth_year")(_birth_year_not_in_future)


class GuardianResponse(BaseModel):
    """Denormalized join of `FamilyMembership` + `UserProfile` — the
    caller shouldn't need a second round trip to find out who a guardian
    is or whether they're the family's primary contact."""

    family_membership_id: uuid.UUID
    party_id: uuid.UUID
    user_profile_id: uuid.UUID
    display_name: str
    email: str | None
    role_type: Literal["GUARDIAN", "CHILD"]
    birth_year: int | None = None
    is_primary_contact: bool
    valid_from: date
    valid_to: date | None


class FamilyResponse(BaseModel):
    family: FamilyOut
    guardians: list[GuardianResponse]
