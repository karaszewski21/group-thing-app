"""Pydantic request/response models for `/api/groups`, `/api/leaderships`,
`/api/memberships`, `/api/terms`, `/api/needed-items` and `/api/pledges`."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.circulation.models import ItemCondition, ItemListingStatus, ReservationType

from .infrastructure.locations_acl import (
    LocalityResponse,
    LocationRefResponse,
    PublicLocationResponse,
)
from .models import (
    GroupLayoutMode,
    GroupRoleType,
    GroupVisibility,
    ItemVisibility,
    PledgeStatus,
    SwapProposalStatus,
)

# Listing-time offer subset: an item is only ever offered as a gift or a swap.
_OFFERABLE_RESERVATION_TYPES = frozenset({ReservationType.SWAP, ReservationType.GIFT})


class GroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    party_id: uuid.UUID
    name: str
    organizer_slug: str | None = None
    layout_mode: GroupLayoutMode
    visibility: GroupVisibility
    default_location: LocationRefResponse | None = None
    default_capacity: int | None = None
    created_at: datetime
    updated_at: datetime


class ModerationGroupResponse(BaseModel):
    """`GET /api/groups/moderation` (ADMIN-only) row: every Circle in the
    system with its current organizer (if any — a Circle can be
    leaderless, e.g. right after registration) and aggregated member/term
    counts, for spotting empty or abandoned Circles at a glance."""

    id: uuid.UUID
    name: str
    created_at: datetime
    organizer_name: str | None
    organizer_email: str | None
    member_count: int
    term_count: int
    deleted_at: datetime | None = None
    deleted_by_name: str | None = None


def _reject_blank_name(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("name must not be blank")
    return trimmed


class CreateCircleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class UpdateGroupRequest(BaseModel):
    """In-place circle update — the active-organizer check lives in
    `service.update_group`, not the matrix. `name` is required;
    `layout_mode`/`visibility` apply only when non-null; the defaults apply
    only when present in `model_fields_set` (omitted = keep, `null` = clear)."""

    name: str = Field(min_length=1, max_length=255)
    layout_mode: GroupLayoutMode | None = None
    visibility: GroupVisibility | None = None
    default_location_id: uuid.UUID | None = None
    default_capacity: int | None = Field(default=None, ge=1, le=10000)

    _strip_name = field_validator("name")(_reject_blank_name)


# Alias for call sites that speak of "circles" rather than "groups".
UpdateCircleRequest = UpdateGroupRequest


class CreateOwnCircleRequest(BaseModel):
    """`visibility` and the defaults are honoured by `/mine/new` only;
    `/mine` ignores them."""

    name: str = Field(min_length=1, max_length=255)
    visibility: GroupVisibility | None = None
    default_location_id: uuid.UUID | None = None
    default_capacity: int | None = Field(default=None, ge=1, le=10000)


class GroupRoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    party_id: uuid.UUID
    role_type: GroupRoleType
    valid_from: date
    valid_to: date | None


class LeadershipResponse(BaseModel):
    """`organizer_party_id` is denormalized (resolved by a join in
    `service.py`, not stored on the row) so callers don't need a second
    round trip through `GroupRoleResponse` just to find out who this is."""

    id: uuid.UUID
    from_role_id: uuid.UUID
    to_group_id: uuid.UUID
    organizer_party_id: uuid.UUID
    valid_from: date
    valid_to: date | None


class AssignLeadershipRequest(BaseModel):
    group_id: uuid.UUID
    organizer_party_id: uuid.UUID
    valid_from: date


class MembershipResponse(BaseModel):
    """`member_party_id` is denormalized the same way as
    `LeadershipResponse.organizer_party_id`."""

    id: uuid.UUID
    from_role_id: uuid.UUID
    to_group_id: uuid.UUID
    member_party_id: uuid.UUID
    valid_from: date
    valid_to: date | None


class ModerationTermResponse(BaseModel):
    """`GET /api/terms/moderation` (ADMIN-only) row: a Term of any Circle
    with the Circle's name and its active (non-withdrawn) signup counts."""

    id: uuid.UUID
    circle_group_id: uuid.UUID
    group_name: str
    occurs_on: datetime
    description: str | None
    created_at: datetime
    attendee_count: int
    child_count: int
    location: PublicLocationResponse | None
    capacity: int | None


class TermResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    circle_group_id: uuid.UUID
    occurs_on: datetime
    description: str | None
    created_at: datetime
    updated_at: datetime
    attendee_count: int | None = None
    child_count: int | None = None
    location: LocationRefResponse | None = None
    capacity: int | None = None


class CreateTermRequest(BaseModel):
    """`location_id`/`capacity` omitted -> copied from the Circle's defaults
    (told apart via `model_fields_set`); a term without any place is rejected."""

    circle_group_id: uuid.UUID
    occurs_on: datetime
    description: str | None = Field(default=None, max_length=2000)
    location_id: uuid.UUID | None = None
    capacity: int | None = Field(default=None, ge=1, le=10000)


class UpdateTermRequest(BaseModel):
    """`occurs_on`/`description` apply only when non-null; `location_id`/
    `capacity` apply when present in `model_fields_set` (`null` clears the
    capacity; a `null` place is rejected)."""

    occurs_on: datetime | None = None
    description: str | None = Field(default=None, max_length=2000)
    location_id: uuid.UUID | None = None
    capacity: int | None = Field(default=None, ge=1, le=10000)


class NeededItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    term_id: uuid.UUID
    name: str
    description: str | None
    # An active (non-withdrawn) pledge exists — the organizer's term tile
    # shows a "ktoś przyniesie" mark; who exactly is on the term page.
    claimed: bool
    created_at: datetime
    updated_at: datetime


class CreateNeededItemRequest(BaseModel):
    term_id: uuid.UUID
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=500)

    _strip_name = field_validator("name")(_reject_blank_name)


class UpdateNeededItemRequest(BaseModel):
    """`name` applies only when non-null."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=500)

    @field_validator("name")
    @classmethod
    def _strip_name(cls, value: str | None) -> str | None:
        return None if value is None else _reject_blank_name(value)


class PledgeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    needed_item_id: uuid.UUID
    pledged_by_party_id: uuid.UUID
    status: PledgeStatus
    created_at: datetime
    updated_at: datetime


class CreatePledgeRequest(BaseModel):
    needed_item_id: uuid.UUID


class PublicNeededItemResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    # `claimed` = someone has an active pledge for this item (single-claim);
    # `claimed_by_name` is that pledger's display name (or `None`).
    claimed: bool
    claimed_by_name: str | None
    claimed_by_party_id: uuid.UUID | None


class ReservedByResponse(BaseModel):
    """A listed item's reserved badge. `by_name` is the party who would
    receive the item (the taker or swap counterparty, or the proposer of a
    pending swap proposal), `None` for an anonymous viewer; `by_me` is true
    when the viewer is that party."""

    by_name: str | None
    by_me: bool


class PublicItemListingResponse(BaseModel):
    """One exchange-mechanism offer for the public Term page, available or
    reserved (see `list_public_term_item_listings`). `id` is the item's id,
    same convention as `BrowseTermItemListingResponse`."""

    id: uuid.UUID
    item_id: uuid.UUID
    product_name: str
    condition: str
    offered_types: list[str]
    lister_party_id: uuid.UUID
    lister_display_name: str
    # Public CDN URL of the product's first APPROVED photo, `None` when there
    # is none or storage is not configured.
    thumb_url: str | None = None
    # The listing preference's `created_at` (naive UTC).
    added_at: datetime
    # `None` while the item is available.
    reservation: ReservedByResponse | None


class PublicTermResponse(BaseModel):
    id: uuid.UUID
    occurs_on: datetime
    description: str | None
    needed_items: list[PublicNeededItemResponse]
    item_listings: list[PublicItemListingResponse]
    location: PublicLocationResponse | None
    capacity: int | None
    # Active (non-withdrawn) signups, compared against `capacity`.
    attendee_count: int


class PublicGuardianResponse(BaseModel):
    party_id: uuid.UUID
    display_name: str


class PublicCircleOrganization(BaseModel):
    """The organizer's own Organization: its name and stored colors, reported
    as-is; the frontend decides how (and whether) to derive a palette from
    them. `palette_preset` is the stored preset key, or `None`."""

    name: str
    primary_color: str | None
    accent_color: str | None
    palette_preset: str | None


class PublicCircleResponse(BaseModel):
    """Never carries a per-child field — `guardians` exposes only the
    aggregate `child_count` each guardian RSVP'd with (see
    `TermAttendance`), so there is nothing per-attendee to leak."""

    id: uuid.UUID
    name: str
    organizer_display_name: str | None
    organizer_slug: str | None
    # Links the organizer's person profile (`/<party-id>`) when there is no
    # Organization; null when the circle has no leadership.
    organizer_party_id: uuid.UUID | None
    # Object whenever the organizer owns an Organization (even with all
    # colors null); null when there is none (a `k-…` slug or no leadership).
    organization: PublicCircleOrganization | None
    visibility: GroupVisibility
    layout_mode: GroupLayoutMode
    term: PublicTermResponse | None
    guardians: list[PublicGuardianResponse]


class GroupAccessDetails(BaseModel):
    """The caller's relationship to a Circle, resolved server-side so the
    frontend never has to infer "can I see this / do I need a code" from
    raw auth-token presence — the previous `token ? private-view :
    public-view` frontend branching treated ANY logged-in principal as if
    they belonged to every Circle, which is wrong (see `GroupAccessResponse`)."""

    is_member: bool
    is_organizer: bool
    can_view_content: bool
    # The caller has a `TermAttendance` on the response's `term`.
    is_attending: bool
    # ... and that attendance is not withdrawn.
    is_active_attendee: bool


class GroupAccessResponse(BaseModel):
    """`GET /api/groups/public/{group_id}/access` — the Circle's public
    identity plus the caller's resolved access, in one call. `group` reuses
    `PublicCircleResponse`'s already-privacy-safe shape (a `PRIVATE` group's
    response still omits `term`/`guardians` regardless of `access`)."""

    group: PublicCircleResponse
    access: GroupAccessDetails


# --- Public organizer directory (`GET /api/groups/public/organizers/{slug}`) --
# Anonymous read model: explicit allowlisted fields only, never a person's
# name, party id or child data.

ExchangeMode = Literal["GIFT", "SWAP"]


class OrganizerNextTermResponse(BaseModel):
    id: uuid.UUID
    occurs_on: datetime
    attendee_count: int


class OrganizerCircleResponse(BaseModel):
    id: uuid.UUID
    name: str
    layout_mode: GroupLayoutMode
    next_term: OrganizerNextTermResponse | None
    # Terms in the 60-day window; `next_term` itself has no window.
    upcoming_term_count: int


class OrganizerTermResponse(BaseModel):
    term_id: uuid.UUID
    group_id: uuid.UUID
    group_name: str
    occurs_on: datetime
    description: str | None
    attendee_count: int


class OrganizerExchangeCounts(BaseModel):
    # GIFT/SWAP count available items only; RESERVED the reserved ones.
    GIFT: int
    SWAP: int
    RESERVED: int


class OrganizerExchangeItemResponse(BaseModel):
    item_id: uuid.UUID
    product_name: str
    condition: str
    mode: ExchangeMode
    thumb_url: str | None
    term_id: uuid.UUID
    group_id: uuid.UUID
    occurs_on: datetime
    reservation: ReservedByResponse | None


class OrganizerExchangeResponse(BaseModel):
    # Over every eligible item; `items` is capped, so it may hold fewer.
    counts: OrganizerExchangeCounts
    items: list[OrganizerExchangeItemResponse]


class OrganizerNeededItemResponse(BaseModel):
    id: uuid.UUID
    term_id: uuid.UUID
    group_id: uuid.UUID
    name: str
    claimed: bool


class OrganizerStatsResponse(BaseModel):
    circle_count: int
    upcoming_term_count: int
    # `None` below 3 families, so a small group's families stay unidentifiable.
    family_count: int | None


class OwnerItemCardResponse(BaseModel):
    item_id: uuid.UUID
    product_name: str
    condition: str
    mode: ExchangeMode
    thumb_url: str | None
    # The listing preference's `created_at`, naive UTC like every audit timestamp.
    added_at: datetime
    reservation: ReservedByResponse | None


class MyReservationResponse(BaseModel):
    """One row of `GET /api/reservations/mine`: an item the caller is about
    to receive. `PROPOSED` is the caller's swap offer still awaiting the
    owner (`reservation_id` `None`); `PENDING`/`CONFIRMED` is their open
    reservation."""

    item_id: uuid.UUID
    product_name: str
    thumb_url: str | None
    item_path: str
    owner_name: str
    mode: ExchangeMode
    status: Literal["PROPOSED", "PENDING", "CONFIRMED"]
    reservation_id: uuid.UUID | None
    context_kind: Literal["TERM", "EVENT", "PERSONAL"]
    # The term's circle name or the event's name; `None` for a personal pickup.
    context_name: str | None
    # Naive Warsaw wall clock (`Term.occurs_on` / `Event.starts_at`).
    occurs_at: datetime | None
    # Naive UTC, when the reservation or the proposal was made.
    reserved_at: datetime


class OwnerNearestDateResponse(BaseModel):
    kind: Literal["TERM", "EVENT"]
    id: uuid.UUID
    name: str
    # Naive Warsaw wall clock (`Term.occurs_on` / `Event.starts_at`).
    starts_at: datetime
    location_name: str | None
    attendee_count: int
    path: str


class OrganizerPageResponse(BaseModel):
    circles: list[OrganizerCircleResponse]
    upcoming_terms: list[OrganizerTermResponse]
    exchange: OrganizerExchangeResponse
    needed_items: list[OrganizerNeededItemResponse]
    stats: OrganizerStatsResponse
    # Upcoming terms and events of the owner, earliest first (`list_owner_dates`).
    upcoming_dates: list[OwnerNearestDateResponse]
    recent_items: list[OwnerItemCardResponse]
    # The first of `upcoming_dates`, only when `recent_items` is non-empty.
    owner_nearest: OwnerNearestDateResponse | None


# --- Public owner items page (`GET /api/groups/public/{organizers/{slug},parties/{id}}/items`)


class OwnerSummaryResponse(BaseModel):
    party_id: uuid.UUID
    # The owner's Organization name when they have one, else their profile name.
    display_name: str
    slug: str | None


class OwnerItemCountsResponse(BaseModel):
    # Reserved items included, so GIFT + SWAP is every listed item.
    GIFT: int
    SWAP: int


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


class PartyProfileResponse(BaseModel):
    """The public profile of a person (`/<party-id>`). `owner.slug` is set
    when they own an Organization, so the client can redirect to its page."""

    owner: OwnerSummaryResponse
    bio: str | None
    # The approved avatar's thumbnail; never a pending or rejected one.
    avatar_url: str | None
    nearest: OwnerNearestDateResponse | None
    counts: OwnerItemCountsResponse
    # The newest listed items, at most `PROFILE_RECENT_ITEMS`.
    recent_items: list[OwnerItemCardResponse]
    # The viewer is this person (the "Załóż stronę organizatora" invite).
    is_me: bool


class CreateRsvpRequest(BaseModel):
    term_id: uuid.UUID
    child_count: int = Field(ge=0, default=0)


class RsvpResponse(BaseModel):
    id: uuid.UUID
    term_id: uuid.UUID
    user_profile_id: uuid.UUID
    guardian_name: str
    child_count: int


# --- A Term's attendee list for its organizer
# (`GET /api/groups/{id}/terms/{id}/attendees`) -------------------------------


class TermAttendeeChildResponse(BaseModel):
    """An active CHILD member of an attendee's family, age only — no name
    or id is exposed to the organizer."""

    birth_year: int | None


class TermAttendeeResponse(BaseModel):
    """One RSVP'd party for a chosen Term, resolved for the organizer's
    attendee list. `family_id`/`family_name` are display-only — `None` for a
    family-less attendee (e.g. an anonymous guest party). `children` is
    youngest first, unknown years last."""

    party_id: uuid.UUID
    display_name: str
    child_count: int
    family_id: uuid.UUID | None
    family_name: str | None
    children: list[TermAttendeeChildResponse] = Field(default_factory=list)


# --- A Group's standing member list (`GET /api/groups/{id}/members`) ----------


class GroupMemberResponse(BaseModel):
    """One party who RSVP'd (and did not withdraw) to at least one Term of
    a Group, resolved for the group details page — `terms_attended` is how
    many of the group's Terms they signed up for, `last_term_on` the most
    recent of those (Warsaw wall-clock, like `TermResponse.occurs_on`).
    `family_name` is display-only, `None` for a family-less party."""

    party_id: uuid.UUID
    display_name: str
    family_name: str | None
    terms_attended: int
    last_term_on: datetime


# --- My attendances (authenticated, `GET /api/groups/mine/attendances`) --------


class MyPledgeResponse(BaseModel):
    """One row of the caller's own "rzeczy, które obiecałem przynieść" list —
    carries enough to render a panel tile and rebuild the public-term link
    (`organizer_slug` + `group_id` + `term_id`)."""

    pledge_id: uuid.UUID
    status: PledgeStatus
    item_name: str
    item_description: str | None
    term_id: uuid.UUID
    group_id: uuid.UUID
    group_name: str
    occurs_on: datetime
    organizer_slug: str


class MyAttendanceResponse(BaseModel):
    """One row of the caller's own Term RSVPs — carries enough to render a
    panel tile (date, circle name, organizer) and rebuild the public-term
    link (`organizer_slug` + `group_id` + `term_id`) with no second request.
    `organizer_display_name` is `None` when the circle currently has no
    active organizer; `organizer_slug` is always usable (falls back to a
    stable hash — see `service.resolve_organizer_slug`)."""

    attendance_id: uuid.UUID
    term_id: uuid.UUID
    occurs_on: datetime
    child_count: int
    group_id: uuid.UUID
    group_name: str
    organizer_display_name: str | None
    organizer_slug: str
    location: PublicLocationResponse | None
    capacity: int | None
    attendee_count: int


class WithdrawAttendanceResponse(BaseModel):
    """Bare `TermAttendance` row returned by
    `POST /api/groups/mine/attendances/{id}/withdraw` — `withdrawn_at`
    is the field callers check to confirm the (idempotent) withdrawal."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    term_id: uuid.UUID
    party_id: uuid.UUID
    child_count: int
    withdrawn_at: datetime | None


# --- ItemListingPreference (authenticated, `/api/item-listing-preferences`,
# `/api/term-item-listings`) -----------------------------------------------


class SetItemListingPreferenceRequest(BaseModel):
    """`mode=None` clears the item's standing listing preference. An omitted
    `visibility` keeps the current one (PUBLIC for a new row); it is refused
    without a mode, so a visibility change can never clear the listing."""

    mode: ReservationType | None = None
    visibility: ItemVisibility | None = None

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, value: ReservationType | None) -> ReservationType | None:
        if value is not None and value not in _OFFERABLE_RESERVATION_TYPES:
            raise ValueError("mode may only be SWAP or GIFT")
        return value

    @model_validator(mode="after")
    def _visibility_needs_mode(self) -> SetItemListingPreferenceRequest:
        if self.visibility is not None and self.mode is None:
            raise ValueError("Ustaw tryb, żeby wybrać widoczność.")
        return self


class ItemListingPreferenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    item_id: uuid.UUID
    owner_party_id: uuid.UUID
    mode: str
    visibility: ItemVisibility
    created_at: datetime
    updated_at: datetime


class MyInventoryItemResponse(BaseModel):
    """One row of `GET /api/inventory-items/mine` — an item physically in
    the caller's PERSONAL inventory together with its
    standing `ItemListingPreference.mode` and `visibility` (both `None` =
    not offered), so
    `Moje rzeczy` only ever shows and seeds toggles for items at home.
    `photos_moderation_pending` is true while the item's product has a
    PENDING/NEEDS_REVIEW photo; it is informational only and does not
    block listing the item.
    `thumb_url` is the product's first APPROVED photo (400 px), `None`
    without one or without object storage. `location_id` is the item's
    place as stored, soft-deleted or not."""

    id: uuid.UUID
    inventory_id: uuid.UUID
    home_inventory_id: uuid.UUID | None
    product_id: uuid.UUID
    product_name: str
    condition: ItemCondition
    added_at: datetime
    created_at: datetime
    updated_at: datetime
    listing_mode: ReservationType | None
    listing_visibility: ItemVisibility | None
    listing_status: ItemListingStatus
    location_id: uuid.UUID | None
    photos_moderation_pending: bool
    thumb_url: str | None = None


class BrowseTermItemListingResponse(BaseModel):
    """One row of "Twoje wystawione rzeczy" (`list_my_term_item_listings`)
    or "Rzeczy od innych" (`list_browsable_term_item_listings`) — one
    `ItemListingPreference`, resolved against `term_id`, plus the cross-BC
    display data (product name/condition from `app.circulation`/
    `app.product`, lister display name from `app.users`) and derived
    status (`resolved_reservation_id`/`taken_by_party_id`, from the item's
    own live `Reservation` history — see `_resolve_listing_status`; a
    pending swap proposer's reservation or party is never exposed). `id` is
    the item's id: one derived listing per item, not per creation event."""

    id: uuid.UUID
    term_id: uuid.UUID
    item_id: uuid.UUID
    lister_party_id: uuid.UUID
    offered_types: list[str]
    resolved_reservation_id: uuid.UUID | None
    taken_by_party_id: uuid.UUID | None
    product_name: str
    condition: str
    lister_display_name: str
    created_at: datetime
    updated_at: datetime


# --- Item reservations (authenticated, `/api/items/{item_id}/take|propose`) and
# swap proposals (`/api/swap-proposals`) -------------------------------------


class ItemContextResponse(BaseModel):
    """The term or event an item is reserved in. `name` is the circle's name
    for a term; `starts_at` is naive Warsaw wall clock."""

    kind: Literal["TERM", "EVENT"]
    id: uuid.UUID
    name: str
    starts_at: datetime
    path: str
    has_started: bool


class ReservationContextRef(BaseModel):
    """Where a take/propose happens: a term or event by id, or a personal
    pickup at the owner's place, which carries no id."""

    kind: Literal["PERSONAL", "TERM", "EVENT"]
    id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _id_matches_kind(self) -> ReservationContextRef:
        if self.kind == "PERSONAL" and self.id is not None:
            raise ValueError("Odbiór osobisty nie ma identyfikatora")
        if self.kind != "PERSONAL" and self.id is None:
            raise ValueError("Podaj identyfikator terminu albo wydarzenia")
        return self


class ItemTakeRequest(BaseModel):
    """Only `GIFT` is taken directly; a SWAP goes through the propose route."""

    context: ReservationContextRef
    reservation_type: ReservationType


class ItemProposeRequest(BaseModel):
    context: ReservationContextRef
    offered_item_id: uuid.UUID


class ItemTakeResponse(BaseModel):
    """`context` is null for a personal pickup."""

    item_id: uuid.UUID
    product_name: str
    context: ItemContextResponse | None


class ItemActionsOwnerResponse(OwnerSummaryResponse):
    items_total: int


ItemActionsViewer = Literal["ANONYMOUS", "OWN", "OTHER"]


class ItemContextOptionResponse(ItemContextResponse):
    """An upcoming term or event the owner takes part in. `eligible` is
    whether the logged-in, non-owner viewer may reserve in it."""

    location_name: str | None
    eligible: bool


class ItemLocationResponse(BaseModel):
    """The item's own place as the viewer may see it: the owner gets the
    address (and `deleted_at` once removed); anyone else, anonymous viewers
    included, only the locality, with both other fields null."""

    locality: LocalityResponse
    formatted_address: str | None
    deleted_at: datetime | None


class ItemPartyReservationResponse(BaseModel):
    """The caller's part in the item's open reservation or pending swap
    proposal. `role` is GIVER for the item's holder, RECEIVER for the party
    who would get it; the flags follow the write paths' own rules."""

    role: Literal["GIVER", "RECEIVER"]
    reservation_id: uuid.UUID | None
    proposal_id: uuid.UUID | None
    reservation_type: ReservationType
    personal_pickup: bool
    can_confirm: bool
    can_cancel: bool
    can_accept: bool
    can_reject: bool


class ItemActionsResponse(BaseModel):
    """The item page's action read model. `mode` is null without a listing
    preference; `available` means listed (ACTIVE), AVAILABLE and without a
    pending swap proposal; `reservation` is the reserved badge (null while
    nobody reserves the item); `visibility` is the listing's visibility for
    its owner and null for anyone else or without a listing preference;
    `contexts` holds at most 5 upcoming contexts the viewer may see."""

    mode: ExchangeMode | None
    visibility: ItemVisibility | None
    available: bool
    reservation: ReservedByResponse | None
    party_reservation: ItemPartyReservationResponse | None
    owner: ItemActionsOwnerResponse
    viewer: ItemActionsViewer
    location: ItemLocationResponse | None
    contexts: list[ItemContextOptionResponse]
    personal_pickup_available: bool


class JoinCodeResponse(BaseModel):
    """The only schema that carries a Circle's join code — organizer-only."""

    code: str


class RedeemJoinCodeRequest(BaseModel):
    code: str = Field(pattern=r"^[0-9]{6}$")


class RedeemJoinCodeResponse(BaseModel):
    """`created` is false when the caller already had access (organizer or
    active member) — nothing was inserted."""

    created: bool


class SwapProposalResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    proposer_party_id: uuid.UUID
    listing_item_id: uuid.UUID
    offered_item_id: uuid.UUID
    proposer_reservation_id: uuid.UUID
    status: SwapProposalStatus
    created_at: datetime
    updated_at: datetime


class AcceptedSwapProposalResponse(SwapProposalResponse):
    """Accept response: the proposal plus where and when the swap happens.
    For an event swap `term_id`/`group_id` are null, `term_occurs_on` is the
    event start and `group_name` the event name; a personal swap has all four
    null."""

    term_id: uuid.UUID | None
    term_occurs_on: datetime | None
    group_id: uuid.UUID | None
    group_name: str | None
    event_id: uuid.UUID | None = None
    event_slug: str | None = None


class SwapProposalOfferResponse(BaseModel):
    """One pending offer against one of the caller's own SWAP-listed items
    (`GET /api/term-item-listings/{item_id}/swap-proposals`) — enough to
    render "X oferuje Y" and let the owner `acceptSwapProposal` directly,
    without a second round trip to resolve the proposer's name or their
    offered item's product."""

    id: uuid.UUID
    proposer_party_id: uuid.UUID
    proposer_display_name: str
    offered_item_id: uuid.UUID
    offered_product_name: str
    created_at: datetime


# --- Group exchange summary (authenticated,
# `/api/groups/{id}/exchange-summary`,
# `/api/groups/{id}/families/{family_id}/exchange-offers`) ------------------


class FamilyExchangeSummary(BaseModel):
    """One family's "udostępnia rzecz"/"przynosi na zajęcia" status marks
    for the group's current Term, in `get_group_exchange_summary`'s
    stable, family-order-preserving output — see
    `app/groups/application/exchange_summary.py`."""

    family_id: uuid.UUID
    shares_item: bool
    brings_item: bool


class GroupExchangeSummaryResponse(BaseModel):
    """`GET /api/groups/{id}/exchange-summary` body — one
    `FamilyExchangeSummary` per family currently in the group."""

    families: list[FamilyExchangeSummary]


class FamilyExchangeOffer(BaseModel):
    """One active exchange-mechanism offer from any guardian of a given
    family, for the family card's "DO WYMIANY W GRUPIE" section — field
    shape reused 1:1 from `BrowseTermItemListingResponse` (`product_name`,
    `condition`, `offered_types`), per spec.md's reuse note."""

    id: uuid.UUID
    item_id: uuid.UUID
    product_name: str
    condition: str
    offered_types: list[str]


class FamilyExchangeDetailResponse(BaseModel):
    """`GET /api/groups/{id}/families/{family_id}/exchange-offers` body —
    every active offer from any guardian of the requested family."""

    family_id: uuid.UUID
    offers: list[FamilyExchangeOffer]


# --- Transaction confirmation (authenticated,
# `/api/reservations/{id}/confirm-transaction`) -----------------------------


class ConfirmTransactionResponse(BaseModel):
    """`already_resolved` is the explicit discriminator the frontend uses
    to render "too late, the other party already resolved this" distinctly
    from a generic error, per spec.md Requirement 3. It is only ever `True`
    when this response accompanies a 409 (the reservation itself carries no
    "already resolved" status of its own — see `TermAlreadyResolvedException`)."""

    reservation_id: uuid.UUID
    status: str
    already_resolved: bool = False


class CancelTransactionResponse(BaseModel):
    """Same `status`/`already_resolved` discriminator pattern as
    `ConfirmTransactionResponse` — see that model's docstring."""

    reservation_id: uuid.UUID
    status: str
    already_resolved: bool = False
