"""`/api/item-listing-preferences` and `/api/term-item-listings` routes —
the exchange-mechanism HTTP layer over `application/term_item_listings.py`'s
set/list/browse/take use cases."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups import service
from app.groups.schemas import (
    BrowseTermItemListingResponse,
    ItemListingPreferenceResponse,
    SetItemListingPreferenceRequest,
    TakeTermItemListingRequest,
)
from app.users.service import get_profile_by_principal

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.put(
    "/api/item-listing-preferences/{item_id}",
    response_model=ItemListingPreferenceResponse | None,
)
async def set_item_listing_preference(
    item_id: int, body: SetItemListingPreferenceRequest, db: DbSession, principal: EditPrincipal
) -> ItemListingPreferenceResponse | None:
    preference = await service.set_item_listing_preference(db, principal, item_id, body.mode)
    return ItemListingPreferenceResponse.model_validate(preference) if preference else None


@router.get(
    "/api/item-listing-preferences/mine", response_model=list[ItemListingPreferenceResponse]
)
async def list_my_item_listing_preferences(
    db: DbSession, principal: ReadPrincipal
) -> list[ItemListingPreferenceResponse]:
    preferences = await service.list_my_item_listing_preferences(db, principal)
    return [ItemListingPreferenceResponse.model_validate(p) for p in preferences]


# Declared before `POST /api/term-item-listings/{item_id}/take` so the
# literal `mine`/`browse` segments are not parsed as `item_id: int` — same
# ordering caveat as `pledges.py`'s `list_my_pledges` (see comment there).
@router.get("/api/term-item-listings/mine", response_model=list[BrowseTermItemListingResponse])
async def list_my_term_item_listings(
    term_id: int, db: DbSession, principal: ReadPrincipal
) -> list[BrowseTermItemListingResponse]:
    profile = await get_profile_by_principal(db, principal)
    return await service.list_my_term_item_listings(db, term_id, profile.party_id)


@router.get("/api/term-item-listings/browse", response_model=list[BrowseTermItemListingResponse])
async def list_browsable_term_item_listings(
    term_id: int, db: DbSession, principal: ReadPrincipal
) -> list[BrowseTermItemListingResponse]:
    profile = await get_profile_by_principal(db, principal)
    return await service.list_browsable_term_item_listings(db, term_id, profile.party_id)


@router.post("/api/term-item-listings/{item_id}/take", response_model=BrowseTermItemListingResponse)
async def take_item_listing(
    item_id: int, body: TakeTermItemListingRequest, db: DbSession, principal: EditPrincipal
) -> BrowseTermItemListingResponse:
    return await service.take_item_listing(db, principal, item_id, body)
