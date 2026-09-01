"""`GET /api/products/{productId}/footprint` and `GET
/api/footprints/calculations/{correlationId}/export` (spec.md's API Route
Spec, Footprint section).

Every query param and header below is accepted as a raw string and parsed
manually rather than declared with its target Python type directly. This
mirrors the Java source's `MethodArgumentTypeMismatchException` wrapping:
Spring's `@RequestParam`/`@RequestHeader` binding throws (wrapped to a 400)
on a malformed `BigDecimal`/enum/`Instant`/UUID, but is lenient (never
throws) for `boolean`/`int`-with-a-provided-default in the same way
`Boolean.parseBoolean`/manual defaulting are lenient — so the parse helpers
below reproduce that same per-type strict/lenient split, not a uniform one.
Declaring these as typed FastAPI/pydantic query params instead would route
a malformed value through `RequestValidationError` (the *legacy* envelope),
not this module's RFC7807 handler — which is exactly the routing spec.md
requires here.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.core.errors import EntityNotFoundException
from app.db import get_db
from app.footprint.audit.models import FootprintAuditEntity
from app.footprint.audit.task import persist_audit
from app.footprint.domain.breakdown import FootprintBreakdown
from app.footprint.domain.enums import Normalisation, Strictness
from app.footprint.domain.exceptions import InvalidParametersException
from app.footprint.engine.component_tree_registry import ComponentTreeRegistry
from app.footprint.export.csv_flattener import flatten_to_csv
from app.footprint.facade import DefaultFootprintFacade, FootprintRequest
from app.footprint.schemas import (
    FootprintResponseDto,
    OptionsResponse,
    ParametersEchoResponse,
    breakdown_node_from_domain,
)
from app.footprint.stubs import InMemoryEmissionFactorPort, InMemoryProductAttributesPort

router = APIRouter(tags=["footprint"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]

# Single shared facade instance: the registry/ports are stateless and the
# component tree is hardcoded (fixed decision #4 — stubs stay stubs), so
# there is no per-request state worth reconstructing here.
_facade = DefaultFootprintFacade(
    registry=ComponentTreeRegistry(),
    emission_factor_port=InMemoryEmissionFactorPort(),
    product_attributes_port=InMemoryProductAttributesPort(),
)


def _parse_uuid(name: str, raw: str | None) -> UUID | None:
    if raw is None or not raw.strip():
        return None
    try:
        return UUID(raw)
    except ValueError:
        raise InvalidParametersException(name, raw) from None


def _parse_decimal(name: str, raw: str | None) -> Decimal | None:
    if raw is None or not raw.strip():
        return None
    try:
        return Decimal(raw)
    except InvalidOperation:
        raise InvalidParametersException(name, raw) from None


def _parse_int(name: str, raw: str | None, default: int) -> int:
    if raw is None or not raw.strip():
        return default
    try:
        return int(raw)
    except ValueError:
        raise InvalidParametersException(name, raw) from None


def _parse_bool(raw: str | None, default: bool) -> bool:
    """Lenient, matching `Boolean.parseBoolean`: never raises. Any value
    other than a case-insensitive `"true"` is `False`."""
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() == "true"


def _parse_as_of(raw: str | None) -> datetime:
    if raw is None or not raw.strip():
        return datetime.now(UTC)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise InvalidParametersException("asOf", raw) from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed


def _parse_strictness(raw: str | None) -> Strictness:
    if raw is None or not raw.strip():
        return Strictness.STRICT
    try:
        return Strictness(raw)
    except ValueError:
        raise InvalidParametersException("strictness", raw) from None


def _parse_unit(raw: str | None) -> Normalisation:
    if raw is None or not raw.strip():
        return Normalisation.TOTAL
    try:
        return Normalisation(raw)
    except ValueError:
        raise InvalidParametersException("unit", raw) from None


@router.get("/api/products/{product_id}/footprint", response_model=FootprintResponseDto)
async def get_footprint(
    product_id: str,
    principal: ReadPrincipal,
    background_tasks: BackgroundTasks,
    x_correlation_id: Annotated[str | None, Header(alias="X-Correlation-Id")] = None,
    x_caller_id: Annotated[str | None, Header(alias="X-Caller-Id")] = None,
    x_comparison_group: Annotated[str | None, Header(alias="X-Comparison-Group")] = None,
    as_of: Annotated[str | None, Query(alias="asOf")] = None,
    material_weight_kg: Annotated[str | None, Query(alias="materialWeightKg")] = None,
    supplier_distance_km: Annotated[str | None, Query(alias="supplierDistanceKm")] = None,
    destination_distance_km: Annotated[str | None, Query(alias="destinationDistanceKm")] = None,
    last_mile_distance_km: Annotated[str | None, Query(alias="lastMileDistanceKm")] = None,
    storage_days: Annotated[str | None, Query(alias="storageDays")] = None,
    requires_refrigeration: Annotated[str | None, Query(alias="requiresRefrigeration")] = None,
    unit: Annotated[str | None, Query(alias="unit")] = None,
    strictness: Annotated[str | None, Query(alias="strictness")] = None,
    dry_run: Annotated[str | None, Query(alias="dryRun")] = None,
) -> FootprintResponseDto:
    correlation_id = _parse_uuid("X-Correlation-Id", x_correlation_id)
    comparison_group_id = _parse_uuid("X-Comparison-Group", x_comparison_group)
    caller_id = x_caller_id if x_caller_id and x_caller_id.strip() else None

    resolved_as_of = _parse_as_of(as_of)
    parsed_material_weight_kg = _parse_decimal("materialWeightKg", material_weight_kg)
    if parsed_material_weight_kg is not None and parsed_material_weight_kg <= 0:
        raise InvalidParametersException("materialWeightKg", material_weight_kg)
    parsed_supplier_distance_km = _parse_decimal("supplierDistanceKm", supplier_distance_km)
    parsed_destination_distance_km = _parse_decimal(
        "destinationDistanceKm", destination_distance_km
    )
    parsed_last_mile_distance_km = _parse_decimal("lastMileDistanceKm", last_mile_distance_km)
    parsed_storage_days = _parse_int("storageDays", storage_days, default=0)
    parsed_requires_refrigeration = _parse_bool(requires_refrigeration, default=False)
    parsed_unit = _parse_unit(unit)
    parsed_strictness = _parse_strictness(strictness)
    parsed_dry_run = _parse_bool(dry_run, default=False)

    request = FootprintRequest(
        product_id=product_id,
        as_of=resolved_as_of,
        material_weight_kg=parsed_material_weight_kg,
        supplier_distance_km=parsed_supplier_distance_km,
        destination_distance_km=parsed_destination_distance_km,
        last_mile_distance_km=parsed_last_mile_distance_km,
        storage_days=parsed_storage_days,
        requires_refrigeration=parsed_requires_refrigeration,
        strictness=parsed_strictness,
        normalisation=parsed_unit,
        correlation_id=correlation_id,
        comparison_group_id=comparison_group_id,
        caller_id=caller_id,
        dry_run=parsed_dry_run,
    )

    def _on_audit(breakdown: FootprintBreakdown, defaulted_request: FootprintRequest) -> None:
        # `calculate_total`/`calculate_unit` only invoke this callback when
        # `not defaulted_request.dry_run` — dry_run requests never reach
        # here, so `add_task` is never scheduled for them.
        background_tasks.add_task(persist_audit, breakdown, defaulted_request)

    if parsed_unit is Normalisation.PER_100G:
        breakdown = _facade.calculate_unit(request, on_audit=_on_audit)
    else:
        breakdown = _facade.calculate_total(request, on_audit=_on_audit)

    return FootprintResponseDto(
        correlation_id=breakdown.correlation_id,
        comparison_group_id=comparison_group_id,
        computed_at=breakdown.computed_at,
        total=breakdown.total,
        unit="KG_CO2_PER_100G" if parsed_unit is Normalisation.PER_100G else "KG_CO2",
        parameters_echo=ParametersEchoResponse(
            product_id=product_id,
            material_weight_kg=parsed_material_weight_kg,
            supplier_distance_km=parsed_supplier_distance_km,
            destination_distance_km=parsed_destination_distance_km,
            last_mile_distance_km=parsed_last_mile_distance_km,
            storage_days=parsed_storage_days,
            requires_refrigeration=parsed_requires_refrigeration,
            timestamp=resolved_as_of,
        ),
        options=OptionsResponse(
            strictness=parsed_strictness.value,
            normalisation=parsed_unit.value,
            dry_run=parsed_dry_run,
        ),
        breakdown=breakdown_node_from_domain(breakdown.root),
    )


@router.get("/api/footprints/calculations/{correlation_id}/export")
async def export_footprint_csv(
    correlation_id: UUID,
    db: DbSession,
    principal: ReadPrincipal,
    format: Annotated[str, Query()] = "csv",
) -> Response:
    """Not footprint-scoped for its not-found case, deliberately: a missing
    audit row raises the generic `EntityNotFoundException` (Group 3's), so
    it falls through to the legacy handler, not `errors.py`'s RFC7807 one —
    even though this route lives in the footprint package. Only the
    `format` check below (an `InvalidParametersException`, one of the 5
    typed exceptions) is RFC7807-scoped on this route.
    """
    if format != "csv":
        raise InvalidParametersException("format", format)

    result = await db.execute(
        select(FootprintAuditEntity).where(
            FootprintAuditEntity.correlation_id == correlation_id
        )
    )
    entity = result.scalar_one_or_none()
    if entity is None:
        raise EntityNotFoundException("FootprintAudit", correlation_id)

    csv_text = flatten_to_csv(entity)
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="footprint-{correlation_id}.csv"'
        },
    )
