"""`FootprintResponseDto` and its nested response shapes (spec.md's API Route
Spec, Footprint section). Field names are snake_case throughout, matching
spec.md's response shape verbatim (unlike the legacy envelope, which uses
`fieldErrors` camelCase for one field) — no aliasing needed.

`parameters_echo.timestamp` is the *resolved* `asOf` the route handler used
for the calculation, never `breakdown.computed_at` (a different value: the
wall-clock time the engine actually ran) — see `router.py`.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal, assert_never
from uuid import UUID

from pydantic import BaseModel

from app.footprint.domain.breakdown import (
    BreakdownNode,
    CompositeBreakdownNode,
    LeafBreakdownNode,
    Warning,
)


class WarningResponse(BaseModel):
    code: str
    message: str
    component_id: str

    @staticmethod
    def from_domain(warning: Warning) -> WarningResponse:
        return WarningResponse(
            code=warning.code,
            message=warning.message,
            component_id=warning.component_id,
        )


class LeafNodeResponse(BaseModel):
    kind: Literal["leaf"] = "leaf"
    id: str
    scope: int
    kg_co2: Decimal
    factor_version_id: str | None
    factor_value: Decimal | None
    factor_valid_from: datetime | None
    warnings: list[WarningResponse]


class CompositeNodeResponse(BaseModel):
    kind: Literal["composite"] = "composite"
    id: str
    kg_co2: Decimal
    children: list[BreakdownNodeResponse]


# Discriminated union for the response body — mirrors the domain's
# `BreakdownNode` union (`kind` is the discriminator on both sides).
BreakdownNodeResponse = LeafNodeResponse | CompositeNodeResponse
CompositeNodeResponse.model_rebuild()


def breakdown_node_from_domain(node: BreakdownNode) -> BreakdownNodeResponse:
    """Recursively converts an engine `BreakdownNode` (whose `id` is a
    `ComponentId` value object) into its plain-string-id response shape."""
    match node:
        case LeafBreakdownNode():
            return LeafNodeResponse(
                id=node.id.value,
                scope=node.scope,
                kg_co2=node.kg_co2,
                factor_version_id=node.factor_version_id,
                factor_value=node.factor_value,
                factor_valid_from=node.factor_valid_from,
                warnings=[WarningResponse.from_domain(w) for w in node.warnings],
            )
        case CompositeBreakdownNode():
            return CompositeNodeResponse(
                id=node.id.value,
                kg_co2=node.kg_co2,
                children=[breakdown_node_from_domain(child) for child in node.children],
            )
        case _:
            assert_never(node)


class ParametersEchoResponse(BaseModel):
    """Echoes back the caller's raw request parameters (pre attribute-merge)
    plus the resolved `asOf` as `timestamp` — never the merged/defaulted
    calculation context, and never `breakdown.computed_at`."""

    product_id: str
    material_weight_kg: Decimal | None
    supplier_distance_km: Decimal | None
    destination_distance_km: Decimal | None
    last_mile_distance_km: Decimal | None
    storage_days: int
    requires_refrigeration: bool
    timestamp: datetime


class OptionsResponse(BaseModel):
    strictness: str
    normalisation: str
    dry_run: bool


class FootprintResponseDto(BaseModel):
    correlation_id: UUID
    comparison_group_id: UUID | None
    computed_at: datetime
    total: Decimal
    unit: Literal["KG_CO2", "KG_CO2_PER_100G"]
    parameters_echo: ParametersEchoResponse
    options: OptionsResponse
    breakdown: BreakdownNodeResponse
