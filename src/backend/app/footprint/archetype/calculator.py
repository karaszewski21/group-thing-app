"""Rate x quantity calculation.

Direct port of the Java `archetype.pricing.CalculatorId`/`Calculator`/`SimpleFixedCalculator`.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Protocol

_KG_CO2_QUANTUM = Decimal("0.0001")


@dataclass(frozen=True, slots=True)
class CalculatorId:
    """Non-blank identifier for a `Calculator` implementation."""

    value: str

    def __post_init__(self) -> None:
        if not self.value or not self.value.strip():
            raise ValueError("CalculatorId value must not be blank")


class Calculator(Protocol):
    """Combines a factor rate and an extracted quantity into a kg CO2 value."""

    def calculate(self, rate: Decimal, quantity: Decimal) -> Decimal: ...


class SimpleFixedCalculator:
    """The only `Calculator` implementation: `(rate * quantity)` rounded HALF_UP to 4dp.

    Used unconditionally regardless of a component's declared `calculator_id` (matches
    the Java source, which never actually dispatches on `CalculatorId`).
    """

    def calculate(self, rate: Decimal, quantity: Decimal) -> Decimal:
        return (rate * quantity).quantize(_KG_CO2_QUANTUM, rounding=ROUND_HALF_UP)
