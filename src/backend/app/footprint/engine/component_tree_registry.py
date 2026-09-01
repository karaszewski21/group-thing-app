"""The hardcoded V1 component tree.

Direct port of the Java `internal.ComponentTreeRegistry`: 9 leaves + 4 composites, exact
quantity formulas verbatim per spec.md's Domain Logic Spec.
"""

from __future__ import annotations

from decimal import Decimal

from app.footprint.archetype.applicability import Applicability
from app.footprint.archetype.calculator import CalculatorId
from app.footprint.archetype.component import (
    Component,
    ComponentId,
    CompositeComponent,
    SimpleComponent,
)
from app.footprint.archetype.parameter_value import ParameterValue
from app.footprint.archetype.quantity_extractor import FunctionQuantityExtractor

ROOT_ID = ComponentId("product-footprint")

_CALCULATOR_ID = CalculatorId("simple-fixed")

# --- Leaf ids -----------------------------------------------------------------
RAW_MATERIAL = ComponentId("raw-material")
PROCESSING = ComponentId("processing")
SUPPLIER_TO_WAREHOUSE = ComponentId("supplier-to-warehouse")
WAREHOUSE_TO_CUSTOMER = ComponentId("warehouse-to-customer")
LAST_MILE = ComponentId("last-mile")
PACKAGING = ComponentId("packaging")
WAREHOUSE_REFRIGERATION = ComponentId("warehouse-refrigeration")
TRANSPORT_REFRIGERATION = ComponentId("transport-refrigeration")
LAST_MILE_COLD_CHAIN = ComponentId("last-mile-cold-chain")

# --- Composite ids --------------------------------------------------------------
MATERIALS = ComponentId("materials")
TRANSPORT = ComponentId("transport")
COLD_STORAGE = ComponentId("cold-storage")


# --- Quantity formulas, verbatim per spec.md -------------------------------------
def _qty_material_weight(ctx: ParameterValue) -> Decimal:
    return ctx.material_weight_kg


def _qty_supplier_to_warehouse(ctx: ParameterValue) -> Decimal:
    return ctx.material_weight_kg * ctx.supplier_distance_km


def _qty_warehouse_to_customer(ctx: ParameterValue) -> Decimal:
    return ctx.material_weight_kg * ctx.destination_distance_km


def _qty_last_mile(ctx: ParameterValue) -> Decimal:
    return ctx.material_weight_kg * ctx.last_mile_distance_km


def _qty_warehouse_refrigeration(ctx: ParameterValue) -> Decimal:
    return ctx.material_weight_kg * ctx.storage_days


def _qty_transport_refrigeration(ctx: ParameterValue) -> Decimal:
    return ctx.material_weight_kg * (ctx.supplier_distance_km + ctx.destination_distance_km)


def _qty_last_mile_cold_chain(ctx: ParameterValue) -> Decimal:
    return ctx.material_weight_kg * ctx.last_mile_distance_km


_LEAVES: dict[ComponentId, SimpleComponent] = {
    RAW_MATERIAL: SimpleComponent(
        id=RAW_MATERIAL,
        calculator_id=_CALCULATOR_ID,
        extractor=FunctionQuantityExtractor(_qty_material_weight),
        applicability=Applicability.ALWAYS,
        scope=3,
    ),
    PROCESSING: SimpleComponent(
        id=PROCESSING,
        calculator_id=_CALCULATOR_ID,
        extractor=FunctionQuantityExtractor(_qty_material_weight),
        applicability=Applicability.ALWAYS,
        scope=2,
    ),
    SUPPLIER_TO_WAREHOUSE: SimpleComponent(
        id=SUPPLIER_TO_WAREHOUSE,
        calculator_id=_CALCULATOR_ID,
        extractor=FunctionQuantityExtractor(_qty_supplier_to_warehouse),
        applicability=Applicability.ALWAYS,
        scope=3,
    ),
    WAREHOUSE_TO_CUSTOMER: SimpleComponent(
        id=WAREHOUSE_TO_CUSTOMER,
        calculator_id=_CALCULATOR_ID,
        extractor=FunctionQuantityExtractor(_qty_warehouse_to_customer),
        applicability=Applicability.ALWAYS,
        scope=3,
    ),
    LAST_MILE: SimpleComponent(
        id=LAST_MILE,
        calculator_id=_CALCULATOR_ID,
        extractor=FunctionQuantityExtractor(_qty_last_mile),
        applicability=Applicability.ALWAYS,
        scope=3,
    ),
    PACKAGING: SimpleComponent(
        id=PACKAGING,
        calculator_id=_CALCULATOR_ID,
        extractor=FunctionQuantityExtractor(_qty_material_weight),
        applicability=Applicability.ALWAYS,
        scope=3,
    ),
    WAREHOUSE_REFRIGERATION: SimpleComponent(
        id=WAREHOUSE_REFRIGERATION,
        calculator_id=_CALCULATOR_ID,
        extractor=FunctionQuantityExtractor(_qty_warehouse_refrigeration),
        applicability=Applicability.REFRIGERATED_ONLY,
        scope=2,
    ),
    TRANSPORT_REFRIGERATION: SimpleComponent(
        id=TRANSPORT_REFRIGERATION,
        calculator_id=_CALCULATOR_ID,
        extractor=FunctionQuantityExtractor(_qty_transport_refrigeration),
        applicability=Applicability.REFRIGERATED_ONLY,
        scope=3,
    ),
    LAST_MILE_COLD_CHAIN: SimpleComponent(
        id=LAST_MILE_COLD_CHAIN,
        calculator_id=_CALCULATOR_ID,
        extractor=FunctionQuantityExtractor(_qty_last_mile_cold_chain),
        applicability=Applicability.REFRIGERATED_ONLY,
        scope=3,
    ),
}

_COMPOSITES: dict[ComponentId, CompositeComponent] = {
    MATERIALS: CompositeComponent(
        id=MATERIALS,
        child_ids=[RAW_MATERIAL, PROCESSING],
        applicability=Applicability.ALWAYS,
    ),
    TRANSPORT: CompositeComponent(
        id=TRANSPORT,
        child_ids=[SUPPLIER_TO_WAREHOUSE, WAREHOUSE_TO_CUSTOMER, LAST_MILE],
        applicability=Applicability.ALWAYS,
    ),
    COLD_STORAGE: CompositeComponent(
        id=COLD_STORAGE,
        child_ids=[WAREHOUSE_REFRIGERATION, TRANSPORT_REFRIGERATION, LAST_MILE_COLD_CHAIN],
        applicability=Applicability.REFRIGERATED_ONLY,
    ),
    ROOT_ID: CompositeComponent(
        id=ROOT_ID,
        child_ids=[MATERIALS, TRANSPORT, PACKAGING, COLD_STORAGE],
        applicability=Applicability.ALWAYS,
    ),
}

_ALL_COMPONENTS: dict[ComponentId, Component] = {**_LEAVES, **_COMPOSITES}


class ComponentTreeRegistry:
    """Lookup for the hardcoded V1 component tree."""

    ROOT_ID = ROOT_ID

    def get(self, component_id: ComponentId) -> Component:
        return _ALL_COMPONENTS[component_id]

    @property
    def root(self) -> Component:
        return _ALL_COMPONENTS[ROOT_ID]
