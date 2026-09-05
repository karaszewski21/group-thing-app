"""Pydantic request/response models for `/api/families`."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class FamilyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    party_id: int
    name: str
    created_at: datetime
    updated_at: datetime


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
