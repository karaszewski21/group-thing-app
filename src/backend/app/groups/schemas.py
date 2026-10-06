"""Pydantic request/response models for `/api/groups`, `/api/leaderships`,
`/api/memberships`, `/api/terms`, `/api/needed-items` and `/api/pledges`."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.circulation.models import ItemCondition, ReservationType
from app.users.schemas import EMAIL_PATTERN, normalize_email

from .models import (
    GroupJoinRequestStatus,
    GroupLayoutMode,
    GroupRoleType,
    GroupVisibility,
    PledgeStatus,
    SwapProposalStatus,
)

# Listing-time offer subset — never RETURN (a lifecycle transition, not a
# listing-time choice; see `ItemListingPreference.mode`'s docstring).
_OFFERABLE_RESERVATION_TYPES = frozenset(
    {ReservationType.LEND, ReservationType.SWAP, ReservationType.GIFT}
)


class GroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    party_id: uuid.UUID
    name: str
    organizer_slug: str | None = None
    layout_mode: GroupLayoutMode
    visibility: GroupVisibility
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


def _reject_blank_name(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        raise ValueError("name must not be blank")
    return trimmed


class CreateCircleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class UpdateGroupRequest(BaseModel):
    """In-place circle rename — the active-organizer check lives in
    `service.update_group`, not the matrix. `name` is the only editable
    Group field, so this is a required value, not partial-apply."""

    name: str = Field(min_length=1, max_length=255)
    layout_mode: GroupLayoutMode | None = None
    visibility: GroupVisibility | None = None

    _strip_name = field_validator("name")(_reject_blank_name)


# Alias for call sites that speak of "circles" rather than "groups".
UpdateCircleRequest = UpdateGroupRequest


class CreateOwnCircleRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    visibility: GroupVisibility | None = None


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


class CreateTermRequest(BaseModel):
    circle_group_id: uuid.UUID
    occurs_on: datetime
    description: str | None = Field(default=None, max_length=2000)


class UpdateTermRequest(BaseModel):
    occurs_on: datetime | None = None
    description: str | None = Field(default=None, max_length=2000)


class NeededItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    term_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    product_category_id: uuid.UUID
    product_category_name: str
    description: str | None
    # An active (non-withdrawn) pledge exists — the organizer's term tile
    # shows a "ktoś przyniesie" mark; who exactly is on the term page.
    claimed: bool
    created_at: datetime
    updated_at: datetime


class CreateNeededItemRequest(BaseModel):
    term_id: uuid.UUID
    product_id: uuid.UUID
    description: str | None = Field(default=None, max_length=500)


class UpdateNeededItemRequest(BaseModel):
    product_id: uuid.UUID | None = None
    description: str | None = Field(default=None, max_length=500)


class PledgeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    needed_item_id: uuid.UUID
    pledged_by_party_id: uuid.UUID
    status: PledgeStatus
    resolved_reservation_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class CreatePledgeRequest(BaseModel):
    needed_item_id: uuid.UUID


class FulfillPledgeRequest(BaseModel):
    """The concrete item the pledging guardian brings, in one of two modes
    (exactly one):

    - **new item** — `condition` (+ optional `product_id` to override the
      need's product); a fresh `InventoryItem` is registered in the
      guardian's personal inventory.
    - **owned item** — `inventory_item_id` of a thing already on the
      guardian's shelf (must be `AVAILABLE`); no new item is created.

    Either way the bridging `LEND` `Reservation` opens toward the organizer.
    """

    condition: ItemCondition | None = None
    product_id: uuid.UUID | None = None
    inventory_item_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _exactly_one_mode(self) -> FulfillPledgeRequest:
        owned = self.inventory_item_id is not None
        new_item = self.condition is not None
        if owned and (new_item or self.product_id is not None):
            raise ValueError(
                "Podaj albo inventory_item_id (rzecz z Twoich zbiorów), albo condition "
                "(nowa rzecz) — nie oba naraz"
            )
        if not owned and not new_item:
            raise ValueError(
                "Podaj condition (nowa rzecz) albo inventory_item_id (rzecz z Twoich zbiorów)"
            )
        return self


# --- Public circle-view (unauthenticated, `GET /api/groups/public/{id}`) -------


class PublicNeededItemResponse(BaseModel):
    id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    product_category_id: uuid.UUID
    product_category_name: str
    description: str | None
    # `claimed` = someone has an active pledge for this item (single-claim);
    # `claimed_by_name` is that pledger's display name (or `None`).
    claimed: bool
    claimed_by_name: str | None
    claimed_by_party_id: uuid.UUID | None


class PublicItemListingResponse(BaseModel):
    """One still-available exchange-mechanism offer for the public Term
    page — always derived AVAILABLE-only (see `list_public_term_item_listings`),
    so no status/taken fields to leak. `id` is the item's id, same
    convention as `BrowseTermItemListingResponse`."""

    id: uuid.UUID
    item_id: uuid.UUID
    product_name: str
    condition: str
    offered_types: list[str]
    lister_party_id: uuid.UUID
    lister_display_name: str


class PublicTermResponse(BaseModel):
    id: uuid.UUID
    occurs_on: datetime
    description: str | None
    needed_items: list[PublicNeededItemResponse]
    item_listings: list[PublicItemListingResponse]


class PublicGuardianResponse(BaseModel):
    party_id: uuid.UUID
    display_name: str


class PublicCircleResponse(BaseModel):
    """Never carries a per-child field — `guardians` exposes only the
    aggregate `child_count` each guardian RSVP'd with (see
    `TermAttendance`), so there is nothing per-attendee to leak."""

    id: uuid.UUID
    name: str
    organizer_display_name: str | None
    organizer_slug: str | None
    visibility: GroupVisibility
    layout_mode: GroupLayoutMode
    term: PublicTermResponse | None
    guardians: list[PublicGuardianResponse]


class GroupAccessDetails(BaseModel):
    """The caller's relationship to a Circle, resolved server-side so the
    frontend never has to infer "can I see this / can I request access" from
    raw auth-token presence — the previous `token ? private-view :
    public-view` frontend branching treated ANY logged-in principal as if
    they belonged to every Circle, which is wrong (see `GroupAccessResponse`).

    `join_request` is only ever the caller's own latest request, and only
    when it is PENDING or REJECTED; `None` otherwise."""

    is_member: bool
    is_organizer: bool
    can_view_content: bool
    join_request: JoinRequestSummary | None
    # The caller has a `TermAttendance` on the response's `term`.
    is_attending: bool


class GroupAccessResponse(BaseModel):
    """`GET /api/groups/public/{group_id}/access` — the Circle's public
    identity plus the caller's resolved access, in one call. `group` reuses
    `PublicCircleResponse`'s already-privacy-safe shape (a `PRIVATE` group's
    response still omits `term`/`guardians` regardless of `access`)."""

    group: PublicCircleResponse
    access: GroupAccessDetails


class CreateRsvpRequest(BaseModel):
    term_id: uuid.UUID
    guardian_name: str = Field(min_length=1, max_length=255)
    child_count: int = Field(ge=0, default=0)


class RsvpResponse(BaseModel):
    id: uuid.UUID
    term_id: uuid.UUID
    user_profile_id: uuid.UUID
    guardian_name: str
    child_count: int
    attached_to_account: bool


# --- Formalize a Term's attendees into standing Memberships, independent of
# Group.visibility (`POST /api/groups/{id}/terms/{id}/formalize`) -----------


class TermAttendeeChildResponse(BaseModel):
    """An active CHILD member of an attendee's family, age only — no name
    or id is exposed to the organizer."""

    birth_year: int | None


class TermAttendeeResponse(BaseModel):
    """One RSVP'd party for a chosen Term, resolved for the organizer's
    "which attendees become standing members" picker. `family_id`/
    `family_name` are display-only, purely informational — a family-less
    attendee (e.g. an anonymous guest party) remains selectable for
    formalization; `None` should now only occur for legacy pre-existing
    family-less parties. `children` is youngest first, unknown years last."""

    party_id: uuid.UUID
    display_name: str
    child_count: int
    family_id: uuid.UUID | None
    family_name: str | None
    already_member: bool
    children: list[TermAttendeeChildResponse] = Field(default_factory=list)


class FormalizeGroupFromTermRequest(BaseModel):
    party_ids: list[uuid.UUID] = Field(min_length=1)


# --- My attendances (authenticated, `GET /api/groups/mine/attendances`) --------


class MyPledgeResponse(BaseModel):
    """One row of the caller's own "rzeczy, które obiecałem przynieść" list —
    carries enough to render a panel tile and rebuild the public-term link
    (`organizer_slug` + `group_id` + `term_id`). `registered` is `True` once
    a concrete `InventoryItem` + `LEND` `Reservation` have been opened
    (`resolved_reservation_id` set) — i.e. "Rezygnuję" is no longer offered."""

    pledge_id: uuid.UUID
    status: PledgeStatus
    product_name: str
    item_description: str | None
    term_id: uuid.UUID
    group_id: uuid.UUID
    group_name: str
    occurs_on: datetime
    organizer_slug: str
    registered: bool


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


# --- Account-merge (unauthenticated, `POST /api/groups/public/merge`) ----------


class MergeAnonymousProfileRequest(BaseModel):
    user_profile_id: uuid.UUID
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
    party_id: uuid.UUID


# --- ItemListingPreference (authenticated, `/api/item-listing-preferences`,
# `/api/term-item-listings`) -----------------------------------------------


class SetItemListingPreferenceRequest(BaseModel):
    """`mode=None` clears the item's standing listing preference."""

    mode: ReservationType | None = None

    @field_validator("mode")
    @classmethod
    def _validate_mode(cls, value: ReservationType | None) -> ReservationType | None:
        if value is not None and value not in _OFFERABLE_RESERVATION_TYPES:
            raise ValueError(
                "mode may only be LEND, SWAP or GIFT — RETURN is a lifecycle transition, "
                "never a listing-time choice"
            )
        return value


class ItemListingPreferenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    item_id: uuid.UUID
    owner_party_id: uuid.UUID
    mode: str
    created_at: datetime
    updated_at: datetime


class MyInventoryItemResponse(BaseModel):
    """One row of `GET /api/inventory-items/mine` — an item physically in
    the caller's PERSONAL inventory (a lent-out one is listed by
    `GET /api/inventory-items/mine/lent-out` instead) together with its
    standing `ItemListingPreference.mode` (`None` = not offered), so
    `Moje rzeczy` only ever shows and seeds toggles for items at home.
    `photos_moderation_pending` is true while the item's product has a
    PENDING/NEEDS_REVIEW photo — listing it is refused until then."""

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
    photos_moderation_pending: bool


class LentOutItemResponse(BaseModel):
    """One row of `GET /api/inventory-items/mine/lent-out` — one of the
    caller's items currently sitting in a borrower's VIRTUAL inventory,
    with the borrower's display name and the loan's
    `InventoryBalance.due_date`."""

    id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    condition: ItemCondition
    lent_to_display_name: str
    lent_due_date: datetime | None


class BrowseTermItemListingResponse(BaseModel):
    """One row of "Twoje wystawione rzeczy" (`list_my_term_item_listings`)
    or "Rzeczy od innych" (`list_browsable_term_item_listings`) — one
    `ItemListingPreference`, resolved against `term_id`, plus the cross-BC
    display data (product name/condition from `app.circulation`/
    `app.product`, lister display name from `app.users`) and derived
    status (`resolved_reservation_id`/`taken_by_party_id`, from the item's
    live `Reservation` history — see `_resolve_listing_status`). `id` is the
    item's id: one derived listing per item, not per creation event."""

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


class TakeTermItemListingRequest(BaseModel):
    """`term_id` is the Term context the take happens in (eligibility,
    notification link) — the listing itself is Term-independent. SWAP no
    longer goes through this route (see `take_item_listing`'s docstring) —
    `reservation_type` is only ever `LEND`/`GIFT` here; a SWAP take is
    rejected by `take_item_listing` itself, so this schema no longer carries
    a SWAP-specific `offered_item_id` field (that now lives on
    `ProposeSwapRequest`, dispatched through the dedicated propose/accept/
    reject flow instead)."""

    term_id: uuid.UUID
    reservation_type: ReservationType


# --- Swap proposals (authenticated, `/api/term-item-listings/{id}/propose`,
# `/api/swap-proposals`) ----------------------------------------------------


class ProposeSwapRequest(BaseModel):
    """Body of `POST /api/term-item-listings/{item_id}/propose` — `term_id`
    is the eligibility/notification context (same role as
    `TakeTermItemListingRequest.term_id`), `offered_item_id` is the
    proposer's own counter-offer item."""

    term_id: uuid.UUID
    offered_item_id: uuid.UUID


class CreateJoinRequestRequest(BaseModel):
    """`term_id` is only the link context the requester came from; it must
    belong to the group."""

    term_id: uuid.UUID | None = None


class JoinRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    group_id: uuid.UUID
    requester_party_id: uuid.UUID
    term_id: uuid.UUID | None
    status: GroupJoinRequestStatus
    created_at: datetime
    updated_at: datetime


class PendingJoinRequestResponse(BaseModel):
    id: uuid.UUID
    group_id: uuid.UUID
    group_name: str
    term_id: uuid.UUID | None
    requester_party_id: uuid.UUID
    requester_display_name: str
    created_at: datetime


class JoinRequestSummary(BaseModel):
    """The caller's latest request for a PRIVATE group, as surfaced by
    `/access` — only PENDING or REJECTED are ever reported."""

    id: uuid.UUID
    status: Literal["PENDING", "REJECTED"]


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
