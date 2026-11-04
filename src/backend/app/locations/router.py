"""`/api/locations` routes: the caller's own saved places. The owner is
always the caller's party, never a field of the body. `/api/localities`
searches the TERYT locality dictionary a place points at."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.users.service import get_profile_by_principal

from . import service
from .localities import search_localities
from .schemas import (
    LocalityResponse,
    LocalitySearchResponse,
    LocalitySearchResult,
    LocationRequest,
    LocationResponse,
)

router = APIRouter(tags=["locations"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.get("/api/localities", response_model=LocalitySearchResponse)
async def list_localities(
    db: DbSession,
    principal: ReadPrincipal,
    q: Annotated[str, Query(max_length=100)] = "",
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
) -> LocalitySearchResponse:
    """A name prefix (diacritics ignored) or a postal-code prefix; a `q`
    shorter than 2 characters returns no results."""
    matches, total = await search_localities(db, q, limit)
    return LocalitySearchResponse(
        results=[
            LocalitySearchResult(
                **LocalityResponse.model_validate(match.locality).model_dump(),
                postal_code=match.postal_code,
            )
            for match in matches
        ],
        total=total,
    )


@router.get("/api/locations/mine", response_model=list[LocationResponse])
async def list_my_locations(db: DbSession, principal: ReadPrincipal) -> list[LocationResponse]:
    profile = await get_profile_by_principal(db, principal)
    locations = await service.list_my_locations(db, profile.party_id)
    return [LocationResponse.model_validate(location) for location in locations]


@router.post("/api/locations", response_model=LocationResponse, status_code=status.HTTP_201_CREATED)
async def create_location(
    body: LocationRequest, db: DbSession, principal: EditPrincipal
) -> LocationResponse:
    profile = await get_profile_by_principal(db, principal)
    location = await service.create_location(db, profile.party_id, body)
    return LocationResponse.model_validate(location)


@router.put("/api/locations/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: uuid.UUID, body: LocationRequest, db: DbSession, principal: EditPrincipal
) -> LocationResponse:
    profile = await get_profile_by_principal(db, principal)
    location = await service.update_location(db, location_id, profile.party_id, body)
    return LocationResponse.model_validate(location)


@router.delete(
    "/api/locations/{location_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_location(location_id: uuid.UUID, db: DbSession, principal: EditPrincipal) -> None:
    profile = await get_profile_by_principal(db, principal)
    await service.soft_delete_location(db, location_id, profile.party_id)
