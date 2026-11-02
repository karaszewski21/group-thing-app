"""The item page's action read model behind `GET /api/items/{id}/actions`:
the item's listing mode and availability, its reserved badge (as on the
lists), its owner, how the viewer stands (ANONYMOUS/OWN/OTHER), the owner's
pickup place shaped for the viewer, the owner's upcoming contexts the viewer
may see and, for the two parties of an open reservation or pending swap
proposal, what they may do next. A PRIVATE item is a 404 for anyone who may
not see it (`item_visibility`), is offered only in PRIVATE circles' terms
and is picked up personally only by a party sharing such a circle.

The statement count does not grow with the number of contexts: one terms
statement filtered for the viewer before its limit, one events statement,
then batched eligibility, location and slug lookups. Take, propose and the
transaction actions re-validate all of this on write."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.users.models import UserProfile
from app.users.service import get_profile_by_account_user_id, get_profile_by_principal

from ..infrastructure import circulation_bridge, events_acl, locations_acl, repository
from ..infrastructure.slug_resolver import resolve_organizer_slugs
from ..models import ItemListingPreference, ItemVisibility, SwapProposal
from ..schemas import (
    ExchangeMode,
    ItemActionsOwnerResponse,
    ItemActionsResponse,
    ItemActionsViewer,
    ItemContextOptionResponse,
    ItemLocationResponse,
    ItemPartyReservationResponse,
)
from .item_visibility import require_item_visible
from .owner_items import count_owner_items, owner_summary
from .reserved_by import load_reserved_by_names
from .term_item_listings import is_listing_owner, transaction_action_flags

MAX_CONTEXTS = 5

_OPEN_STATUSES = (
    circulation_bridge.ReservationStatus.PENDING,
    circulation_bridge.ReservationStatus.CONFIRMED,
)


async def get_item_actions(
    db: AsyncSession, item_id: uuid.UUID, principal: Principal | None
) -> ItemActionsResponse:
    """404 first for an item the viewer may not see, then for an unknown or
    deleted item, and for an anonymous caller when the item is not listed
    (as `/details`)."""
    viewer_profile = (
        await get_profile_by_principal(db, principal) if principal is not None else None
    )
    viewer_party_id = viewer_profile.party_id if viewer_profile is not None else None
    await require_item_visible(db, item_id, viewer_party_id)
    item = await circulation_bridge.get_item(db, item_id)
    listed = item.listing_status == circulation_bridge.ItemListingStatus.ACTIVE
    if principal is None and not listed:
        raise EntityNotFoundException("InventoryItem", item_id)

    preference = await repository.get_item_listing_preference(db, item_id)
    mode = cast(ExchangeMode, preference.mode) if preference is not None else None
    private = preference is not None and preference.visibility == ItemVisibility.PRIVATE
    balance_status = (await circulation_bridge.get_item_balance(db, item_id)).status
    open_legs = [
        r
        for r in await circulation_bridge.list_reservations(db, item_id)
        if r.status in _OPEN_STATUSES
    ]
    leg = max(open_legs, key=lambda r: r.created_at) if open_legs else None
    proposals = await repository.list_pending_swap_proposals_for_listing_item(db, item_id)
    available = (
        listed and balance_status == circulation_bridge.BalanceStatus.AVAILABLE and not proposals
    )
    inventory = await circulation_bridge.resolve_owning_inventory(db, item)
    owner = await _owner(db, inventory.owner_user_id)
    viewer = _viewer(viewer_party_id, owner.party_id)

    personal = await circulation_bridge.find_personal_inventory(db, inventory.owner_user_id)
    owner_location_id = personal.location_id if personal is not None else None
    contexts, owner_location = await _contexts(
        db, owner.party_id, viewer_party_id, viewer, owner_location_id, private_item=private
    )
    location = _viewer_location(owner_location, viewer)
    live_location = owner_location is not None and owner_location.deleted_at is None
    reserved_by = leg.reserved_by_user_id if leg is not None else None
    proposer = proposals[0].proposer_party_id if proposals else None
    names = await load_reserved_by_names(
        db,
        [_ReservedState(balance_status, reserved_by, proposer)],
        viewer_party_id,
    )

    return ItemActionsResponse(
        mode=mode,
        visibility=preference.visibility if viewer == "OWN" and preference is not None else None,
        available=available,
        reservation=names.reservation(balance_status, reserved_by, proposer),
        party_reservation=(
            await _party_reservation(db, leg, proposals, viewer_profile, preference)
            if viewer_profile is not None
            else None
        ),
        owner=owner,
        viewer=viewer,
        location=location,
        contexts=contexts,
        personal_pickup_available=(
            viewer == "OTHER"
            and available
            and mode is not None
            and live_location
            and (
                not private
                or await repository.shares_private_circle(
                    db, owner.party_id, cast(uuid.UUID, viewer_party_id)
                )
            )
        ),
    )


@dataclass(frozen=True)
class _ReservedState:
    balance_status: circulation_bridge.BalanceStatus
    reserved_by_user_id: uuid.UUID | None
    proposer_party_id: uuid.UUID | None


async def _owner(db: AsyncSession, owner_user_id: uuid.UUID) -> ItemActionsOwnerResponse:
    """The owning party, named as on the owner items page."""
    profile = await get_profile_by_account_user_id(db, owner_user_id)
    summary = await owner_summary(db, profile)
    return ItemActionsOwnerResponse(
        **summary.model_dump(), items_total=await count_owner_items(db, profile.party_id)
    )


def _viewer(viewer_party_id: uuid.UUID | None, owner_party_id: uuid.UUID) -> ItemActionsViewer:
    if viewer_party_id is None:
        return "ANONYMOUS"
    return "OWN" if viewer_party_id == owner_party_id else "OTHER"


async def _contexts(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    viewer_party_id: uuid.UUID | None,
    viewer: ItemActionsViewer,
    owner_location_id: uuid.UUID | None,
    *,
    private_item: bool,
) -> tuple[list[ItemContextOptionResponse], locations_acl.Location | None]:
    """The owner's earliest upcoming terms and events the viewer may see (a
    term wins a tie), at most `MAX_CONTEXTS`, plus the owner's pickup place
    from the same batched location lookup. `eligible` only for an OTHER
    viewer. A `private_item` gets PRIVATE circles' terms only, filtered in
    SQL before the limit, and no events."""
    # Warsaw wall clock, the clock of `Term.occurs_on` and `Event.starts_at`.
    now = clock.local_now()
    terms = await repository.list_upcoming_owner_terms_for_viewer(
        db, owner_party_id, viewer_party_id, now, limit=MAX_CONTEXTS, private_only=private_item
    )
    events = (
        []
        if private_item
        else await events_acl.list_upcoming_events_for_parties(
            db, [owner_party_id], now, limit=MAX_CONTEXTS
        )
    )
    merged = sorted(
        [(term.occurs_on, 0, index) for index, term in enumerate(terms)]
        + [(upcoming.event.starts_at, 1, index) for index, upcoming in enumerate(events)]
    )[:MAX_CONTEXTS]
    kept_terms = [terms[index] for _, kind, index in merged if kind == 0]
    kept_events = [events[index].event for _, kind, index in merged if kind == 1]

    other_viewer = viewer == "OTHER" and viewer_party_id is not None
    eligible_events = (
        await events_acl.eligible_event_ids(
            db, cast(uuid.UUID, viewer_party_id), [cast(uuid.UUID, e.id) for e in kept_events]
        )
        if other_viewer
        else set()
    )
    location_ids = {term.location_id for term in kept_terms if term.location_id is not None}
    if owner_location_id is not None:
        location_ids.add(owner_location_id)
    locations = await locations_acl.get_locations_by_ids(db, location_ids)
    term_slugs = await resolve_organizer_slugs(db, {term.group_id for term in kept_terms})
    event_slugs = await events_acl.author_slugs(db, kept_events)

    options: list[ItemContextOptionResponse] = []
    for _, kind, index in merged:
        if kind == 0:
            term = terms[index]
            term_location = locations.get(term.location_id) if term.location_id else None
            options.append(
                ItemContextOptionResponse(
                    kind="TERM",
                    id=term.id,
                    name=term.name,
                    starts_at=term.occurs_on,
                    path=f"/{term_slugs[term.group_id]}/group/{term.group_id}/term/{term.id}",
                    # As `TermContext.has_started`.
                    has_started=term.occurs_on < now,
                    location_name=term_location.name if term_location is not None else None,
                    eligible=other_viewer and bool(term.viewer_eligible),
                )
            )
        else:
            upcoming = events[index]
            event_id = cast(uuid.UUID, upcoming.event.id)
            options.append(
                ItemContextOptionResponse(
                    kind="EVENT",
                    id=event_id,
                    name=upcoming.event.name,
                    starts_at=upcoming.event.starts_at,
                    path=f"/{event_slugs[event_id]}/event/{event_id}",
                    # As `EventContext.has_started`.
                    has_started=now >= upcoming.event.starts_at,
                    location_name=upcoming.location_name,
                    eligible=event_id in eligible_events,
                )
            )
    owner_location = locations.get(owner_location_id) if owner_location_id else None
    return options, owner_location


def _viewer_location(
    location: locations_acl.Location | None, viewer: ItemActionsViewer
) -> ItemLocationResponse | None:
    """The owner sees the address and a removal; anyone else logged in only
    the name of a live place; anonymous viewers nothing. Never coordinates,
    the Google place id or notes."""
    if location is None or viewer == "ANONYMOUS":
        return None
    if viewer == "OWN":
        return ItemLocationResponse(
            name=location.name,
            formatted_address=location.formatted_address,
            deleted_at=location.deleted_at,
        )
    if location.deleted_at is not None:
        return None
    return ItemLocationResponse(name=location.name, formatted_address=None, deleted_at=None)


async def _party_reservation(
    db: AsyncSession,
    leg: circulation_bridge.Reservation | None,
    proposals: list[SwapProposal],
    viewer: UserProfile,
    preference: ItemListingPreference | None,
) -> ItemPartyReservationResponse | None:
    """The viewer's part in the item's newest open reservation `leg` (GIVER
    holds the item, RECEIVER gets it), else in one of its PROPOSED swap
    `proposals` (the listing owner, oldest proposal first; or the proposer's
    own); `None` for anyone else."""
    user_id = cast(uuid.UUID, viewer.account_user_id)
    if leg is not None and user_id in (leg.reserved_by_user_id, leg.giver_user_id):
        can_confirm, can_cancel = await transaction_action_flags(db, leg, user_id)
        return ItemPartyReservationResponse(
            role="GIVER" if user_id == leg.giver_user_id else "RECEIVER",
            reservation_id=cast(uuid.UUID, leg.id),
            proposal_id=None,
            reservation_type=leg.reservation_type,
            personal_pickup=leg.term_id is None and leg.event_id is None,
            can_confirm=can_confirm,
            can_cancel=can_cancel,
            can_accept=False,
            can_reject=False,
        )

    owns = is_listing_owner(preference, viewer.party_id)
    proposal = next((p for p in proposals if owns or p.proposer_party_id == viewer.party_id), None)
    if proposal is None:
        return None
    proposer_leg = await circulation_bridge.get_reservation(db, proposal.proposer_reservation_id)
    return ItemPartyReservationResponse(
        role="GIVER" if owns else "RECEIVER",
        reservation_id=None,
        proposal_id=cast(uuid.UUID, proposal.id),
        reservation_type=circulation_bridge.ReservationType.SWAP,
        personal_pickup=proposer_leg.term_id is None and proposer_leg.event_id is None,
        can_confirm=False,
        can_cancel=False,
        can_accept=owns,
        can_reject=owns,
    )
