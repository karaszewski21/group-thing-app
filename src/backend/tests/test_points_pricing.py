"""The POINTS price domain (spec R2): bounds around a suggestion `s` from the
config ratios, rounded half-up to the step and capped, plus the validity
and clamp rules the listing PUT applies."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

import pytest

from app.points.domain.pricing import (
    PriceBounds,
    clamp_price,
    is_valid_price,
    price_bounds,
    round_step,
)


def _bounds(
    suggestion: int, *, max_ratio: Decimal = Decimal("1.50"), step: int = 10
) -> PriceBounds:
    """The bounds under the seeded config (0.50 / 1.50 / cap 100 / step 10)."""
    return price_bounds(
        suggestion, min_ratio=Decimal("0.50"), max_ratio=max_ratio, cap=100, step=step
    )


@pytest.mark.parametrize(
    ("suggestion", "overrides", "expected"),
    [
        (20, {}, PriceBounds(10, 30, 10)),
        (40, {}, PriceBounds(20, 60, 10)),
        (60, {}, PriceBounds(30, 90, 10)),
        (80, {}, PriceBounds(40, 100, 10)),
        (300, {}, PriceBounds(100, 100, 10)),  # min 150 > max 100 collapses
        (2, {}, PriceBounds(10, 10, 10)),  # `max(step, …)` guard on both ends
        (30, {"max_ratio": Decimal("1.15"), "step": 1}, PriceBounds(15, 35, 1)),
    ],
)
def test_priceBounds_acceptanceTable(
    suggestion: int, overrides: dict[str, Any], expected: PriceBounds
) -> None:
    assert _bounds(suggestion, **overrides) == expected


def test_priceBounds_anySuggestion_neverAboveCap() -> None:
    for suggestion in range(0, 1001):
        bounds = _bounds(suggestion)
        assert bounds.min <= bounds.max <= 100, suggestion


@pytest.mark.parametrize(
    ("value", "step", "expected"),
    [(Decimal(45), 10, 50), (Decimal(44), 10, 40), (Decimal("34.5"), 1, 35), (Decimal(15), 10, 20)],
)
def test_roundStep_halfUp(value: Decimal, step: int, expected: int) -> None:
    assert round_step(value, step) == expected


@pytest.mark.parametrize(
    ("price", "valid"), [(55, False), (50, True), (20, True), (60, True), (10, False), (70, False)]
)
def test_isValidPrice_rangeAndStep(price: int, valid: bool) -> None:
    assert is_valid_price(price, PriceBounds(20, 60, 10)) is valid


@pytest.mark.parametrize(("price", "expected"), [(5, 20), (100, 60), (40, 40)])
def test_clampPrice_outsideToNearestBound(price: int, expected: int) -> None:
    assert clamp_price(price, PriceBounds(20, 60, 10)) == expected


@pytest.mark.parametrize(
    ("price", "bounds", "expected"),
    [
        (20, PriceBounds(15, 60, 15), 15),
        (23, PriceBounds(15, 60, 15), 30),
        (44, PriceBounds(20, 60, 10), 40),
        (45, PriceBounds(20, 60, 10), 50),
        (59, PriceBounds(15, 60, 15), 60),
    ],
)
def test_clampPrice_offStep_snapsToStepWithinBounds(
    price: int, bounds: PriceBounds, expected: int
) -> None:
    clamped = clamp_price(price, bounds)
    assert clamped == expected
    assert is_valid_price(clamped, bounds)
