"""Validity windows and versioned emission factors.

Direct port of the Java `archetype.pricing.Validity`/`ComponentVersion` records.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from app.footprint.archetype.component import ComponentId


@dataclass(frozen=True, slots=True)
class Validity:
    """A half-open validity interval `[valid_from, valid_to)`."""

    valid_from: datetime
    valid_to: datetime

    def covers(self, t: datetime) -> bool:
        """True if `t` falls within `[valid_from, valid_to)`."""
        return self.valid_from <= t < self.valid_to

    def overlaps(self, other: Validity) -> bool:
        """True if this interval and `other` share any instant."""
        return self.valid_from < other.valid_to and other.valid_from < self.valid_to

    @staticmethod
    def assert_non_overlapping(windows: Sequence[Validity]) -> None:
        """Pairwise O(n^2) non-overlap check; raises on the first overlapping pair found."""
        for i in range(len(windows)):
            for j in range(i + 1, len(windows)):
                a, b = windows[i], windows[j]
                if a.overlaps(b):
                    raise ValueError(f"Overlapping validity windows: {a} and {b}")


@dataclass(frozen=True, slots=True)
class ComponentVersion:
    """A rate applicable to a component for a specific validity window."""

    component_id: ComponentId
    factor_version_id: str
    rate: Decimal
    validity: Validity
