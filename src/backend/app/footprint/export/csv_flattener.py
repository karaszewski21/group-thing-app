"""Flattens a stored `FootprintAuditEntity` row into the 12-column CSV
export format documented in spec.md's CSV export section. Direct port of
the Java `export` package's CSV writer. Replays a *previously stored* row
— never recalculates — so every value here comes from the audit-log
columns or the serialized `breakdown` JSONB, never from a fresh engine run.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any

from app.footprint.audit.models import FootprintAuditEntity
from app.footprint.domain.exceptions import InvalidParametersException

logger = logging.getLogger(__name__)

# Defensive cap — V1's fixed component tree yields at most 9 leaves in
# practice; this guards against a future tree (or malformed stored JSON)
# blowing up the export.
MAX_LEAF_ROWS = 1000

CSV_HEADER = [
    "correlation_id",
    "computed_at",
    "product_id",
    "timestamp_param",
    "component_path",
    "component_id",
    "kg_co2",
    "scope",
    "factor_value",
    "factor_valid_from",
    "factor_version_id",
    "warnings",
]


def _is_leaf(node: dict[str, Any]) -> bool:
    children = node.get("children")
    return not children


def _collect_leaves(
    node: dict[str, Any], path_prefix: list[str]
) -> list[tuple[str, dict[str, Any]]]:
    """Depth-first walk of a serialized breakdown node, returning
    `(component_path, leaf_node)` pairs. `component_path` is the dot-joined
    ids of every node from (but excluding) the root down to and including
    the leaf itself, e.g. `materials.raw-material`."""
    path = [*path_prefix, node.get("id", "")]
    if _is_leaf(node):
        return [(".".join(path), node)]
    rows: list[tuple[str, dict[str, Any]]] = []
    for child in node.get("children", []):
        rows.extend(_collect_leaves(child, path))
    return rows


def _flatten_leaves(root_node: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
    """Root is excluded from `component_path`, so leaf-collection starts
    from the root's own children, not the root itself."""
    rows: list[tuple[str, dict[str, Any]]] = []
    for child in root_node.get("children", []):
        rows.extend(_collect_leaves(child, []))
    return rows


def _resolve_timestamp_param(breakdown_json: dict[str, Any], requested_at: Any) -> str:
    """3-level fallback: `parameters_echo.timestamp` -> `computed_at` ->
    `row.requested_at`. The stored `breakdown` JSONB never has a
    `parameters_echo` key (see `audit/mapper.py`), so this always falls
    through past the first branch in practice — preserved exactly rather
    than "fixed" to point at a key that actually exists."""
    parameters_echo = breakdown_json.get("parameters_echo")
    if isinstance(parameters_echo, dict) and parameters_echo.get("timestamp") is not None:
        return str(parameters_echo["timestamp"])
    computed_at = breakdown_json.get("computed_at")
    if computed_at is not None:
        return str(computed_at)
    return str(requested_at)


def _format_kg_co2(value: Any) -> str:
    if value is None:
        return "0"
    try:
        quantized = Decimal(str(value)).quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        return "0"
    return str(quantized)


def _format_factor_value(value: Any) -> str:
    """Unlike `kg_co2`, no forced scale — plain `Decimal` string as-is."""
    if value is None:
        return ""
    try:
        return str(Decimal(str(value)))
    except (InvalidOperation, ValueError):
        return str(value)


def _format_plain(value: Any) -> str:
    return "" if value is None else str(value)


def _format_warnings(value: Any) -> str:
    if not value:
        return ""
    try:
        return json.dumps(value)
    except (TypeError, ValueError):
        logger.warning("Failed to JSON-serialize leaf warnings; falling back to empty string")
        return ""


def flatten_to_csv(entity: FootprintAuditEntity) -> str:
    """Builds the full CSV text (header + one row per leaf) for a stored
    audit row. Raises `InvalidParametersException("breakdown.leafCount",
    row_count)` if the flattened row count exceeds `MAX_LEAF_ROWS`."""
    root = entity.breakdown["root"]
    leaves = _flatten_leaves(root)
    if len(leaves) > MAX_LEAF_ROWS:
        raise InvalidParametersException("breakdown.leafCount", len(leaves))

    correlation_id = str(entity.correlation_id)
    computed_at = str(entity.requested_at)
    product_id = entity.product_id
    timestamp_param = _resolve_timestamp_param(entity.breakdown, entity.requested_at)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_HEADER)
    for component_path, leaf in leaves:
        writer.writerow(
            [
                correlation_id,
                computed_at,
                product_id,
                timestamp_param,
                component_path,
                leaf.get("id", ""),
                _format_kg_co2(leaf.get("kg_co2")),
                _format_plain(leaf.get("scope")),
                _format_factor_value(leaf.get("factor_value")),
                _format_plain(leaf.get("factor_valid_from")),
                _format_plain(leaf.get("factor_version_id")),
                _format_warnings(leaf.get("warnings")),
            ]
        )
    return buffer.getvalue()
