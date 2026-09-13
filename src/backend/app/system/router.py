"""`GET /api/health`, the public-preview routes, and the SPA-fallback
catch-all (spec.md's System section).

The catch-all (`/{full_path:path}`) matches literally any path, so it must
be the LAST router `include_router`'d in `app/main.py` — every other,
more-specific route (every `/api/**` route from Groups 4-9/12, plus this
module's own `/api/health` and the public-preview routes below) is matched
first by FastAPI's router; only a request no earlier route consumed ever
reaches the catch-all.

The three public-preview routes sit between those two: they match the same
URL shapes the SPA already owns client-side
(`/:organizationSlug`, `/:organizationSlug/grupa/:groupId`,
`/:organizationSlug/grupa/:groupId/term/:termId` — see `router.tsx`), and
exist only to inject real Open Graph/Twitter meta tags into `index.html`
for link-unfurling bots (see `public_preview.py`'s module docstring). Any
input that isn't a real, resolvable slug/circle/term falls straight back to
the exact same `index.html` a real browser would get from the plain
fallback below (never a 404 — the SPA still needs to load and render its
own not-found UI client-side, exactly as before this feature existed).

`/api/**` and `/assets/**` paths that reach the final catch-all are, by
construction, unmatched by any real route — they must surface as a real 404
(legacy `ErrorResponse` envelope, not FastAPI's default `{"detail": ...}`
shape, and never `index.html`). Everything else is an SPA client-route:
serve `index.html` unless the last path segment contains a dot (a
file-extension path — e.g. a missing favicon — which is also a real 404,
not the SPA fallback).
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFoundException, ErrorResponse
from app.db import get_db
from app.groups import service as groups_service
from app.organizations import service as organizations_service
from app.organizations.schemas import PublicOrganizationResponse
from app.organizations.slugs import RESERVED_SLUGS

from .public_preview import render_public_circle_meta, render_public_organization_meta

router = APIRouter(tags=["system"])

# `src/backend/static/` — sibling of `app/`. In `docker-compose.yml` this is
# a volume populated from the real `src/frontend` Vite build (see the
# `frontend-build` service) so both this fallback and the public-preview
# routes below serve the actual current build, not a placeholder.
STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static"
INDEX_HTML = STATIC_DIR / "index.html"

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "UP"}


def _real_not_found() -> JSONResponse:
    body = ErrorResponse(status=404, error="Not Found", message="Not Found")
    return JSONResponse(status_code=404, content=jsonable_encoder(body.model_dump(by_alias=True)))


def _plain_index() -> FileResponse:
    return FileResponse(INDEX_HTML)


@router.get("/{organization_slug}/grupa/{group_id}/term/{term_id}", response_model=None)
async def public_term_preview(
    organization_slug: str, group_id: str, term_id: str, db: DbSession
) -> HTMLResponse | FileResponse:
    """`organization_slug` is cosmetic here too (see `router.tsx` and
    `termPublicPath`) — only `group_id`/`term_id` drive the lookup."""
    if not group_id.isdigit() or not term_id.isdigit():
        return _plain_index()
    try:
        circle = await groups_service.get_public_circle_view(db, int(group_id), int(term_id))
    except EntityNotFoundException:
        return _plain_index()
    return HTMLResponse(render_public_circle_meta(circle))


@router.get("/{organization_slug}/grupa/{group_id}", response_model=None)
async def public_circle_preview(
    organization_slug: str, group_id: str, db: DbSession
) -> HTMLResponse | FileResponse:
    if not group_id.isdigit():
        return _plain_index()
    try:
        circle = await groups_service.get_public_circle_view(db, int(group_id))
    except EntityNotFoundException:
        return _plain_index()
    return HTMLResponse(render_public_circle_meta(circle))


@router.get("/{organization_slug}", response_model=None)
async def public_organization_preview(
    organization_slug: str, db: DbSession
) -> HTMLResponse | FileResponse | JSONResponse:
    """Reserved words (every fixed top-level frontend route, plus dotted
    filenames like `favicon.ico`) fall straight through to the plain
    catch-all below — `RESERVED_SLUGS` already guarantees a real
    Organization can never claim one of these (see `slugs.py`)."""
    if organization_slug in RESERVED_SLUGS or "." in organization_slug:
        return await spa_fallback(organization_slug)
    organization = await organizations_service.get_organization_by_slug(db, organization_slug)
    if organization is None:
        return _plain_index()
    return HTMLResponse(
        render_public_organization_meta(PublicOrganizationResponse.model_validate(organization))
    )


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
