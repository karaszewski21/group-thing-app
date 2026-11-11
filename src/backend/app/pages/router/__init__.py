"""`/api/public/organizations/…`, `/api/public/organizers/…` and
`/api/public/parties/…` routes of the public owner pages.

Assembles the single `router` object (`from app.pages.router import router`)
from the per-page sub-modules; the include order is the registration order.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.pages.router import organization_page, owner_pages

router = APIRouter()
router.include_router(organization_page.router)
router.include_router(owner_pages.router)
