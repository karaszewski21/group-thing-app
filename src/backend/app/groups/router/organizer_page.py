"""`/api/public/organizations/{slug}/…`, `/api/public/organizers/{slug}/…`
and `/api/public/parties/{party_id}` — the public organization page behind
`/:slug` and its group pages, the owner items and meetings pages and the
person profile behind `/:partyId`."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import OptionalPrincipal
from app.core.cache_headers import PUBLIC_CACHE_CONTROL, set_personalised_cache_headers
from app.core.pagination import Pagination
from app.db import get_db
from app.groups import service
from app.groups.application import owner_items
from app.groups.application.organizer_page import PageLayout
from app.groups.schemas import (
    ExchangeMode,
    OrganizationGroupTermsResponse,
    OrganizationLayoutResponse,
    OwnerItemsPageResponse,
    OwnerMeetingsResponse,
    PartyProfileResponse,
)
from app.storage.service import ObjectStorage, get_storage

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


@router.get(
    "/api/public/organizations/{slug}/layout/{layout}", response_model=OrganizationLayoutResponse
)
async def get_organization_layout(
    slug: str,
    layout: PageLayout,
    db: DbSession,
    storage: Storage,
    response: Response,
    principal: OptionalPrincipal = None,
) -> OrganizationLayoutResponse:
    """The data one page layout shows. Unauthenticated — matched by the
    `GET ^/api/public/` PUBLIC row in `AUTHORIZATION_MATRIX`. 404 when the
    slug resolves to no Organization or it has no active owner; an unknown
    `layout` is a 400."""
    page = await service.get_organization_layout(db, slug, layout, storage, principal)
    set_personalised_cache_headers(response, principal)
    return page


@router.get(
    "/api/public/organizations/{slug}/groups/{group_id}/terms",
    response_model=OrganizationGroupTermsResponse,
)
async def get_organization_group_terms(
    slug: str, group_id: uuid.UUID, db: DbSession, response: Response
) -> OrganizationGroupTermsResponse:
    """One group of the Organization with its upcoming terms. Unauthenticated
    — matched by the `GET ^/api/public/` PUBLIC row in `AUTHORIZATION_MATRIX`.
    Not personalised, so the plain public header. 404 for an unknown slug or
    a group that is not one of the owner's PUBLIC groups."""
    page = await service.get_organization_group_terms(db, slug, group_id)
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    return page


@router.get("/api/public/organizers/{slug}/items", response_model=OwnerItemsPageResponse)
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


@router.get("/api/public/parties/{party_id}/items", response_model=OwnerItemsPageResponse)
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
    `GET ^/api/public/` PUBLIC row. 404 when the party has
    no user profile."""
    page = await owner_items.get_party_owner_items(
        db, party_id, pagination, mode, storage, principal
    )
    set_personalised_cache_headers(response, principal)
    return page


@router.get("/api/public/parties/{party_id}", response_model=PartyProfileResponse)
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


@router.get("/api/public/organizers/{slug}/meetings", response_model=OwnerMeetingsResponse)
async def get_organization_owner_meetings(
    slug: str, db: DbSession, response: Response
) -> OwnerMeetingsResponse:
    """Unauthenticated — matched by the organizers PUBLIC row in
    `AUTHORIZATION_MATRIX`. Not personalised, so the plain public header."""
    meetings = await owner_items.get_organization_owner_meetings(db, slug)
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    return meetings


@router.get("/api/public/parties/{party_id}/meetings", response_model=OwnerMeetingsResponse)
async def get_party_owner_meetings(
    party_id: uuid.UUID, db: DbSession, response: Response
) -> OwnerMeetingsResponse:
    """Unauthenticated — matched by the parties PUBLIC row in
    `AUTHORIZATION_MATRIX`. 404 as for `get_party_profile`."""
    meetings = await owner_items.get_party_owner_meetings(db, party_id)
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    return meetings
