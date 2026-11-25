"""Item valuation under the current config: the value stored on an item
(`service.compute_item_points_value`) and the preview the item forms show
before saving (`GET /api/points/item-value`)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFoundException
from app.points.application.config import load_config
from app.points.domain.valuation import item_points_value
from app.points.infrastructure import category_acl
from app.points.schemas import ItemPointsValueResponse


async def value_for(db: AsyncSession, size_class: str, condition: str) -> int:
    """`size_class` × `condition` under the current config, snapped."""
    config = await load_config(db)
    return item_points_value(
        size_class,
        condition,
        bases={
            "SMALL": config.base_small,
            "MEDIUM": config.base_medium,
            "LARGE": config.base_large,
        },
        multipliers={
            "NEW": config.multiplier_new,
            "LIKE_NEW": config.multiplier_like_new,
            "GOOD": config.multiplier_good,
            "FAIR": config.multiplier_fair,
            "POOR": config.multiplier_poor,
        },
    )


async def item_value_preview(
    db: AsyncSession, category_id: uuid.UUID, condition: str
) -> ItemPointsValueResponse:
    """What an item in `category_id` and `condition` would be worth if saved
    now; 404 for an unknown category."""
    size_class = await category_acl.resolve_category_size_class(db, category_id)
    if size_class is None:
        raise EntityNotFoundException("Category", category_id)
    return ItemPointsValueResponse(points_value=await value_for(db, size_class, condition))
