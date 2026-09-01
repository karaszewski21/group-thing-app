"""`GET /api/health` and the SPA-fallback catch-all (spec.md's System
section).

The catch-all (`/{full_path:path}`) matches literally any path, so it must
be the LAST router `include_router`'d in `app/main.py` — every other,
more-specific route (every `/api/**` route from Groups 4-9/12, plus this
module's own `/api/health`) is matched first by FastAPI's router; only a
request no earlier route consumed ever reaches this handler.

`/api/**` and `/assets/**` paths that reach this handler are, by
construction, unmatched by any real route — they must surface as a real 404
(legacy `ErrorResponse` envelope, not FastAPI's default `{"detail": ...}`
shape, and never `index.html`). Everything else is an SPA client-route:
serve `index.html` unless the last path segment contains a dot (a
file-extension path — e.g. a missing favicon — which is also a real 404,
not the SPA fallback).
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse

from app.core.errors import ErrorResponse

router = APIRouter(tags=["system"])

# `src/backend/static/` — sibling of `app/`, matching where a frontend
# build's output would land in a real deployment (out of scope here; see
# module docstring and implementation/spec.md's System section).
STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
INDEX_HTML = STATIC_DIR / "index.html"


@router.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "UP"}


def _real_not_found() -> JSONResponse:
    body = ErrorResponse(status=404, error="Not Found", message="Not Found")
    return JSONResponse(status_code=404, content=jsonable_encoder(body.model_dump(by_alias=True)))


@router.get("/{full_path:path}", response_model=None)
async def spa_fallback(full_path: str) -> FileResponse | JSONResponse:
    normalized_path = "/" + full_path

    if normalized_path.startswith("/api/") or normalized_path.startswith("/assets/"):
        return _real_not_found()

    last_segment = normalized_path.rsplit("/", 1)[-1]
    if "." in last_segment:
        # Dot-containing (file-extension) path outside /api//assets — e.g.
        # a stray *.js/*.css request — is also a real 404, not the SPA
        # fallback.
        return _real_not_found()

    return FileResponse(INDEX_HTML)
