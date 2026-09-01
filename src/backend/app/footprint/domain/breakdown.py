"""Breakdown tree result types.

Direct port of the Java `BreakdownNode` sealed interface (`LeafBreakdownNode`/
`CompositeBreakdownNode` permitted records) plus the top-level `FootprintBreakdown`
result object (fields: root, total, factor_versions, root_warnings, computed_at,
correlation_id — matches the serialized JSONB shape stored by the audit pipeline).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Literal
from uuid import UUID

from app.footprint.archetype.component import ComponentId


@dataclass(frozen=True, slots=True)
class Warning:
    """A `(code, message, component_id)` warning attached to a leaf or the root."""

    code: str
    message: str
    component_id: str


@dataclass(frozen=True, slots=True)
class LeafBreakdownNode:
    """A resolved (or, in LENIENT mode, unresolved) leaf calculation result."""

    id: ComponentId
    scope: int
    kg_co2: Decimal
    factor_version_id: str | None
    factor_value: Decimal | None
    factor_valid_from: datetime | None
    warnings: list[Warning] = field(default_factory=list)
    kind: Literal["leaf"] = field(default="leaf")


@dataclass(frozen=True, slots=True)
class CompositeBreakdownNode:
    """A composite node: `kg_co2` is always the sum of `children`'s `kg_co2`."""

    id: ComponentId
    kg_co2: Decimal
    children: list[BreakdownNode]
    kind: Literal["composite"] = field(default="composite")


# Discriminated union — exhaustiveness enforced via `match`/`case` + `typing.assert_never`.
BreakdownNode = LeafBreakdownNode | CompositeBreakdownNode


@dataclass(frozen=True, slots=True)
class FootprintBreakdown:
    """The full result of a single footprint calculation."""

    root: BreakdownNode
    total: Decimal
    factor_versions: list[str]
    root_warnings: list[Warning]
    computed_at: datetime
    correlation_id: UUID
