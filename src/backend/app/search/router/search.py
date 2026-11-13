"""`GET /api/public/search` — the global search behind `/search`."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import OptionalPrincipal
from app.core.cache_headers import set_personalised_cache_headers
from app.core.pagination import DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, PageParams
from app.db import get_db
from app.storage.service import ObjectStorage, get_storage

from ..application import search as search_service
from ..infrastructure.groups_acl import ExchangeMode, VisibilityScope
from ..infrastructure.inventory_acl import ItemCondition
from ..schemas import SearchPage

router = APIRouter(tags=["search"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]

# The search is public: deep pages (large OFFSETs over the full match) are a
# 400, not an expensive scan.
MAX_SEARCH_PAGE = 50


def _search_page(
    page: Annotated[int, Query(ge=1, le=MAX_SEARCH_PAGE)] = 1,
    size: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = DEFAULT_PAGE_SIZE,
) -> PageParams:
    return PageParams(page=page, size=size)


SearchPagination = Annotated[PageParams, Depends(_search_page)]


@router.get("/api/public/search", response_model=SearchPage)
async def search(
    db: DbSession,
    storage: Storage,
    pagination: SearchPagination,
    response: Response,
    q: Annotated[str, Query(max_length=100)] = "",
    mode: search_service.SearchMode = "items",
    scope: Literal["mine", "all"] = "all",
    category: uuid.UUID | None = None,
    condition: ItemCondition | None = None,
    offer_type: ExchangeMode | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    principal: OptionalPrincipal = None,
) -> SearchPage:
    """Unauthenticated — matched by the `GET ^/api/public/.*$` PUBLIC row in
    `AUTHORIZATION_MATRIX`; a valid token personalises the results. 400 for
    a query under 2 folded characters (a blank one is an items browse of
    `category`), a bad parameter, a page past
    `MAX_SEARCH_PAGE`, a filter of the other mode, `date_to` before
    `date_from` or an unknown category. A guest
    always searches everywhere."""
    page = await search_service.search(
        db,
        principal,
        q,
        mode,
        VisibilityScope(scope),
        search_service.SearchFilters(
            category_id=category,
            condition=condition,
            offer_type=offer_type,
            date_from=date_from,
            date_to=date_to,
        ),
        pagination,
        storage,
    )
    set_personalised_cache_headers(response, principal)
    return page
