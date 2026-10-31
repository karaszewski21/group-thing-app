"""The item page's action read model behind `GET /api/items/{id}/actions`:
the item's listing mode and availability, its owner, the requested term or
event (a hint from the URL) and how the viewer stands in it.

The context is shown only when it exists, the owner is eligible in it, and
it is public (an event, or a term of a PUBLIC circle) or the viewer is
eligible in it; otherwise it is null, never a 404. Take and propose
re-validate all of this on write."""

from __future__ import annotations

import uuid
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.users.service import get_profile_by_account_user_id, get_profile_by_principal

from ..infrastructure import circulation_bridge, events_acl, repository
from ..models import GroupVisibility
from ..schemas import (
    ExchangeMode,
    ItemActionsOwnerResponse,
    ItemActionsResponse,
    ItemActionsViewer,
)
from .owner_items import count_owner_items, get_owner_nearest, owner_summary
from .reservation_context import EventContext, ReservationContext, TermContext
from .terms import get_term


async def get_item_actions(
    db: AsyncSession,
    item_id: uuid.UUID,
    principal: Principal | None,
    term_id: uuid.UUID | None,
    event_id: uuid.UUID | None,
) -> ItemActionsResponse:
    """404 for an unknown or deleted item, and for an anonymous caller when
    the item is not listed (as `/details`). The router rejects `term` and
    `event` given together; `event_id` wins if both still arrive."""
    item = await circulation_bridge.get_item(db, item_id)
    listed = item.listing_status == circulation_bridge.ItemListingStatus.ACTIVE
    if principal is None and not listed:
        raise EntityNotFoundException("InventoryItem", item_id)

    preference = await repository.get_item_listing_preference(db, item_id)
    available = listed and (
        (await circulation_bridge.get_item_balance(db, item_id)).status
        == circulation_bridge.BalanceStatus.AVAILABLE
    )
    owner = await _owner(db, item)
    viewer_party_id = (
        (await get_profile_by_principal(db, principal)).party_id if principal is not None else None
    )

    context, public = await _load_context(db, term_id, event_id)
    viewer_eligible = (
        context is not None
        and viewer_party_id is not None
        and await _is_eligible(db, context, viewer_party_id)
    )
    if context is not None and not (
        await _is_eligible(db, context, owner.party_id) and (public or viewer_eligible)
    ):
        context = None
        viewer_eligible = False

    return ItemActionsResponse(
        mode=cast(ExchangeMode, preference.mode) if preference is not None else None,
        available=available,
        owner=owner,
        context=await context.to_response(db) if context is not None else None,
        viewer=_viewer(viewer_party_id, owner.party_id, viewer_eligible),
        nearest=await get_owner_nearest(db, owner.party_id),
    )


async def _owner(
    db: AsyncSession, item: circulation_bridge.InventoryItem
) -> ItemActionsOwnerResponse:
    """The owning party, named as on the owner items page."""
    inventory = await circulation_bridge.resolve_owning_inventory(db, item)
    profile = await get_profile_by_account_user_id(db, inventory.owner_user_id)
    summary = await owner_summary(db, profile)
    return ItemActionsOwnerResponse(
        **summary.model_dump(), items_total=await count_owner_items(db, profile.party_id)
    )


async def _load_context(
    db: AsyncSession, term_id: uuid.UUID | None, event_id: uuid.UUID | None
) -> tuple[ReservationContext | None, bool]:
    """The requested context and whether it is public; `(None, False)` when
    it does not exist (or its circle is soft-deleted)."""
    if event_id is not None:
        event = await events_acl.get_event(db, event_id)
        return (EventContext(event=event), True) if event is not None else (None, False)
    if term_id is None:
        return None, False
    try:
        term = await get_term(db, term_id)
    except EntityNotFoundException:
        return None, False
    group = await repository.get_group(db, term.circle_group_id)
    if group is None:
        return None, False
    context = TermContext(term=term, display_name=group.name)
    return context, group.visibility == GroupVisibility.PUBLIC


async def _is_eligible(db: AsyncSession, context: ReservationContext, party_id: uuid.UUID) -> bool:
    try:
        await context.require_eligibility(db, party_id)
    except AccessDeniedException:
        return False
    return True


def _viewer(
    viewer_party_id: uuid.UUID | None, owner_party_id: uuid.UUID, eligible: bool
) -> ItemActionsViewer:
    if viewer_party_id is None:
        return "ANONYMOUS"
    if viewer_party_id == owner_party_id:
        return "OWN"
    return "ELIGIBLE" if eligible else "NOT_ELIGIBLE"
