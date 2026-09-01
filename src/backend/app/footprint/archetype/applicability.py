"""Applicability conditions controlling whether a component is active for a given request context.

Direct port of the Java `archetype.pricing.Applicability` enum.
"""

from __future__ import annotations

from enum import Enum
from typing import TYPE_CHECKING, assert_never

if TYPE_CHECKING:
    from app.footprint.archetype.parameter_value import ParameterValue


class Applicability(Enum):
    """Whether a component participates in a calculation for the given context."""

    ALWAYS = "ALWAYS"
    REFRIGERATED_ONLY = "REFRIGERATED_ONLY"

    def is_active(self, context: ParameterValue) -> bool:
        """Resolve whether this applicability condition holds for the given context."""
        match self:
            case Applicability.ALWAYS:
                return True
            case Applicability.REFRIGERATED_ONLY:
                return context.requires_refrigeration
            case _:
                assert_never(self)
