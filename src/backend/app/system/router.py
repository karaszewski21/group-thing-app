"""`GET /api/health` and the unmatched-path catch-all.

The catch-all (`/{full_path:path}`) matches literally any path, so it must
be the LAST router `include_router`'d in `app/main.py`; every more-specific
route is matched first. Page paths are served by the Next.js frontend, so
any GET no earlier route consumed gets a real 404 in the legacy
`ErrorResponse` envelope rather than FastAPI's default `{"detail": ...}`
shape.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.core.errors import ErrorResponse

router = APIRouter(tags=["system"])


@router.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "UP"}


@router.get("/{full_path:path}")
async def not_found(full_path: str) -> JSONResponse:
    body = ErrorResponse(status=404, error="Not Found", message="Not Found")
    return JSONResponse(status_code=404, content=jsonable_encoder(body.model_dump(by_alias=True)))
