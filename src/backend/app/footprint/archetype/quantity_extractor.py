"""Quantity extraction from a calculation context.

Direct port of the Java `archetype.pricing.QuantityExtractor` interface.
"""

from __future__ import annotations

from collections.abc import Callable
from decimal import Decimal
from typing import Protocol

from app.footprint.archetype.parameter_value import ParameterValue


class QuantityExtractor(Protocol):
    """Derives the physical quantity a `Calculator` multiplies a rate by."""

    def extract(self, context: ParameterValue) -> Decimal: ...


class FunctionQuantityExtractor:
    """Adapts a plain formula function into the `QuantityExtractor` protocol."""

    def __init__(self, formula: Callable[[ParameterValue], Decimal]) -> None:
        self._formula = formula

    def extract(self, context: ParameterValue) -> Decimal:
        return self._formula(context)
