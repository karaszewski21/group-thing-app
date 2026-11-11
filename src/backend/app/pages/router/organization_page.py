"""`/api/public/organizations/{slug}/…` — the public organization page behind
`/:slug`, one read per layout, and its group pages."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import OptionalPrincipal
from app.core.cache_headers import PUBLIC_CACHE_CONTROL, set_personalised_cache_headers
from app.db import get_db
from app.storage.service import ObjectStorage, get_storage

from ..application import organization_page
from ..domain.page_content import PageLayout
from ..schemas import OrganizationGroupTermsResponse, OrganizationLayoutResponse

router = APIRouter(tags=["pages"])

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
    page = await organization_page.get_organization_layout(db, slug, layout, storage, principal)
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
    page = await organization_page.get_organization_group_terms(db, slug, group_id)
    response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    return page
