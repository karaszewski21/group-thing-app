"""`DbProductQueryService` port — the dynamic filter/sort query builder
behind `GET /api/products` (spec.md's "Product listing filter DSL", ported
from the Java `DbProductQueryService.parseFilter`). This is a 4-part
`{pluginId}:{jsonPath}:{operator}:{value}` split-limit grammar, distinct
from `plugin_object`'s 3-part variant (Group 9) — do NOT unify them, per
spec.md's Reusability note. `app/core/filter_dsl.py` only shares the
regex/operator-allowlist constants, not a parser.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import Boolean, ColumnElement, Numeric, TextClause, cast, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.filter_dsl import ALLOWED_OPERATORS, IDENTIFIER_PATTERN

from .models import Product

# Sort whitelist: unknown/blank `field` silently falls back to the default
# (`created_at DESC`) — never a 400. `createdAt` (camelCase, matching the
# Java DTO's field name) maps to the `created_at` column.
_SORT_WHITELIST: dict[str, Any] = {
    "name": Product.name,
    "price": Product.price,
    "sku": Product.sku,
    "createdAt": Product.created_at,
}

_DEFAULT_ORDER: ColumnElement[Any] = Product.created_at.desc()


def _resolve_sort(sort: str | None) -> ColumnElement[Any]:
    """`sort` format is `"{field},{direction}"`. Direction is descending
    only when the second comma-separated part is exactly `"desc"`
    (case-insensitive); anything else (including absent) is ascending."""
    if not sort:
        return _DEFAULT_ORDER

    parts = sort.split(",")
    field = parts[0].strip()
    column = _SORT_WHITELIST.get(field)
    if column is None:
        return _DEFAULT_ORDER

    direction = parts[1].strip().lower() if len(parts) > 1 else ""
    ordering: ColumnElement[Any] = column.desc() if direction == "desc" else column.asc()
    return ordering


def _spliced_literal(value: str) -> TextClause:
    """`value` MUST already be regex-validated (`IDENTIFIER_PATTERN`) by the
    caller before this is called — it is spliced directly into the SQL text
    as a literal, never bound, matching spec.md's `eq`/`gt`/`lt`/`bool`
    path-expression translations. Safe only because the allowlist regex
    (`^[a-zA-Z0-9_.-]+$`) forbids quotes, backslashes, and every other SQL
    metacharacter."""
    return text(f"'{value}'")


def _path_as_text(plugin_id: str, json_path: str) -> ColumnElement[Any]:
    """`plugin_data->'{pluginId}'->>'{jsonPath}'` — pluginId/jsonPath
    spliced as validated literal path segments; only ever combined with a
    bound comparison value by the caller."""
    return Product.plugin_data.op("->")(_spliced_literal(plugin_id)).op("->>")(
        _spliced_literal(json_path)
    )


def _parse_plugin_filter(raw: str) -> ColumnElement[Any]:
    """Parses one repeatable `pluginFilter` query value. Validation order
    and error-message wording are exact per spec.md — do not reorder or
    reword."""
    parts = raw.split(":", 3)
    if len(parts) < 3:
        raise ValueError(
            "Invalid pluginFilter format. Expected: {pluginId}:{jsonPath}:{operator}:{value}"
        )

    plugin_id, json_path, operator = parts[0], parts[1], parts[2]
    value = parts[3] if len(parts) > 3 else None

    if not IDENTIFIER_PATTERN.match(plugin_id):
        raise ValueError(
            "Invalid pluginId: must contain only alphanumeric characters, "
            "underscores, dots, or hyphens"
        )
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
        return _path_as_text(plugin_id, json_path) == value

    if operator in ("gt", "lt"):
        assert value is not None  # guaranteed above (operator != "exists")
        try:
            numeric_value = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError(
                f"Value must be numeric for '{operator}' operator: {value}"
            ) from exc
        numeric_path = cast(_path_as_text(plugin_id, json_path), Numeric)
        return numeric_path > numeric_value if operator == "gt" else numeric_path < numeric_value

    if operator == "exists":
        # Both pluginId and jsonPath bound as parameters here (unlike the
        # spliced path expression used by eq/gt/lt/bool) — per spec.md's
        # literal `jsonb_exists(plugin_data->{pluginId}, {jsonPath})`, both
        # bound. `Product.plugin_data[plugin_id]` compiles to
        # `plugin_data -> :plugin_id` (bound); `json_path` is passed as a
        # plain function argument (also bound).
        return func.jsonb_exists(Product.plugin_data[plugin_id], json_path)

    # operator == "bool"
    assert value is not None
    boolean_path = cast(_path_as_text(plugin_id, json_path), Boolean)
    return boolean_path == (value.lower() == "true")


async def list_products(
    db: AsyncSession,
    *,
    category: int | None,
    search: str | None,
    sort: str | None,
    plugin_filters: list[str] | None,
) -> list[Product]:
    stmt = select(Product).options(joinedload(Product.category))

    if category is not None:
        stmt = stmt.where(Product.category_id == category)

    if search:
        stmt = stmt.where(Product.name.ilike(f"%{search}%"))

    for raw_filter in plugin_filters or []:
        stmt = stmt.where(_parse_plugin_filter(raw_filter))

    stmt = stmt.order_by(_resolve_sort(sort))

    result = await db.execute(stmt)
    return list(result.scalars().unique().all())
