"""`POST /api/items/{item_id}/take|propose` — the item page's reservation
writes in a term, an event or a personal pickup, over the shared take/propose
use cases in `application/term_item_listings.py`."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups.application import term_item_listings
from app.groups.schemas import (
    ItemProposeRequest,
    ItemTakeRequest,
    ItemTakeResponse,
    SwapProposalResponse,
)

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


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
