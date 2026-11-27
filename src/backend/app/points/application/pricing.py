"""The POINTS price rules under the current config: the bounds the item
forms show and the listing PUT enforces, and the per-owner offer limit."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.points.application.config import load_config
from app.points.domain.pricing import PriceBounds, price_bounds


async def bounds_for(db: AsyncSession, suggestion: int) -> PriceBounds:
    config = await load_config(db)
    return price_bounds(
        suggestion,
        min_ratio=config.price_min_ratio,
        max_ratio=config.price_max_ratio,
        cap=config.price_cap,
        step=config.price_step,
    )


async def max_points_offers(db: AsyncSession) -> int:
    """How many POINTS listings one owner may hold."""
    return (await load_config(db)).max_points_offers
