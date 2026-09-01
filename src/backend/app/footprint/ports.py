"""SPI boundary between the footprint engine and its (currently stub-only) data sources.

Direct port of the Java `internal.ports.EmissionFactorPort`/`ProductAttributesPort`
interfaces. `app/footprint/stubs.py` provides the only implementations; wiring a real
adapter is explicitly out of scope for this migration.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Protocol

from app.footprint.archetype.component import ComponentId
from app.footprint.archetype.validity import ComponentVersion


class EmissionFactorPort(Protocol):
    """Resolves versioned emission factors for a component."""

    def version_at(self, component_id: ComponentId, t: datetime) -> ComponentVersion | None: ...

    def factor_version_by_id(self, factor_version_id: str) -> ComponentVersion | None: ...


@dataclass(frozen=True, slots=True)
class ProductAttributes:
    """Stored per-product defaults merged into a request's `ParameterValue`."""

    product_id: str
    material_weight_kg: Decimal
    supplier_distance_km: Decimal
    destination_distance_km: Decimal
    last_mile_distance_km: Decimal
    requires_refrigeration: bool


class ProductAttributesPort(Protocol):
    """Resolves stored product attributes by product id."""

    def find_by_id(self, product_id: str) -> ProductAttributes | None: ...
