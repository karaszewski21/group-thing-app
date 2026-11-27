"""Pydantic request/response models for `/api/points`. The requests check
only the shape; the ranges with a Polish message are applied by
`application/config.py`, so a bad value is a 400 with that message."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict


class PointsConfigResponse(BaseModel):
    """Every `points_config` field plus `updated_at`, the token the PUT sends
    back. Multipliers are plain numbers, as coordinates are."""

    model_config = ConfigDict(from_attributes=True)

    base_small: int
    base_medium: int
    base_large: int
    multiplier_new: float
    multiplier_like_new: float
    multiplier_good: float
    multiplier_fair: float
    multiplier_poor: float
    swap_award: int
    wants_bonus: int
    attendance_levels: list[int]
    attendance_monthly_cap: int
    attendance_min_present: int
    attendance_auto_close_days: int
    pair_reward_limit: int
    pair_window_days: int
    max_points_offers: int
    price_min_ratio: float
    price_max_ratio: float
    price_cap: int
    price_step: int
    updated_at: datetime


class UpdatePointsConfigRequest(BaseModel):
    """A full replace; `updated_at` is the value the client read."""

    model_config = ConfigDict(extra="forbid")

    base_small: int
    base_medium: int
    base_large: int
    multiplier_new: Decimal
    multiplier_like_new: Decimal
    multiplier_good: Decimal
    multiplier_fair: Decimal
    multiplier_poor: Decimal
    swap_award: int
    wants_bonus: int
    attendance_levels: list[int]
    attendance_monthly_cap: int
    attendance_min_present: int
    attendance_auto_close_days: int
    pair_reward_limit: int
    pair_window_days: int
    max_points_offers: int
    price_min_ratio: Decimal
    price_max_ratio: Decimal
    price_cap: int
    price_step: int
    updated_at: datetime


class AttendanceRulesResponse(BaseModel):
    """What the add-term form needs: the allowed levels, ascending."""

    levels: list[int]
    min_present: int
    auto_close_days: int


ItemConditionKey = Literal["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"]


class ItemPointsValueResponse(BaseModel):
    """An item's value (20, 40 or 60) and the POINTS price range around it:
    the stored value for an existing item, else what a new or changed one
    would be worth if saved now. All null for an item without a stored
    value."""

    points_value: int | None
    price_min: int | None
    price_max: int | None
    price_step: int | None


class PointsSummaryResponse(BaseModel):
    """The caller's own available `balance` (PARTY account), `held` points
    (HELD account) and `reputation`; 0 for an account that does not exist."""

    balance: int
    held: int
    reputation: int


class PointHistoryEntryResponse(BaseModel):
    """The caller's side of one transaction. `id` is the transaction's id,
    `amount` the sum of its entries on the caller's PARTY account and
    `held_amount` on the HELD account (0 when none), `reputation` the amount
    for GIVE_FREE (0 otherwise), and `counterparty_name` the other party's
    display name, null for ATTENDANCE."""

    id: uuid.UUID
    type: str
    amount: int
    held_amount: int
    reputation: int
    description: str
    counterparty_name: str | None
    occurred_at: datetime
