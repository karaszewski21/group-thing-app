"""Pydantic request/response models for `/api/groups`, `/api/leaderships`,
`/api/memberships`, `/api/terms`, `/api/needed-items` and `/api/pledges`."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.circulation.models import ItemCondition

from .models import GroupRoleType, NeededItemCategory, PledgeStatus


class GroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    party_id: int
    name: str
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
