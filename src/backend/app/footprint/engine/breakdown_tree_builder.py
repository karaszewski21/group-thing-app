"""Recursively builds a `BreakdownNode` tree from a `Component` tree + calculation context.

Direct port of the Java `internal.BreakdownTreeBuilder`.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import assert_never

from app.footprint.archetype.calculator import Calculator, SimpleFixedCalculator
from app.footprint.archetype.component import Component, CompositeComponent, SimpleComponent
from app.footprint.archetype.parameter_value import ParameterValue
from app.footprint.domain.breakdown import (
    BreakdownNode,
    CompositeBreakdownNode,
    LeafBreakdownNode,
    Warning,
)
from app.footprint.domain.enums import Strictness
from app.footprint.domain.exceptions import MissingFactorException
from app.footprint.engine.component_tree_registry import ComponentTreeRegistry
from app.footprint.engine.rounding_policy import RoundingPolicy
from app.footprint.ports import EmissionFactorPort

_ZERO = Decimal("0")


class BreakdownTreeBuilder:
    """Builds the breakdown tree, applying applicability pruning and STRICT/LENIENT
    missing-factor handling. A single shared `Calculator` instance is used for all leaves.
    """

    def __init__(
        self,
        registry: ComponentTreeRegistry,
        emission_factor_port: EmissionFactorPort,
        calculator: Calculator | None = None,
    ) -> None:
        self._registry = registry
        self._factors = emission_factor_port
        self._calculator: Calculator = calculator or SimpleFixedCalculator()

    def build(
        self,
        component: Component,
        context: ParameterValue,
        as_of: datetime,
        strictness: Strictness,
    ) -> BreakdownNode | None:
        """Returns `None` when the component (or, for a composite, all its children) is
        not applicable/present for this context — the node is dropped from the tree.
        """
        if not component.applicability.is_active(context):
            return None
        match component:
            case SimpleComponent():
                return self._build_leaf(component, context, as_of, strictness)
            case CompositeComponent():
                return self._build_composite(component, context, as_of, strictness)
            case _:
                assert_never(component)

    def _build_leaf(
        self,
        component: SimpleComponent,
        context: ParameterValue,
        as_of: datetime,
        strictness: Strictness,
    ) -> LeafBreakdownNode:
        version = self._factors.version_at(component.id, as_of)
        if version is not None:
            quantity = component.extractor.extract(context)
            kg_co2 = RoundingPolicy.round(self._calculator.calculate(version.rate, quantity))
            return LeafBreakdownNode(
                id=component.id,
                scope=component.scope,
                kg_co2=kg_co2,
                factor_version_id=version.factor_version_id,
                factor_value=version.rate,
                factor_valid_from=version.validity.valid_from,
                warnings=[],
            )
        if strictness is Strictness.STRICT:
            raise MissingFactorException(component.id.value, as_of)
        warning = Warning(
            code="MISSING_FACTOR",
            message=f"No emission factor for {component.id.value} at {as_of}",
            component_id=component.id.value,
        )
        return LeafBreakdownNode(
            id=component.id,
            scope=component.scope,
            kg_co2=_ZERO,
            factor_version_id=None,
            factor_value=None,
            factor_valid_from=None,
            warnings=[warning],
        )

    def _build_composite(
        self,
        component: CompositeComponent,
        context: ParameterValue,
        as_of: datetime,
        strictness: Strictness,
    ) -> CompositeBreakdownNode | None:
        children: list[BreakdownNode] = []
        for child_id in component.child_ids:
            child_node = self.build(self._registry.get(child_id), context, as_of, strictness)
            if child_node is not None:
                children.append(child_node)
        if not children:
            return None
        total = RoundingPolicy.round(sum((child.kg_co2 for child in children), _ZERO))
        return CompositeBreakdownNode(id=component.id, kg_co2=total, children=children)
