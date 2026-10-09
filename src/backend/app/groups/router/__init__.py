"""`/api/groups` (including `.../join-requests`), `/api/leaderships`,
`/api/memberships`, `/api/terms`, `/api/needed-items` and `/api/pledges`
routes.

Assembles the single `router` object (still importable as
`from app.groups.router import router`, unchanged for `main.py`) from the
per-resource sub-modules.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.groups.router import (
    circles,
    join_requests,
    leaderships,
    memberships,
    organizer_page,
    pledges,
    term_item_listings,
    terms,
)

router = APIRouter()
# organizer_page.py registers before everything else: its literal
# `/api/groups/public/organizers/{slug}` must win over circles.py's
# `/api/groups/public/{group_id}/access`, which would otherwise claim
# `/public/organizers/access` (and fail it as a non-UUID group id).
router.include_router(organizer_page.router)
# Registration order is load-bearing: circles.py's routes register next so
# /api/groups/mine/attendances and /api/groups/public/{id} and PATCH /api/groups/{id}
# resolve before GET /api/groups/{group_id} (FastAPI matches in registration order).
router.include_router(circles.router)
router.include_router(join_requests.router)
router.include_router(leaderships.router)
router.include_router(memberships.router)
router.include_router(terms.router)
router.include_router(pledges.router)
router.include_router(term_item_listings.router)
