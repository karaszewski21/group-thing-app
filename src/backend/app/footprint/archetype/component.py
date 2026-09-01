"""Component tree node types: the discriminated union at the heart of the pricing archetype.

Direct port of the Java `archetype.pricing.ComponentId`/`Component` sealed interface
(`SimpleComponent`/`CompositeComponent` permitted records).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.footprint.archetype.applicability import Applicability
from app.footprint.archetype.calculator import CalculatorId
from app.footprint.archetype.quantity_extractor import QuantityExtractor


@dataclass(frozen=True, slots=True)
class ComponentId:
    """Non-blank identifier for a component (leaf or composite) in the tree."""

    value: str

    def __post_init__(self) -> None:
        if not self.value or not self.value.strip():
            raise ValueError("ComponentId value must not be blank")


@dataclass(frozen=True, slots=True)
class SimpleComponent:
    """A leaf component: resolves a single emission factor and computes one kg_co2 value."""

    id: ComponentId
    calculator_id: CalculatorId
    extractor: QuantityExtractor
    applicability: Applicability
    scope: int
    kind: Literal["simple"] = field(default="simple")


@dataclass(frozen=True, slots=True)
class CompositeComponent:
    """A composite component: aggregates the kg_co2 of its (by-id) children."""

    id: ComponentId
    child_ids: list[ComponentId]
    applicability: Applicability
    kind: Literal["composite"] = field(default="composite")


# Discriminated union — exhaustiveness enforced via `match`/`case` + `typing.assert_never`
# at every call site that branches on it (mypy strict substitutes for Java's sealed interfaces).
Component = SimpleComponent | CompositeComponent
