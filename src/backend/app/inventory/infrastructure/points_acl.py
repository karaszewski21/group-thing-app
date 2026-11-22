"""Anti-corruption layer over `app.points`: the ONLY `app.inventory` module
that imports the points context. An item stores its `points_value`; points
computes it from the product's size class and the item's condition."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.inventory.models import ItemCondition
from app.points import service as points_service


async def item_points_value(
    db: AsyncSession, product_id: uuid.UUID, condition: ItemCondition
) -> int:
    return await points_service.compute_item_points_value(db, product_id, condition.value)
