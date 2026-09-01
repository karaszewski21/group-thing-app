"""Centralized kg CO2 rounding rule.

Direct port of the Java `internal.RoundingPolicy`. Applied everywhere a kg_co2 value is
produced or rescaled.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

_KG_CO2_QUANTUM = Decimal("0.0001")


class RoundingPolicy:
    @staticmethod
    def round(value: Decimal) -> Decimal:
        return value.quantize(_KG_CO2_QUANTUM, rounding=ROUND_HALF_UP)
