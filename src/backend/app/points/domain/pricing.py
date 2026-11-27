"""The owner-set POINTS price: the range around an item's suggested value
`s` that the config's ratios, cap and step allow. Pure; all rounding is
Decimal half-up to the step, never Python's banker's `round()`."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True, slots=True)
class PriceBounds:
    min: int
    max: int
    step: int


def round_step(value: Decimal, step: int) -> int:
    return int((value / step).quantize(Decimal(1), ROUND_HALF_UP)) * step


def price_bounds(
    suggestion: int, *, min_ratio: Decimal, max_ratio: Decimal, cap: int, step: int
) -> PriceBounds:
    """`max = min(cap, max(step, round_step(s × max_ratio)))` and
    `min = max(step, round_step(s × min_ratio))`, with `min` lowered to
    `max` when it lies above it."""
    s = Decimal(suggestion)
    highest = min(cap, max(step, round_step(s * max_ratio, step)))
    lowest = min(max(step, round_step(s * min_ratio, step)), highest)
    return PriceBounds(lowest, highest, step)


def is_valid_price(price: int, bounds: PriceBounds) -> bool:
    return bounds.min <= price <= bounds.max and price % bounds.step == 0


def clamp_price(price: int, bounds: PriceBounds) -> int:
    """`price` rounded to the step, then moved into the bounds; both bounds
    are on the step (the config keeps the cap a multiple of it), so the
    result is always a valid price."""
    return min(max(round_step(Decimal(price), bounds.step), bounds.min), bounds.max)
