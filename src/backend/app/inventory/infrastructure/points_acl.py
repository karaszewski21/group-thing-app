"""Anti-corruption layer over `app.points`: the ONLY `app.inventory` module
that imports the points context. An item stores its `points_value`; points
computes it from the product's size class and the item's condition. A
cancelled POINTS reservation gives its HOLD back (RELEASE) in the caller's
commit; points only flushes."""

from __future__ import annotations

import uuid
from collections.abc import Collection

from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import ItemCondition
from app.points import service as points_service


async def item_points_value(
    db: AsyncSession, product_id: uuid.UUID, condition: ItemCondition
) -> int:
    return await points_service.compute_item_points_value(db, product_id, condition.value)


async def release_hold(db: AsyncSession, reservation_id: uuid.UUID) -> None:
    """RELEASE of a POINTS reservation's HOLD back to the buyer; 409 once
    it was sold, a no-op once released."""
    await points_service.release_hold(db, reservation_id)


async def lock_release_accounts(db: AsyncSession, reservation_ids: Collection[uuid.UUID]) -> None:
    """Locks every buyer's point accounts of these POINTS reservations in
    one sorted call, so the per-row `release_hold` that follows never waits."""
    await points_service.lock_release_accounts(db, reservation_ids)
