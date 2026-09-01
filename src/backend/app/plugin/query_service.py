"""`DbPluginObjectQueryService` port — the dynamic filter query builder
behind the plugin-object listing routes (spec.md's "Plugin-object filter
DSL", ported from the Java `DbPluginObjectQueryService.parseFilter`). This
is a single, non-repeatable `filter` param with a 3-part
`{jsonPath}:{operator}:{value}` split-limit grammar (no `pluginId` segment
— already bound from the route path), distinct from product's 4-part
`{pluginId}:{jsonPath}:{operator}:{value}` variant (Group 8) — kept
**separate** per spec.md's explicit non-unification instruction. Only the
regex/operator-allowlist constants in `app/core/filter_dsl.py` are shared.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Boolean, ColumnElement, Numeric, TextClause, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.filter_dsl import ALLOWED_OPERATORS, IDENTIFIER_PATTERN

from .models import PluginObject


def _spliced_literal(value: str) -> TextClause:
    """`value` MUST already be regex-validated (`IDENTIFIER_PATTERN`) by the
    caller before this is called — spliced directly into SQL text as a
    literal, never bound. Safe only because the allowlist regex
    (`^[a-zA-Z0-9_.-]+$`) forbids quotes, backslashes, and every other SQL
    metacharacter."""
    return text(f"'{value}'")


def _path_as_text(json_path: str) -> ColumnElement[Any]:
    """`data->>'{jsonPath}'` — single-level field expression (the `data`
    column is already scoped to one plugin's row via the route path),
    unlike product's two-level `plugin_data->'{pluginId}'->>'{jsonPath}'`
    expression."""
    return PluginObject.data.op("->>")(_spliced_literal(json_path))


def parse_filter(raw: str) -> ColumnElement[Any]:
    """Parses the single `filter` query value. Validation order and error-
    message wording are exact per spec.md — do not reorder or reword."""
    parts = raw.split(":", 2)
    if len(parts) < 2:
        raise ValueError("Invalid filter format. Expected: {jsonPath}:{operator}:{value}")

    json_path, operator = parts[0], parts[1]
    value = parts[2] if len(parts) > 2 else None

    if not IDENTIFIER_PATTERN.match(json_path):
        raise ValueError(
            "Invalid jsonPath: must contain only alphanumeric characters, "
            "underscores, dots, or hyphens"
        )
    if operator not in ALLOWED_OPERATORS:
        raise ValueError(f"Unsupported operator: {operator}. Supported: eq, gt, lt, exists, bool")

    if operator != "exists" and value is None:
        raise ValueError(f"Operator '{operator}' requires a value")

    if operator == "eq":
        return _path_as_text(json_path) == value

    if operator in ("gt", "lt"):
        assert value is not None  # guaranteed above (operator != "exists")
        try:
            numeric_value = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError(f"Value must be numeric for '{operator}' operator: {value}") from exc
        numeric_path = cast(_path_as_text(json_path), Numeric)
        return numeric_path > numeric_value if operator == "gt" else numeric_path < numeric_value

    if operator == "exists":
        # Both the column and jsonPath are bound function arguments here
        # (unlike the spliced path expression used by eq/gt/lt/bool), per
        # spec.md's literal `jsonb_exists(data, {jsonPath})`.
        return func.jsonb_exists(PluginObject.data, json_path)

    # operator == "bool"
    assert value is not None
    boolean_path = cast(_path_as_text(json_path), Boolean)
    return boolean_path == (value.lower() == "true")


async def list_plugin_objects(
    db: AsyncSession,
    *,
    plugin_id: str,
    object_type: str | None,
    entity_type: str | None,
    entity_id: int | None,
    filter_expr: str | None,
    limit: int,
) -> list[PluginObject]:
    """Shared listing query for both the cross-type (`object_type=None`)
    and per-type (`object_type` given) routes. Effective limit is
    `min(limit, 1000)` per spec.md — enforced here via SQL `LIMIT`."""
    stmt = select(PluginObject).where(PluginObject.plugin_id == plugin_id)

    if object_type is not None:
        stmt = stmt.where(PluginObject.object_type == object_type)
    if entity_type is not None:
        stmt = stmt.where(PluginObject.entity_type == entity_type)
    if entity_id is not None:
        stmt = stmt.where(PluginObject.entity_id == entity_id)
    if filter_expr:
        stmt = stmt.where(parse_filter(filter_expr))

    stmt = stmt.order_by(PluginObject.created_at.desc()).limit(min(limit, 1000))

    result = await db.execute(stmt)
    return list(result.scalars().all())
