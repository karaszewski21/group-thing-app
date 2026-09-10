"""`/api/pledges` routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups import service
from app.groups.schemas import (
    CreatePledgeRequest,
    FulfillPledgeRequest,
    MyPledgeResponse,
    PledgeResponse,
)
from app.users.service import get_profile_by_principal

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


# --- Pledge --------------------------------------------------------------------


@router.post("/api/pledges", response_model=PledgeResponse, status_code=status.HTTP_201_CREATED)
async def create_pledge(
    body: CreatePledgeRequest, db: DbSession, principal: EditPrincipal
) -> PledgeResponse:
    pledge = await service.create_pledge(db, principal, body.needed_item_id)
    return PledgeResponse.model_validate(pledge)


@router.get("/api/pledges", response_model=list[PledgeResponse])
async def list_pledges(
    needed_item_id: int, db: DbSession, principal: ReadPrincipal
) -> list[PledgeResponse]:
    pledges = await service.list_pledges(db, needed_item_id)
    return [PledgeResponse.model_validate(pledge) for pledge in pledges]


# Declared before `GET /api/pledges/{pledge_id}` so the literal `mine`
# segment is not parsed as `pledge_id: int`. Covered by matrix row 36
# (`GET ^/api/pledges(/.*)?$` -> READ); no ownership check beyond auth (the
# caller's own party is derived from the principal).
@router.get("/api/pledges/mine", response_model=list[MyPledgeResponse])
async def list_my_pledges(db: DbSession, principal: ReadPrincipal) -> list[MyPledgeResponse]:
    profile = await get_profile_by_principal(db, principal)
    return await service.list_my_pledges(db, profile.party_id)


@router.get("/api/pledges/{pledge_id}", response_model=PledgeResponse)
async def get_pledge(pledge_id: int, db: DbSession, principal: ReadPrincipal) -> PledgeResponse:
    pledge = await service.get_pledge(db, pledge_id)
    return PledgeResponse.model_validate(pledge)


@router.post("/api/pledges/{pledge_id}/withdraw", response_model=PledgeResponse)
async def withdraw_pledge(
    pledge_id: int, db: DbSession, principal: EditPrincipal
) -> PledgeResponse:
    pledge = await service.withdraw_pledge(db, principal, pledge_id)
    return PledgeResponse.model_validate(pledge)


@router.post("/api/pledges/{pledge_id}/fulfill", response_model=PledgeResponse)
async def fulfill_pledge(
    pledge_id: int, body: FulfillPledgeRequest, db: DbSession, principal: EditPrincipal
) -> PledgeResponse:
    pledge = await service.fulfill_pledge(db, principal, pledge_id, body)
    return PledgeResponse.model_validate(pledge)


@router.post("/api/pledges/{pledge_id}/sync", response_model=PledgeResponse)
async def sync_pledge_fulfillment(
    pledge_id: int, db: DbSession, principal: EditPrincipal
) -> PledgeResponse:
    pledge = await service.sync_pledge_fulfillment(db, pledge_id)
    return PledgeResponse.model_validate(pledge)
