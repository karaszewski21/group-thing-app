"""`/api/groups`, `/api/leaderships`, `/api/memberships`, `/api/terms`,
`/api/needed-items` and `/api/pledges` routes.

Assembles the single `router` object (still importable as
`from app.groups.router import router`, unchanged for `main.py`) from the
per-resource sub-modules.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.groups.router import circles, leaderships, memberships, pledges, terms

router = APIRouter()
# Registration order is load-bearing: circles.py's routes register first so
# /api/groups/mine/attendances and /api/groups/public/{id} and PATCH /api/groups/{id}
# resolve before GET /api/groups/{group_id} (FastAPI matches in registration order).
router.include_router(circles.router)
router.include_router(leaderships.router)
router.include_router(memberships.router)
router.include_router(terms.router)
router.include_router(pledges.router)
