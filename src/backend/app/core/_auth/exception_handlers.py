"""The 401 exception handler for `AuthenticationRequiredException` and its
`register_auth_exception_handlers(app)` wiring — replicates the legacy
flat-envelope 401 shape (`{"status", "error", "message"}`).
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.core._auth.principal import AuthenticationRequiredException
from app.core.errors import ErrorResponse


def _unauthorized_envelope() -> JSONResponse:
    body = ErrorResponse(status=401, error="Unauthorized", message="Authentication required")
    return JSONResponse(status_code=401, content=jsonable_encoder(body.model_dump(by_alias=True)))


async def authentication_required_handler(
    request: Request, exc: AuthenticationRequiredException
) -> JSONResponse:
    return _unauthorized_envelope()


def register_auth_exception_handlers(app: FastAPI) -> None:
    """Registers the 401 handler for `AuthenticationRequiredException`. The
    matching 403 case reuses `app.core.errors`'s already-registered
    `AccessDeniedException`/`access_denied_handler` — no separate 403
    handler needed here. Call this alongside
    `app.core.errors.register_exception_handlers` wherever the app is
    assembled.
    """
    app.add_exception_handler(AuthenticationRequiredException, authentication_required_handler)  # type: ignore[arg-type]
