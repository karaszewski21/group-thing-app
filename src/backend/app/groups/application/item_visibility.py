"""Who may see an item: anyone when it has no listing preference, otherwise
whoever `items_visible_to(viewer, ALL)` admits. A PUBLIC item passes
whatever its balance (reserved, given away, lent). A PRIVATE item is seen
only by its owner, a party sharing a non-deleted PRIVATE circle with the
owner (standing member or current organizer) and a current counterparty: a
party to its open reservation or the proposer of a pending swap proposal on
it. An RSVP alone is not membership, so an RSVP-only non-member gets a 404.

Every item read path, take/propose and the creation of a new ITEM
conversation call this first, so a hidden item is a 404 before any 403 or
409 could reveal it."""

from __future__ import annotations

import uuid

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.users.service import get_profile_by_principal

from ..infrastructure.visibility import VisibilityScope, items_visible_to
from ..models import ItemListingPreference


async def can_view_item(
    db: AsyncSession, item_id: uuid.UUID, viewer_party_id: uuid.UUID | None
) -> bool:
    """One statement."""
    of_item = ItemListingPreference.item_id == item_id
    visible = or_(
        ~exists().where(of_item),
        exists().where(of_item, items_visible_to(viewer_party_id, VisibilityScope.ALL)),
    )
    return bool(await db.scalar(select(visible)))


async def require_item_visible(
    db: AsyncSession, item_id: uuid.UUID, viewer_party_id: uuid.UUID | None
) -> None:
    if not await can_view_item(db, item_id, viewer_party_id):
        raise EntityNotFoundException("InventoryItem", item_id)


async def require_item_visible_to(
    db: AsyncSession, item_id: uuid.UUID, principal: Principal | None
) -> None:
    """`require_item_visible` for a request principal; an unresolvable
    principal is anonymous. The inventory router's gate on `/details`,
    `/history`, `/balance` and `GET /api/inventory-items/{id}`."""
    viewer_party_id: uuid.UUID | None = None
    if principal is not None:
        try:
            viewer_party_id = (await get_profile_by_principal(db, principal)).party_id
        except EntityNotFoundException:
            viewer_party_id = None
    await require_item_visible(db, item_id, viewer_party_id)
