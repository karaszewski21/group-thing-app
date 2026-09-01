"""In-memory SPI stub implementations (fixed decision #4 — stay stubs, no real adapter).

Direct port of the Java `spi.stub.InMemoryEmissionFactorPort`/`InMemoryProductAttributesPort`.

Seed-data note: spec.md fixes `raw-material`'s two rates (0.90/0.95) and every leaf's
overall validity coverage (`raw-material` split across two adjacent windows spanning
2026-01-01T00:00:00Z-2027-01-01T00:00:00Z; every other leaf a single window over the same
span), but does not fix the *rate* for any leaf other than `raw-material`, nor the exact
attribute values for `OFB-330`/`CAW-042`/the 14 electronics SKUs (no original Java source
is present in this repo to copy verbatim from — the migration analysis was reconstructed
from documentation only). The values below are this port's own choice, picked to be
easy to hand-verify and to give `OFB-330` (refrigerated) / `CAW-042` (not refrigerated) a
useful contrast for the STRICT/TOTAL cold-storage-inclusion tests.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.footprint.archetype.component import ComponentId
from app.footprint.archetype.validity import ComponentVersion, Validity
from app.footprint.engine.component_tree_registry import (
    LAST_MILE,
    LAST_MILE_COLD_CHAIN,
    PACKAGING,
    PROCESSING,
    RAW_MATERIAL,
    SUPPLIER_TO_WAREHOUSE,
    TRANSPORT_REFRIGERATION,
    WAREHOUSE_REFRIGERATION,
    WAREHOUSE_TO_CUSTOMER,
)
from app.footprint.ports import ProductAttributes

_COVERAGE_START = datetime(2026, 1, 1, tzinfo=UTC)
_COVERAGE_SPLIT = datetime(2026, 6, 1, tzinfo=UTC)
_COVERAGE_END = datetime(2027, 1, 1, tzinfo=UTC)

# --- Seed emission factor versions, per component -------------------------------------
_SEED_VERSIONS: dict[ComponentId, list[ComponentVersion]] = {
    RAW_MATERIAL: [
        ComponentVersion(
            component_id=RAW_MATERIAL,
            factor_version_id="raw-material-v1",
            rate=Decimal("0.90"),
            validity=Validity(_COVERAGE_START, _COVERAGE_SPLIT),
        ),
        ComponentVersion(
            component_id=RAW_MATERIAL,
            factor_version_id="raw-material-v2",
            rate=Decimal("0.95"),
            validity=Validity(_COVERAGE_SPLIT, _COVERAGE_END),
        ),
    ],
    PROCESSING: [
        ComponentVersion(
            PROCESSING, "processing-v1", Decimal("0.50"), Validity(_COVERAGE_START, _COVERAGE_END)
        )
    ],
    SUPPLIER_TO_WAREHOUSE: [
        ComponentVersion(
            SUPPLIER_TO_WAREHOUSE,
            "supplier-to-warehouse-v1",
            Decimal("0.10"),
            Validity(_COVERAGE_START, _COVERAGE_END),
        )
    ],
    WAREHOUSE_TO_CUSTOMER: [
        ComponentVersion(
            WAREHOUSE_TO_CUSTOMER,
            "warehouse-to-customer-v1",
            Decimal("0.10"),
            Validity(_COVERAGE_START, _COVERAGE_END),
        )
    ],
    LAST_MILE: [
        ComponentVersion(
            LAST_MILE, "last-mile-v1", Decimal("0.20"), Validity(_COVERAGE_START, _COVERAGE_END)
        )
    ],
    PACKAGING: [
        ComponentVersion(
            PACKAGING, "packaging-v1", Decimal("0.30"), Validity(_COVERAGE_START, _COVERAGE_END)
        )
    ],
    WAREHOUSE_REFRIGERATION: [
        ComponentVersion(
            WAREHOUSE_REFRIGERATION,
            "warehouse-refrigeration-v1",
            Decimal("0.40"),
            Validity(_COVERAGE_START, _COVERAGE_END),
        )
    ],
    TRANSPORT_REFRIGERATION: [
        ComponentVersion(
            TRANSPORT_REFRIGERATION,
            "transport-refrigeration-v1",
            Decimal("0.15"),
            Validity(_COVERAGE_START, _COVERAGE_END),
        )
    ],
    LAST_MILE_COLD_CHAIN: [
        ComponentVersion(
            LAST_MILE_COLD_CHAIN,
            "last-mile-cold-chain-v1",
            Decimal("0.25"),
            Validity(_COVERAGE_START, _COVERAGE_END),
        )
    ],
}


def _assert_seed_non_overlapping(seed: dict[ComponentId, list[ComponentVersion]]) -> None:
    for versions in seed.values():
        Validity.assert_non_overlapping([v.validity for v in versions])


# Module-load self-check (mirrors the Java source's startup-time `assertNonOverlapping`
# call) — importing this module is itself the acceptance-criteria check that this does
# not raise.
_assert_seed_non_overlapping(_SEED_VERSIONS)


class InMemoryEmissionFactorPort:
    """Stub `EmissionFactorPort`, backed by the seed data above."""

    def version_at(self, component_id: ComponentId, t: datetime) -> ComponentVersion | None:
        for version in _SEED_VERSIONS.get(component_id, []):
            if version.validity.covers(t):
                return version
        return None

    def factor_version_by_id(self, factor_version_id: str) -> ComponentVersion | None:
        for versions in _SEED_VERSIONS.values():
            for version in versions:
                if version.factor_version_id == factor_version_id:
                    return version
        return None


# --- Seed product attributes -----------------------------------------------------------
def _electronics_sku(
    product_id: str, material_weight_kg: Decimal, supplier_distance_km: Decimal
) -> ProductAttributes:
    """Helper for the 14 electronics SKUs: fixes destination/last-mile/refrigeration,
    varies weight and supplier distance per SKU.
    """
    return ProductAttributes(
        product_id=product_id,
        material_weight_kg=material_weight_kg,
        supplier_distance_km=supplier_distance_km,
        destination_distance_km=Decimal("500"),
        last_mile_distance_km=Decimal("0"),
        requires_refrigeration=False,
    )


_PRODUCTS: dict[str, ProductAttributes] = {
    "OFB-330": ProductAttributes(
        product_id="OFB-330",
        material_weight_kg=Decimal("2.500"),
        supplier_distance_km=Decimal("120"),
        destination_distance_km=Decimal("300"),
        last_mile_distance_km=Decimal("15"),
        requires_refrigeration=True,
    ),
    "CAW-042": ProductAttributes(
        product_id="CAW-042",
        material_weight_kg=Decimal("1.200"),
        supplier_distance_km=Decimal("80"),
        destination_distance_km=Decimal("250"),
        last_mile_distance_km=Decimal("10"),
        requires_refrigeration=False,
    ),
}

for _i in range(1, 15):
    _pid = f"ELEC-{_i:03d}"
    _PRODUCTS[_pid] = _electronics_sku(
        _pid,
        material_weight_kg=Decimal("1.000") + Decimal("0.1") * _i,
        supplier_distance_km=Decimal("50") + Decimal("10") * _i,
    )


class InMemoryProductAttributesPort:
    """Stub `ProductAttributesPort`, backed by the seed data above."""

    def find_by_id(self, product_id: str) -> ProductAttributes | None:
        return _PRODUCTS.get(product_id)
