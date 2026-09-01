"""Top-level orchestration: defaults -> attribute merge -> tree build -> (scale) -> audit hook.

Direct port of the Java `api.DefaultFootprintFacade`. This module does not touch the
database or HTTP layer — `on_audit` is a no-op-unless-provided callback; Group 11 wires
it to real `BackgroundTasks`-scheduled persistence, Group 12 wires the router.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import assert_never
from uuid import UUID, uuid4

from app.footprint.archetype.parameter_value import ParameterValue
from app.footprint.domain.breakdown import (
    BreakdownNode,
    CompositeBreakdownNode,
    FootprintBreakdown,
    LeafBreakdownNode,
    Warning,
)
from app.footprint.domain.enums import Normalisation, Strictness
from app.footprint.domain.exceptions import (
    ApplicabilityResolutionException,
    MissingProductAttributeException,
)
from app.footprint.engine.breakdown_scaler import BreakdownScaler
from app.footprint.engine.breakdown_tree_builder import BreakdownTreeBuilder
from app.footprint.engine.component_tree_registry import ComponentTreeRegistry
from app.footprint.ports import EmissionFactorPort, ProductAttributesPort

_FUTURE_WARNING_THRESHOLD = timedelta(days=30)
_ANCIENT_WARNING_THRESHOLD = timedelta(days=3650)

# AuditCallback receives the computed breakdown and the (defaulted) request that produced
# it; scheduling it (or not, for dry_run) is this module's caller's responsibility.
AuditCallback = Callable[[FootprintBreakdown, "FootprintRequest"], None]


@dataclass(frozen=True, slots=True)
class FootprintRequest:
    """Raw per-request parameters, pre-defaults/pre-attribute-merge. `None` means
    "not specified by the caller" for the fields that fall back to defaults or to a
    stored product attribute.
    """

    product_id: str
    as_of: datetime
    material_weight_kg: Decimal | None = None
    supplier_distance_km: Decimal | None = None
    destination_distance_km: Decimal | None = None
    last_mile_distance_km: Decimal | None = None
    storage_days: int = 0
    requires_refrigeration: bool = False
    strictness: Strictness | None = None
    normalisation: Normalisation | None = None
    correlation_id: UUID | None = None
    comparison_group_id: UUID | None = None
    caller_id: str | None = None
    dry_run: bool = False


def timestamp_warnings(as_of: datetime) -> list[Warning]:
    """Root-level warnings for a suspicious `as_of` value. Independent checks, both
    attached to the tree root.
    """
    warnings: list[Warning] = []
    now = datetime.now(UTC)
    root_id = ComponentTreeRegistry.ROOT_ID.value
    if as_of > now + _FUTURE_WARNING_THRESHOLD:
        warnings.append(
            Warning("FUTURE_TIMESTAMP", "asOf is more than 30 days in the future", root_id)
        )
    if as_of < now - _ANCIENT_WARNING_THRESHOLD:
        warnings.append(
            Warning("ANCIENT_TIMESTAMP", "asOf is more than 10 years in the past", root_id)
        )
    return warnings


def _collect_factor_versions(node: BreakdownNode) -> list[str]:
    """Depth-first collection of every non-null `factor_version_id` in the tree."""
    match node:
        case LeafBreakdownNode():
            return [node.factor_version_id] if node.factor_version_id is not None else []
        case CompositeBreakdownNode():
            versions: list[str] = []
            for child in node.children:
                versions.extend(_collect_factor_versions(child))
            return versions
        case _:
            assert_never(node)


class DefaultFootprintFacade:
    """Direct port of `DefaultFootprintFacade`."""

    def __init__(
        self,
        registry: ComponentTreeRegistry,
        emission_factor_port: EmissionFactorPort,
        product_attributes_port: ProductAttributesPort,
        tree_builder: BreakdownTreeBuilder | None = None,
    ) -> None:
        self._registry = registry
        self._attributes_port = product_attributes_port
        self._tree_builder = tree_builder or BreakdownTreeBuilder(registry, emission_factor_port)

    @staticmethod
    def with_defaults(request: FootprintRequest) -> FootprintRequest:
        """`strictness` -> STRICT, `normalisation` -> TOTAL, `correlation_id` -> uuid4(),
        `caller_id` -> "anonymous" when absent; `dry_run` passed through unchanged.
        """
        return replace(
            request,
            strictness=request.strictness or Strictness.STRICT,
            normalisation=request.normalisation or Normalisation.TOTAL,
            correlation_id=request.correlation_id or uuid4(),
            caller_id=request.caller_id or "anonymous",
        )

    def merge_with_product_attributes(self, request: FootprintRequest) -> ParameterValue:
        """Each of the 4 numeric params falls back to the stored attribute only if the
        incoming request param is `None` (per-field override). `requires_refrigeration`
        is OR'd — cannot be forced off by the request if the stored attribute says True.
        """
        attributes = self._attributes_port.find_by_id(request.product_id)
        if attributes is None:
            raise MissingProductAttributeException(request.product_id, "product")
        return ParameterValue.create(
            product_id=request.product_id,
            material_weight_kg=(
                request.material_weight_kg
                if request.material_weight_kg is not None
                else attributes.material_weight_kg
            ),
            supplier_distance_km=(
                request.supplier_distance_km
                if request.supplier_distance_km is not None
                else attributes.supplier_distance_km
            ),
            destination_distance_km=(
                request.destination_distance_km
                if request.destination_distance_km is not None
                else attributes.destination_distance_km
            ),
            last_mile_distance_km=(
                request.last_mile_distance_km
                if request.last_mile_distance_km is not None
                else attributes.last_mile_distance_km
            ),
            storage_days=request.storage_days,
            requires_refrigeration=(
                request.requires_refrigeration or attributes.requires_refrigeration
            ),
        )

    def calculate_total(
        self,
        request: FootprintRequest,
        on_audit: AuditCallback | None = None,
    ) -> FootprintBreakdown:
        """Applies defaults, merges attributes, builds the breakdown tree, computes
        root-level timestamp warnings, and — unless `dry_run` — invokes `on_audit`
        (a no-op stub here; Group 11/12 wire it to real `BackgroundTasks` scheduling).
        """
        defaulted = self.with_defaults(request)
        assert defaulted.strictness is not None  # set by with_defaults
        context = self.merge_with_product_attributes(defaulted)
        root_node = self._tree_builder.build(
            self._registry.root, context, defaulted.as_of, defaulted.strictness
        )
        if root_node is None:
            # The V1 root is ALWAYS-applicable and always has at least one applicable
            # child (materials/transport/packaging are all ALWAYS); this should be
            # unreachable, but a typed exception is preferable to an AttributeError below.
            raise ApplicabilityResolutionException(
                ComponentTreeRegistry.ROOT_ID.value,
                "root component resolved to no applicable node",
            )
        breakdown = FootprintBreakdown(
            root=root_node,
            total=root_node.kg_co2,
            factor_versions=_collect_factor_versions(root_node),
            root_warnings=timestamp_warnings(defaulted.as_of),
            computed_at=datetime.now(UTC),
            correlation_id=defaulted.correlation_id,  # type: ignore[arg-type]
        )
        if not defaulted.dry_run and on_audit is not None:
            on_audit(breakdown, defaulted)
        return breakdown

    def calculate_unit(
        self,
        request: FootprintRequest,
        on_audit: AuditCallback | None = None,
    ) -> FootprintBreakdown:
        """PER_100G path: always computes (and would-audit) the TOTAL calculation first
        — even though the caller asked for PER_100G — then re-merges attributes and
        scales the already-computed total breakdown. This double-computation (defaults +
        attribute-merge run twice) is intentional and preserved verbatim, not a bug to
        fix by caching the first merge's result.
        """
        total_breakdown = self.calculate_total(request, on_audit)
        defaulted = self.with_defaults(request)
        context = self.merge_with_product_attributes(defaulted)
        scaled_root = BreakdownScaler.scale(
            total_breakdown.root, Normalisation.PER_100G, context.material_weight_kg
        )
        return replace(total_breakdown, root=scaled_root, total=scaled_root.kg_co2)
