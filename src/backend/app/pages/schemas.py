"""Pydantic response models of the public owner pages: the per-layout
organization page, an organization's group terms page, the owner items
pages, the party profile and the owner meetings lists. Anonymous read
models with explicit allowlisted fields only. The groups and media types
they embed come through the pages ACLs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from .infrastructure.groups_acl import (
    ExchangeMode,
    GroupLayoutMode,
    OwnerItemCountsResponse,
    OwnerSummaryResponse,
    ReservedByResponse,
)
from .infrastructure.media_acl import PublicMediaResponse


class OwnerItemCardResponse(BaseModel):
    item_id: uuid.UUID
    product_name: str
    condition: str
    mode: ExchangeMode
    thumb_url: str | None
    # The listing preference's `created_at`, naive UTC like every audit timestamp.
    added_at: datetime
    reservation: ReservedByResponse | None


class OwnerNearestDateResponse(BaseModel):
    kind: Literal["TERM", "EVENT"]
    id: uuid.UUID
    name: str
    # Naive Warsaw wall clock (`Term.occurs_on` / `Event.starts_at`).
    starts_at: datetime
    location_name: str | None
    attendee_count: int
    path: str


class OrganizationStatsResponse(BaseModel):
    # PUBLIC, non-deleted groups the owner leads.
    group_count: int
    # The owner's PUBLIC listed items that are not reserved.
    item_count: int
    # Upcoming terms of those groups plus upcoming events the owner authored.
    meeting_count: int


class OrganizationItemStatsResponse(BaseModel):
    # Available (not reserved) PUBLIC listed items per mode.
    GIFT: int
    SWAP: int


class OrganizationNextTermResponse(BaseModel):
    id: uuid.UUID
    occurs_on: datetime
    attendee_count: int


class OrganizationGroupResponse(BaseModel):
    id: uuid.UUID
    name: str
    layout_mode: GroupLayoutMode
    next_term: OrganizationNextTermResponse | None
    upcoming_term_count: int


class MeetingLinkResponse(BaseModel):
    kind: Literal["TERM", "EVENT"]
    # Naive Warsaw wall clock (`Term.occurs_on` / `Event.starts_at`).
    starts_at: datetime
    path: str


class ClassicLayoutResponse(BaseModel):
    layout: Literal["CLASSIC"] = "CLASSIC"
    stats: OrganizationStatsResponse
    upcoming_terms: list[OwnerNearestDateResponse]
    items: list[OwnerItemCardResponse]


class LinksLayoutResponse(BaseModel):
    layout: Literal["LINKS"] = "LINKS"
    stats: OrganizationStatsResponse


class ScheduleLayoutResponse(BaseModel):
    layout: Literal["SCHEDULE"] = "SCHEDULE"
    stats: OrganizationStatsResponse
    upcoming_terms: list[OwnerNearestDateResponse]
    # The owner's newest groups.
    groups: list[OrganizationGroupResponse]
    item_stats: OrganizationItemStatsResponse


class ExchangeLayoutResponse(BaseModel):
    layout: Literal["EXCHANGE"] = "EXCHANGE"
    stats: OrganizationStatsResponse
    items: list[OwnerItemCardResponse]
    term_links: list[MeetingLinkResponse]


class GroupTermResponse(BaseModel):
    id: uuid.UUID
    # Naive Warsaw wall clock (`Term.occurs_on`).
    occurs_on: datetime
    description: str | None
    location_name: str | None
    attendee_count: int
    path: str


class OrganizationGroupTermsResponse(BaseModel):
    """The group page behind `/<org-slug>/group/<group-id>/terms`: the group
    tile, the group's description (kept off the tile, which the layouts share)
    and its upcoming terms, earliest first, at most `GROUP_TERMS_LIMIT`."""

    owner: OwnerSummaryResponse
    group: OrganizationGroupResponse
    description: str | None
    terms: list[GroupTermResponse]


OrganizationLayoutResponse = Annotated[
    ClassicLayoutResponse | LinksLayoutResponse | ScheduleLayoutResponse | ExchangeLayoutResponse,
    Field(discriminator="layout"),
]


class OwnerItemsPageResponse(BaseModel):
    owner: OwnerSummaryResponse
    nearest: OwnerNearestDateResponse | None
    # Over every listed item, ignoring the `mode` filter.
    counts: OwnerItemCountsResponse
    items: list[OwnerItemCardResponse]
    total: int
    page: int
    size: int


class OwnerMeetingsResponse(BaseModel):
    """The owner meetings page (`/<org-slug>/meetings`, `/<party-id>/meetings`):
    the owner's upcoming public terms and events, earliest first, at most
    `OWNER_MEETINGS_LIMIT`."""

    owner: OwnerSummaryResponse
    meetings: list[OwnerNearestDateResponse]


class OrganizationLinkResponse(BaseModel):
    name: str
    slug: str


class PartyProfileResponse(BaseModel):
    """The public profile of a person (`/<party-id>`): always the person
    (`owner` with their own name and no slug); an Organization they own is a
    separate page, linked through `organization`."""

    owner: OwnerSummaryResponse
    organization: OrganizationLinkResponse | None
    bio: str | None
    # The approved images only; never a pending or rejected one.
    logo: PublicMediaResponse | None
    avatar: PublicMediaResponse | None
    cover: PublicMediaResponse | None
    gallery: list[PublicMediaResponse]
    # The effective layout key and the theme the person chose.
    page_layout: str
    palette_preset: str | None
    primary_color: str | None
    accent_color: str | None
    nearest: OwnerNearestDateResponse | None
    counts: OwnerItemCountsResponse
    # The newest listed items, at most `PROFILE_RECENT_ITEMS`.
    recent_items: list[OwnerItemCardResponse]
    # The viewer is this person (the "Załóż stronę organizatora" invite).
    is_me: bool
