"""Legacy flat error envelope: `ErrorResponse` model, typed exceptions, and
the exception handlers implementing spec.md's Error-Handling Spec priority
table. Everything routes through this handler set EXCEPT the 6
footprint-domain exception types (RFC7807 `ProblemDetail`, `app/footprint/
errors.py`, Group 12) — including `EntityNotFoundException`/`ValueError`
*raised from within* the footprint module (e.g. the export 404 and the
PER_100G bug), which deliberately still surface through this legacy handler
set per fixed decision #1.
"""

from __future__ import annotations

import logging
from datetime import datetime

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import IntegrityError

logger = logging.getLogger(__name__)


class ErrorResponse(BaseModel):
    """Field order is significant (mirrors the Java DTO's declaration
    order) and is preserved by `model_dump`/JSON serialization: `status,
    error, message, fieldErrors, timestamp`. `fieldErrors` serializes as
    JSON `null`, never omitted, except on validation failures."""

    model_config = ConfigDict(populate_by_name=True)

    status: int
    error: str
    message: str
    field_errors: dict[str, str] | None = Field(default=None, alias="fieldErrors")
    # Naive local datetime (no timezone) — matches Java's `LocalDateTime.now()`.
    timestamp: datetime = Field(default_factory=datetime.now)


class EntityNotFoundException(Exception):
    """Raised when a lookup by id fails. Legacy 404; fixed message format:
    `"{entity_type} with id {entity_id} not found"`."""

    def __init__(self, entity_type: str, entity_id: object) -> None:
        self.entity_type = entity_type
        self.entity_id = entity_id
        super().__init__(f"{entity_type} with id {entity_id} not found")


class BusinessConflictException(Exception):
    """Base for domain-specific 409 conflicts. Subclasses build their own
    message (e.g. "Category has products and cannot be deleted")."""


class AccessDeniedException(Exception):
    """Authenticated but insufficient permission. Legacy 403, fixed message
    "Access denied" (Group 4's authorization dependency raises this)."""


def _envelope(
    status_code: int,
    error: str,
    message: str,
    field_errors: dict[str, str] | None = None,
) -> JSONResponse:
    body = ErrorResponse(
        status=status_code, error=error, message=message, field_errors=field_errors
    )
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(body.model_dump(by_alias=True)),
    )


async def entity_not_found_handler(request: Request, exc: EntityNotFoundException) -> JSONResponse:
    return _envelope(status.HTTP_404_NOT_FOUND, "Not Found", str(exc))


async def business_conflict_handler(
    request: Request, exc: BusinessConflictException
) -> JSONResponse:
    return _envelope(status.HTTP_409_CONFLICT, "Conflict", str(exc))


async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    return _envelope(status.HTTP_409_CONFLICT, "Conflict", "Data integrity violation")


async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    field_errors: dict[str, str] = {}
    for error in exc.errors():
        loc_parts = (part for part in error["loc"] if part not in ("body", "query", "path"))
        field = ".".join(str(part) for part in loc_parts)
        if field not in field_errors:  # first message wins per field
            field_errors[field] = error["msg"]
    return _envelope(status.HTTP_400_BAD_REQUEST, "Bad Request", "Validation failed", field_errors)


async def access_denied_handler(request: Request, exc: AccessDeniedException) -> JSONResponse:
    return _envelope(status.HTTP_403_FORBIDDEN, "Forbidden", "Access denied")


async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    return _envelope(status.HTTP_400_BAD_REQUEST, "Bad Request", str(exc))


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception", exc_info=exc)
    return _envelope(
        status.HTTP_500_INTERNAL_SERVER_ERROR,
        "Internal Server Error",
        "An unexpected error occurred",
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Registers handlers per spec.md's Error-Handling Spec priority
    order (most-specific exception types first).

    Starlette's `add_exception_handler` stub is invariant in the exception
    parameter type (it wants `Callable[[Request, Exception], ...]` exactly),
    so registering a handler typed to a specific subclass — the whole point
    of dispatching by exception type — always trips mypy here; the
    `type: ignore[arg-type]` on each line is that, and nothing else.
    """
    app.add_exception_handler(EntityNotFoundException, entity_not_found_handler)  # type: ignore[arg-type]
    app.add_exception_handler(BusinessConflictException, business_conflict_handler)  # type: ignore[arg-type]
    app.add_exception_handler(IntegrityError, integrity_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(AccessDeniedException, access_denied_handler)  # type: ignore[arg-type]
    app.add_exception_handler(ValueError, value_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(Exception, unhandled_exception_handler)
