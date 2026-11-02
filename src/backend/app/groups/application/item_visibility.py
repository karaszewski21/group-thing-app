"""Who may see a listed item. A PUBLIC item (or one without a listing
preference) follows each read path's own rules. A PRIVATE item is seen only
by its owner, a party sharing a non-deleted PRIVATE circle with the owner
(standing member or current organizer) and a current counterparty: a party
to its open reservation or the proposer of a pending swap proposal on it.
An RSVP alone is not membership, so an RSVP-only non-member gets a 404.

Every item read path, take/propose and the creation of a new ITEM
conversation call this first, so a hidden item is a 404 before any 403 or
409 could reveal it."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.users.service import get_profile_by_principal

from ..infrastructure import circulation_bridge, repository
from ..models import ItemListingPreference, ItemVisibility

_OPEN_STATUSES = (
    circulation_bridge.ReservationStatus.PENDING,
    circulation_bridge.ReservationStatus.CONFIRMED,
)


async def can_view_item(
    db: AsyncSession, item_id: uuid.UUID, viewer_party_id: uuid.UUID | None
) -> bool:
    preference = await repository.get_item_listing_preference(db, item_id)
    if preference is None or preference.visibility != ItemVisibility.PRIVATE:
        return True
    if viewer_party_id is None:
        return False
    return await _may_see_private(db, preference, viewer_party_id)


async def _may_see_private(
    db: AsyncSession, preference: ItemListingPreference, viewer_party_id: uuid.UUID
) -> bool:
    if viewer_party_id == preference.owner_party_id:
        return True
    if await repository.shares_private_circle(db, preference.owner_party_id, viewer_party_id):
        return True
    return await _is_counterparty(db, preference.item_id, viewer_party_id)


async def _is_counterparty(
    db: AsyncSession, item_id: uuid.UUID, viewer_party_id: uuid.UUID
) -> bool:
    proposals = await repository.list_pending_swap_proposals_for_listing_item(db, item_id)
    if any(proposal.proposer_party_id == viewer_party_id for proposal in proposals):
        return True
    open_legs = [
        r
        for r in await circulation_bridge.list_reservations(db, item_id)
        if r.status in _OPEN_STATUSES
    ]
    if not open_legs:
        return False
    profiles = await repository.list_profile_names_by_account_user_ids(
        db, {user_id for r in open_legs for user_id in (r.reserved_by_user_id, r.giver_user_id)}
    )
    return any(profile.party_id == viewer_party_id for profile in profiles)


async def require_item_visible(
    db: AsyncSession, item_id: uuid.UUID, viewer_party_id: uuid.UUID | None
) -> None:
    if not await can_view_item(db, item_id, viewer_party_id):
        raise EntityNotFoundException("InventoryItem", item_id)


async def require_item_visible_to(
    db: AsyncSession, item_id: uuid.UUID, principal: Principal | None
) -> None:
    """`require_item_visible` for a request principal, resolved to its party
    only when the item is PRIVATE; an unresolvable principal is anonymous.
    The circulation router's gate on `/details`, `/history`, `/balance` and
    `GET /api/inventory-items/{id}`."""
    preference = await repository.get_item_listing_preference(db, item_id)
    if preference is None or preference.visibility != ItemVisibility.PRIVATE:
        return
    viewer_party_id: uuid.UUID | None = None
    if principal is not None:
        try:
            viewer_party_id = (await get_profile_by_principal(db, principal)).party_id
        except EntityNotFoundException:
            viewer_party_id = None
    if viewer_party_id is None or not await _may_see_private(db, preference, viewer_party_id):
        raise EntityNotFoundException("InventoryItem", item_id)
