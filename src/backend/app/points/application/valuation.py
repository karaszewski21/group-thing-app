"""Item valuation under the current config: the value stored on an item
(`service.compute_item_points_value`), and what the item forms show
(`GET /api/points/item-value`): an existing item's stored value or the
preview before saving, each with its POINTS price range."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.points.application.config import load_config
from app.points.application.pricing import bounds_for
from app.points.domain.valuation import item_points_value
from app.points.infrastructure import category_acl, inventory_acl, users_acl
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
    return await _with_bounds(db, await value_for(db, size_class, condition))


async def owned_item_value(
    db: AsyncSession, principal: Principal, item_id: uuid.UUID
) -> ItemPointsValueResponse:
    """The stored value of the caller's own item and its price range, the
    source the edit form and the listing PUT share. 404 for an unknown or
    deleted item before the 403 for someone else's; all null when the item
    has no stored value."""
    item = await inventory_acl.owned_item(db, item_id)
    if item is None:
        raise EntityNotFoundException("InventoryItem", item_id)
    if item.owner_user_id != await users_acl.caller_user_id(db, principal):
        raise AccessDeniedException
    if item.points_value is None:
        return ItemPointsValueResponse(
            points_value=None, price_min=None, price_max=None, price_step=None
        )
    return await _with_bounds(db, item.points_value)


async def _with_bounds(db: AsyncSession, points_value: int) -> ItemPointsValueResponse:
    bounds = await bounds_for(db, points_value)
    return ItemPointsValueResponse(
        points_value=points_value,
        price_min=bounds.min,
        price_max=bounds.max,
        price_step=bounds.step,
    )
