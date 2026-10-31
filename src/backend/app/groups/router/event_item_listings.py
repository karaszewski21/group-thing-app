"""`POST /api/events/{event_id}/items/{item_id}/take|propose` — the event
counterparts of the term take/propose routes, over the same use cases in
`application/term_item_listings.py`."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups.application import term_item_listings
from app.groups.schemas import (
    EventProposeRequest,
    EventTakeRequest,
    EventTakeResponse,
    SwapProposalResponse,
)

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.post("/api/events/{event_id}/items/{item_id}/take", response_model=EventTakeResponse)
async def take_event_item(
    event_id: uuid.UUID,
    item_id: uuid.UUID,
    body: EventTakeRequest,
    db: DbSession,
    principal: EditPrincipal,
) -> EventTakeResponse:
    return await term_item_listings.take_event_item(
        db, principal, event_id, item_id, body.reservation_type
    )


@router.post("/api/events/{event_id}/items/{item_id}/propose", response_model=SwapProposalResponse)
async def propose_event_swap(
    event_id: uuid.UUID,
    item_id: uuid.UUID,
    body: EventProposeRequest,
    db: DbSession,
    principal: EditPrincipal,
) -> SwapProposalResponse:
    proposal = await term_item_listings.propose_event_swap(
        db, principal, event_id, item_id, body.offered_item_id
    )
    return SwapProposalResponse.model_validate(proposal)
