"""The `app.points` facade called by the consumer ACLs
(`inventory/infrastructure/points_acl.py`, `groups/infrastructure/points_acl.py`)."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.points.application import valuation
from app.points.application.awards import ExchangeLeg, award_attendance, award_exchange
from app.points.application.config import load_config
from app.points.application.pricing import bounds_for, max_points_offers
from app.points.application.purchases import (
    Purchase,
    PurchaseConflictException,
    lock_owner_accounts,
    lock_purchase,
    lock_release_accounts,
    post_hold,
    release_hold,
    settle_sale,
)
from app.points.domain.pricing import PriceBounds, clamp_price, is_valid_price
from app.points.infrastructure import category_acl
from app.points.infrastructure.ledger import hold_amounts

__all__ = [
    "AttendanceRules",
    "ExchangeLeg",
    "PriceBounds",
    "Purchase",
    "PurchaseConflictException",
    "attendance_rules",
    "award_attendance",
    "award_exchange",
    "bounds_for",
    "clamp_price",
    "compute_item_points_value",
    "hold_amounts",
    "is_valid_price",
    "lock_owner_accounts",
    "lock_purchase",
    "lock_release_accounts",
    "max_points_offers",
    "post_hold",
    "release_hold",
    "settle_sale",
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
    size_class = await category_acl.resolve_size_class(db, product_id)
    return await valuation.value_for(db, size_class, condition)
