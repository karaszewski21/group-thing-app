"""Pydantic request/response models for `/api/groups`, `/api/leaderships`,
`/api/memberships`, `/api/terms`, `/api/needed-items` and `/api/pledges`."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.circulation.models import ItemCondition
from app.users.schemas import EMAIL_PATTERN, normalize_email

from .models import GroupRoleType, NeededItemCategory, PledgeStatus


class GroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    party_id: int
    name: str
    organizer_slug: str | None = None
    created_at: datetime
    updated_at: datetime


class CreateCircleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class CreateOwnCircleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class GroupRoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    party_id: int
    role_type: GroupRoleType
    valid_from: date
    valid_to: date | None


class LeadershipResponse(BaseModel):
    """`organizer_party_id` is denormalized (resolved by a join in
    `service.py`, not stored on the row) so callers don't need a second
    round trip through `GroupRoleResponse` just to find out who this is."""

    id: int
    from_role_id: int
    to_group_id: int
    organizer_party_id: int
    valid_from: date
    valid_to: date | None


class AssignLeadershipRequest(BaseModel):
    group_id: int
    organizer_party_id: int
    valid_from: date


class MembershipResponse(BaseModel):
    """`member_party_id` is denormalized the same way as
    `LeadershipResponse.organizer_party_id`."""

    id: int
    from_role_id: int
    to_group_id: int
    member_party_id: int
    valid_from: date
    valid_to: date | None


class CreateMembershipRequest(BaseModel):
    group_id: int
    valid_from: date


class TermResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    circle_group_id: int
    occurs_on: date
    description: str | None
    created_at: datetime
    updated_at: datetime


class CreateTermRequest(BaseModel):
    circle_group_id: int
    occurs_on: date
    description: str | None = Field(default=None, max_length=2000)


class NeededItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    term_id: int
    category: NeededItemCategory
    description: str | None
    created_at: datetime
    updated_at: datetime


class CreateNeededItemRequest(BaseModel):
    term_id: int
    category: NeededItemCategory
    description: str | None = Field(default=None, max_length=500)


class PledgeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    needed_item_id: int
    pledged_by_party_id: int
    status: PledgeStatus
    resolved_reservation_id: int | None
    created_at: datetime
    updated_at: datetime


class CreatePledgeRequest(BaseModel):
    needed_item_id: int


class FulfillPledgeRequest(BaseModel):
    """Registers the concrete item the pledging guardian is bringing, and
    creates the bridging `Reservation` in `app.circulation`."""

    product_id: int
    condition: ItemCondition


# --- Public circle-view (unauthenticated, `GET /api/groups/public/{id}`) -------


class PublicNeededItemResponse(BaseModel):
    id: int
    category: NeededItemCategory
    description: str | None


class PublicTermResponse(BaseModel):
    id: int
    occurs_on: date
    description: str | None
    needed_items: list[PublicNeededItemResponse]


class PublicGuardianResponse(BaseModel):
    display_name: str


class PublicCircleResponse(BaseModel):
    """Never carries a per-child field — `guardians` exposes only the
    aggregate `child_count` each guardian RSVP'd with (see
    `TermAttendance`), so there is nothing per-attendee to leak."""

    id: int
    name: str
    organizer_display_name: str | None
    organizer_slug: str | None
    next_term: PublicTermResponse | None
    guardians: list[PublicGuardianResponse]


class CreateRsvpRequest(BaseModel):
    term_id: int
    guardian_name: str = Field(min_length=1, max_length=255)
    child_count: int = Field(ge=0, default=0)


class RsvpResponse(BaseModel):
    id: int
    term_id: int
    user_profile_id: int
    guardian_name: str
    child_count: int
    attached_to_account: bool


# --- My attendances (authenticated, `GET /api/groups/mine/attendances`) --------


class MyAttendanceResponse(BaseModel):
    """One row of the caller's own Term RSVPs — carries enough to render a
    panel tile (date, circle name, organizer) and rebuild the public-term
    link (`organizer_slug` + `group_id` + `term_id`) with no second request.
    `organizer_display_name` is `None` when the circle currently has no
    active organizer; `organizer_slug` is always usable (falls back to a
    stable hash — see `service.resolve_organizer_slug`)."""

    attendance_id: int
    term_id: int
    occurs_on: date
    child_count: int
    group_id: int
    group_name: str
    organizer_display_name: str | None
    organizer_slug: str


# --- Account-merge (unauthenticated, `POST /api/groups/public/merge`) ----------


class MergeAnonymousProfileRequest(BaseModel):
    user_profile_id: int
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def _normalize_and_validate_email(cls, value: str) -> str:
        normalized = normalize_email(value)
        if not EMAIL_PATTERN.match(normalized):
            raise ValueError("Invalid email format")
        return normalized


class MergeAnonymousProfileResponse(BaseModel):
    token: str
    party_id: int
