"""`POST /api/items/{item_id}/take|propose` — the item page's reservation
writes in a term, an event or a personal pickup, over the shared take/propose
use cases in `application/term_item_listings.py` — and the caller's list of
them, `GET /api/reservations/mine` (`application/my_reservations.py`)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups.application import my_reservations, term_item_listings
from app.groups.schemas import (
    ItemProposeRequest,
    ItemTakeRequest,
    ItemTakeResponse,
    MyReservationResponse,
    SwapProposalResponse,
)
from app.storage.service import ObjectStorage, get_storage

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


# The groups router is included before circulation's, so this literal path
# wins over `GET /api/reservations/{reservation_id}`. Matrix row 42
# (`GET ^/api/reservations(/.*)?$` -> READ).
@router.get("/api/reservations/mine", response_model=list[MyReservationResponse])
async def list_my_reservations(
    db: DbSession, principal: ReadPrincipal, storage: Storage
) -> list[MyReservationResponse]:
    return await my_reservations.list_my_reservations(db, principal, storage)


@router.post("/api/items/{item_id}/take", response_model=ItemTakeResponse)
async def take_item(
    item_id: uuid.UUID, body: ItemTakeRequest, db: DbSession, principal: EditPrincipal
) -> ItemTakeResponse:
    return await term_item_listings.take_item(db, principal, item_id, body)


@router.post("/api/items/{item_id}/propose", response_model=SwapProposalResponse)
async def propose_item_swap(
    item_id: uuid.UUID, body: ItemProposeRequest, db: DbSession, principal: EditPrincipal
) -> SwapProposalResponse:
    proposal = await term_item_listings.propose_item_swap(db, principal, item_id, body)
    return SwapProposalResponse.model_validate(proposal)
