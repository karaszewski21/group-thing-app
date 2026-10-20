"""`/api/locations` routes: the caller's own saved places. The owner is
always the caller's party, never a field of the body."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.users.service import get_profile_by_principal

from . import service
from .schemas import CreateLocationRequest, LocationResponse, UpdateLocationRequest

router = APIRouter(tags=["locations"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.get("/api/locations/mine", response_model=list[LocationResponse])
async def list_my_locations(db: DbSession, principal: ReadPrincipal) -> list[LocationResponse]:
    profile = await get_profile_by_principal(db, principal)
    locations = await service.list_my_locations(db, profile.party_id)
    return [LocationResponse.model_validate(location) for location in locations]


@router.post(
    "/api/locations",
    response_model=LocationResponse,
    status_code=status.HTTP_201_CREATED,
    responses={200: {"model": LocationResponse, "description": "Existing active place"}},
)
async def create_location(
    body: CreateLocationRequest, response: Response, db: DbSession, principal: EditPrincipal
) -> LocationResponse:
    """201 for a new row; 200 with the existing row when the caller already
    has this Google place as an active location."""
    profile = await get_profile_by_principal(db, principal)
    location, created = await service.create_location(db, profile.party_id, body)
    if not created:
        response.status_code = status.HTTP_200_OK
    return LocationResponse.model_validate(location)


@router.patch("/api/locations/{location_id}", response_model=LocationResponse)
async def update_location(
    location_id: uuid.UUID, body: UpdateLocationRequest, db: DbSession, principal: EditPrincipal
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
