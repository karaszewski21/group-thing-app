"""The `app.points` facade called by the consumer ACLs
(`inventory/infrastructure/points_acl.py`, `groups/infrastructure/points_acl.py`)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.points.application.awards import ExchangeLeg, award_attendance, award_exchange
from app.points.application.config import load_config
from app.points.domain.valuation import item_points_value
from app.points.infrastructure import category_acl

__all__ = [
    "AttendanceRules",
    "ExchangeLeg",
    "attendance_rules",
    "award_attendance",
    "award_exchange",
    "compute_item_points_value",
]


@dataclass(frozen=True, slots=True)
class AttendanceRules:
    """The attendance settings of the current config; `levels` ascending."""

    levels: list[int]
    min_present: int
    auto_close_days: int


async def attendance_rules(db: AsyncSession) -> AttendanceRules:
    config = await load_config(db)
    return AttendanceRules(
        levels=list(config.attendance_levels),
        min_present=config.attendance_min_present,
        auto_close_days=config.attendance_auto_close_days,
    )


async def compute_item_points_value(db: AsyncSession, product_id: uuid.UUID, condition: str) -> int:
    """The value of an item of `product_id` in `condition` under the current
    config; the caller stores it, later config or size class changes never
    touch it."""
    config = await load_config(db)
    return item_points_value(
        await category_acl.resolve_size_class(db, product_id),
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
