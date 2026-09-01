"""Converts a computed `FootprintBreakdown` + the `FootprintRequest` that
produced it into a `FootprintAuditEntity` ready to persist.

Serializes the **entire** breakdown result object (not just `root`) into
the `breakdown` JSONB column with top-level keys `root, total,
factor_versions, root_warnings, computed_at, correlation_id` — no
`parameters_echo` key at this level. That absence is load-bearing for the
CSV export's `timestamp_param` fallback chain (`csv_flattener.py`), which
therefore always falls through past the first branch.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, assert_never

from app.footprint.audit.models import FootprintAuditEntity
from app.footprint.domain.breakdown import (
    BreakdownNode,
    CompositeBreakdownNode,
    FootprintBreakdown,
    LeafBreakdownNode,
    Warning,
)
from app.footprint.facade import FootprintRequest


def _to_naive_utc(value: datetime) -> datetime:
    """Mirrors `LocalDateTime.ofInstant(..., ZoneOffset.UTC)`: converts a
    (possibly tz-aware) instant to UTC wall-clock time, then drops tzinfo
    so it stores as a naive `TIMESTAMP` column."""
    if value.tzinfo is not None:
        value = value.astimezone(UTC)
    return value.replace(tzinfo=None)


def _serialize_warning(warning: Warning) -> dict[str, str]:
    return {"code": warning.code, "message": warning.message, "component_id": warning.component_id}


def _serialize_node(node: BreakdownNode) -> dict[str, Any]:
    match node:
        case LeafBreakdownNode():
            return {
                "kind": "leaf",
                "id": node.id.value,
                "scope": node.scope,
                "kg_co2": str(node.kg_co2),
                "factor_version_id": node.factor_version_id,
                "factor_value": (str(node.factor_value) if node.factor_value is not None else None),
                "factor_valid_from": (
                    node.factor_valid_from.isoformat()
                    if node.factor_valid_from is not None
                    else None
                ),
                "warnings": [_serialize_warning(w) for w in node.warnings],
            }
        case CompositeBreakdownNode():
            return {
                "kind": "composite",
                "id": node.id.value,
                "kg_co2": str(node.kg_co2),
                "children": [_serialize_node(child) for child in node.children],
            }
        case _:
            assert_never(node)


def serialize_breakdown(breakdown: FootprintBreakdown) -> dict[str, Any]:
    """Full serialization of a `FootprintBreakdown` for the `breakdown`
    JSONB column. Deliberately has no `parameters_echo` key — see module
    docstring."""
    return {
        "root": _serialize_node(breakdown.root),
        "total": str(breakdown.total),
        "factor_versions": list(breakdown.factor_versions),
        "root_warnings": [_serialize_warning(w) for w in breakdown.root_warnings],
        "computed_at": breakdown.computed_at.isoformat(),
        "correlation_id": str(breakdown.correlation_id),
    }


def to_entity(breakdown: FootprintBreakdown, request: FootprintRequest) -> FootprintAuditEntity:
    """Builds a fresh, transient `FootprintAuditEntity` from a computed
    breakdown and the (already-defaulted) request that produced it.
    `request.strictness`/`request.normalisation` must be set (i.e. this
    must be the `with_defaults`-applied request the facade passes to its
    `on_audit` callback, not the raw caller input)."""
    assert request.strictness is not None
    assert request.normalisation is not None
    return FootprintAuditEntity(
        correlation_id=breakdown.correlation_id,
        comparison_group_id=request.comparison_group_id,
        product_id=request.product_id,
        caller_id=request.caller_id,
        requested_at=_to_naive_utc(breakdown.computed_at),
        total_kg_co2=breakdown.total,
        strictness=request.strictness.value,
        normalisation=request.normalisation.value,
        breakdown=serialize_breakdown(breakdown),
        warnings=[_serialize_warning(w) for w in breakdown.root_warnings],
        factor_versions=list(breakdown.factor_versions),
        dry_run=request.dry_run,
    )
