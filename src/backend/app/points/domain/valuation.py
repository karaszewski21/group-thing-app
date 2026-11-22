"""An item's points value: `base[size_class] × multiplier[condition]`,
snapped to one of the three fixed values 20/40/60. Size classes and
conditions are this context's own string keys."""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal

DEFAULT_SIZE_CLASS = "MEDIUM"


def snap(raw: Decimal) -> int:
    if raw < 30:
        return 20
    if raw < 50:
        return 40
    return 60


def item_points_value(
    size_class: str,
    condition: str,
    bases: Mapping[str, int],
    multipliers: Mapping[str, Decimal],
) -> int:
    return snap(Decimal(bases[size_class]) * multipliers[condition])
