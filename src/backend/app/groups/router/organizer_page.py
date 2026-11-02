"""`/api/groups/public/organizers/{slug}` — the public organizer
directory behind the `/:slug` page, the owner items and meetings pages and
the person profile behind `/:partyId`.

Included first in `app.groups.router`, ahead of `circles.py`'s
`/api/groups/public/{group_id}/access`, so that `/public/organizers/access`
reaches this route instead of being read as a group id."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import OptionalPrincipal
from app.core.cache_headers import PUBLIC_CACHE_CONTROL, set_personalised_cache_headers
from app.core.pagination import Page, Pagination
from app.db import get_db
from app.groups import service
from app.groups.application import owner_items
from app.groups.schemas import (
    ExchangeMode,
    OrganizerPageResponse,
    OrganizerTermResponse,
    OwnerItemsPageResponse,
    OwnerMeetingsResponse,
    PartyProfileResponse,
)
from app.storage.service import ObjectStorage, get_storage

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


@router.get("/api/groups/public/organizers/{slug}", response_model=OrganizerPageResponse)
async def get_organizer_page(
    slug: str,
    db: DbSession,
    storage: Storage,
    response: Response,
    principal: OptionalPrincipal = None,
) -> OrganizerPageResponse:
    """Unauthenticated — matched by the PUBLIC row
    `GET ^/api/groups/public/organizers/[^/]+(/terms|/items|/meetings)?$` in
    `AUTHORIZATION_MATRIX`, so no `require_any` dependency. 404 when the slug
    resolves to no Organization or the Organization has no active owner."""
    page = await service.get_organizer_page(db, slug, storage, principal)
    set_personalised_cache_headers(response, principal)
    return page


@router.get(
    "/api/groups/public/organizers/{slug}/terms",
    response_model=Page[OrganizerTermResponse],
)
async def list_organizer_terms(
    slug: str,
    db: DbSession,
    pagination: Pagination,
    response: Response,
    group_id: uuid.UUID | None = None,
) -> Page[OrganizerTermResponse]:
    """Unauthenticated — matched by the same PUBLIC row as
    `get_organizer_page`. Invalid `page`, `size` or `group_id` give 400 via
    the app's `RequestValidationError` handler; a `group_id` outside the
    owner's PUBLIC circles gives an empty page."""
    page = await service.list_organizer_terms(db, slug, pagination, group_id)
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    return page


@router.get("/api/groups/public/organizers/{slug}/items", response_model=OwnerItemsPageResponse)
async def get_organization_owner_items(
    slug: str,
    db: DbSession,
    storage: Storage,
    pagination: Pagination,
    response: Response,
    mode: ExchangeMode | None = None,
    principal: OptionalPrincipal = None,
) -> OwnerItemsPageResponse:
    """Unauthenticated — matched by the organizers PUBLIC row in
    `AUTHORIZATION_MATRIX`. 404 as for `get_organizer_page`, including for
    `k-…` pseudo-slugs."""
    page = await owner_items.get_organization_owner_items(
        db, slug, pagination, mode, storage, principal
    )
    set_personalised_cache_headers(response, principal)
    return page


@router.get("/api/groups/public/parties/{party_id}/items", response_model=OwnerItemsPageResponse)
async def get_party_owner_items(
    party_id: uuid.UUID,
    db: DbSession,
    storage: Storage,
    pagination: Pagination,
    response: Response,
    mode: ExchangeMode | None = None,
    principal: OptionalPrincipal = None,
) -> OwnerItemsPageResponse:
    """Unauthenticated — matched by the PUBLIC row
    `GET ^/api/groups/public/parties/[^/]+(/items|/meetings)?$`. 404 when the party has
    no user profile."""
    page = await owner_items.get_party_owner_items(
        db, party_id, pagination, mode, storage, principal
    )
    set_personalised_cache_headers(response, principal)
    return page


@router.get("/api/groups/public/parties/{party_id}", response_model=PartyProfileResponse)
async def get_party_profile(
    party_id: uuid.UUID,
    db: DbSession,
    storage: Storage,
    response: Response,
    principal: OptionalPrincipal = None,
) -> PartyProfileResponse:
    """Unauthenticated — matched by the parties PUBLIC row in
    `AUTHORIZATION_MATRIX`. 404 when the party has no user profile or
    nothing public (see `owner_items.get_party_profile`)."""
    profile = await owner_items.get_party_profile(db, party_id, storage, principal)
    set_personalised_cache_headers(response, principal)
    return profile


@router.get(
    "/api/groups/public/organizers/{slug}/meetings", response_model=OwnerMeetingsResponse
)
async def get_organization_owner_meetings(
    slug: str, db: DbSession, response: Response
) -> OwnerMeetingsResponse:
    """Unauthenticated — matched by the organizers PUBLIC row in
    `AUTHORIZATION_MATRIX`. Not personalised, so the plain public header."""
    meetings = await owner_items.get_organization_owner_meetings(db, slug)
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    return meetings


@router.get(
    "/api/groups/public/parties/{party_id}/meetings", response_model=OwnerMeetingsResponse
)
async def get_party_owner_meetings(
    party_id: uuid.UUID, db: DbSession, response: Response
) -> OwnerMeetingsResponse:
    """Unauthenticated — matched by the parties PUBLIC row in
    `AUTHORIZATION_MATRIX`. 404 as for `get_party_profile`."""
    meetings = await owner_items.get_party_owner_meetings(db, party_id)
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    return meetings
