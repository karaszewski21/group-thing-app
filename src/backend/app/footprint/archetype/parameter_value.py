"""Request-time context passed to `QuantityExtractor`s during footprint calculation.

Direct port of the Java `archetype.pricing.ParameterValue` record.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

_ZERO = Decimal("0")


@dataclass(frozen=True, slots=True)
class ParameterValue:
    """Fully-resolved calculation context. The 4 Decimal fields are never `None` here —
    use `ParameterValue.create(...)` when any of them may be absent from the caller's
    perspective; it null-coalesces each to `Decimal("0")` before construction.
    """

    product_id: str
    material_weight_kg: Decimal
    supplier_distance_km: Decimal
    destination_distance_km: Decimal
    last_mile_distance_km: Decimal
    storage_days: int = 0
    requires_refrigeration: bool = False

    @staticmethod
    def create(
        product_id: str,
        material_weight_kg: Decimal | None = None,
        supplier_distance_km: Decimal | None = None,
        destination_distance_km: Decimal | None = None,
        last_mile_distance_km: Decimal | None = None,
        storage_days: int = 0,
        requires_refrigeration: bool = False,
    ) -> ParameterValue:
        """Null-coalescing factory: any absent Decimal field defaults to `Decimal("0")`."""
        return ParameterValue(
            product_id=product_id,
            material_weight_kg=material_weight_kg if material_weight_kg is not None else _ZERO,
            supplier_distance_km=(
                supplier_distance_km if supplier_distance_km is not None else _ZERO
            ),
            destination_distance_km=(
                destination_distance_km if destination_distance_km is not None else _ZERO
            ),
            last_mile_distance_km=(
                last_mile_distance_km if last_mile_distance_km is not None else _ZERO
            ),
            storage_days=storage_days,
            requires_refrigeration=requires_refrigeration,
        )
