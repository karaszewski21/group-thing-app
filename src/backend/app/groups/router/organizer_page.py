"""`/api/groups/public/organizers/{slug}` — the anonymous organizer
directory behind the public `/:slug` page.

Included first in `app.groups.router`, ahead of `circles.py`'s
`/api/groups/public/{group_id}/access`, so that `/public/organizers/access`
reaches this route instead of being read as a group id."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.pagination import Page, Pagination
from app.db import get_db
from app.groups import service
from app.groups.schemas import OrganizerPageResponse, OrganizerTermResponse
from app.storage.service import ObjectStorage, get_storage

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


@router.get("/api/groups/public/organizers/{slug}", response_model=OrganizerPageResponse)
async def get_organizer_page(slug: str, db: DbSession, storage: Storage) -> OrganizerPageResponse:
    """Unauthenticated — matched by the PUBLIC row
    `GET ^/api/groups/public/organizers/[^/]+(/terms)?$` in
    `AUTHORIZATION_MATRIX`, so no `require_any` dependency. 404 when the slug
    resolves to no Organization or the Organization has no active owner."""
    return await service.get_organizer_page(db, slug, storage)


@router.get(
    "/api/groups/public/organizers/{slug}/terms",
    response_model=Page[OrganizerTermResponse],
)
async def list_organizer_terms(
    slug: str, db: DbSession, pagination: Pagination, group_id: uuid.UUID | None = None
) -> Page[OrganizerTermResponse]:
    """Unauthenticated — matched by the same PUBLIC row as
    `get_organizer_page`. Invalid `page`, `size` or `group_id` give 400 via
    the app's `RequestValidationError` handler; a `group_id` outside the
    owner's PUBLIC circles gives an empty page."""
    return await service.list_organizer_terms(db, slug, pagination, group_id)
