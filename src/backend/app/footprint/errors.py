"""RFC7807 `ProblemDetail` envelope + footprint-scoped exception handlers.

Registered by exception TYPE — the 5 concrete `FootprintCalculationException`
subtypes, one `add_exception_handler` call each — never by router/package.
This is deliberate: it is what lets a plain `ValueError` (the preserved
PER_100G bug in `app/footprint/engine/breakdown_scaler.py`) and a generic
`EntityNotFoundException` (the export endpoint's not-found case) fall
through untouched to `app/core/errors.py`'s already-registered legacy
handlers, without this module special-casing either of them. Do NOT widen
this to catch `ValueError`/`EntityNotFoundException` here — that would
"fix" bugs the migration is required to preserve byte-for-byte.
"""

from __future__ import annotations

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from app.config import settings
from app.footprint.domain.exceptions import (
    ApplicabilityResolutionException,
    FactorVersionOverlapException,
    FootprintCalculationException,
    InvalidParametersException,
    MissingFactorException,
    MissingProductAttributeException,
)

_PROBLEM_MEDIA_TYPE = "application/problem+json"

# (status, title) per concrete exception type, per spec.md's RFC7807 table.
# `code` (used to build `type`) comes from each exception's own `.code`
# property, not duplicated here.
_STATUS_AND_TITLE: dict[type[FootprintCalculationException], tuple[int, str]] = {
    MissingFactorException: (status.HTTP_422_UNPROCESSABLE_ENTITY, "Missing emission factor"),
    MissingProductAttributeException: (
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "Missing product attribute",
    ),
    InvalidParametersException: (status.HTTP_400_BAD_REQUEST, "Invalid parameters"),
    ApplicabilityResolutionException: (
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "Applicability resolution failed",
    ),
    FactorVersionOverlapException: (status.HTTP_409_CONFLICT, "Factor version overlap"),
}


class ProblemDetail(BaseModel):
    """RFC7807 problem+json body. `code` plus whatever the raising
    exception's `details()` dict contains are carried as extension
    properties (accepted via `extra="allow"` since the extension set
    differs per exception type)."""

    model_config = ConfigDict(extra="allow")

    type: str
    title: str
    status: int
    detail: str
    instance: str
    code: str


def _kebab(code: str) -> str:
    """`MISSING_FACTOR` -> `missing-factor`."""
    return code.lower().replace("_", "-")


def _problem_type_uri(code: str) -> str:
    base_uri = settings.footprint_problem_base_uri
    if not base_uri.endswith("/"):
        base_uri += "/"
    return f"{base_uri}{_kebab(code)}"


async def footprint_problem_handler(
    request: Request, exc: FootprintCalculationException
) -> JSONResponse:
    status_code, title = _STATUS_AND_TITLE[type(exc)]
    problem = ProblemDetail(
        type=_problem_type_uri(exc.code),
        title=title,
        status=status_code,
        detail=str(exc),
        # Request path only (no scheme/host) — deliberate, avoids leaking
        # topology behind a reverse proxy.
        instance=request.url.path,
        code=exc.code,
        **exc.details,
    )
    return JSONResponse(
        status_code=status_code,
        content=jsonable_encoder(problem.model_dump()),
        media_type=_PROBLEM_MEDIA_TYPE,
    )


def register_footprint_exception_handlers(app: FastAPI) -> None:
    """Registers `footprint_problem_handler` against each of the 5 concrete
    `FootprintCalculationException` subtypes individually (not the abstract
    base, not the footprint router/package) — see module docstring for why
    that scoping matters.

    Same mypy variance caveat as `app.core.errors.register_exception_handlers`:
    Starlette's `add_exception_handler` stub wants
    `Callable[[Request, Exception], ...]` exactly, so a handler typed to a
    specific subclass always trips mypy here; `type: ignore[arg-type]` on
    each line is that, and nothing else.
    """
    for exc_type in (
        MissingFactorException,
        MissingProductAttributeException,
        InvalidParametersException,
        ApplicabilityResolutionException,
        FactorVersionOverlapException,
    ):
        app.add_exception_handler(exc_type, footprint_problem_handler)  # type: ignore[arg-type]
