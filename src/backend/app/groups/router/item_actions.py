"""`GET /api/items/{item_id}/actions` — the item page's action read model
(PUBLIC, `OptionalPrincipal`): the owner's upcoming contexts come from the
server, not from URL hints."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import OptionalPrincipal
from app.core.cache_headers import set_personalised_cache_headers
from app.db import get_db
from app.groups.application import item_actions
from app.groups.schemas import ItemActionsResponse

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.get("/api/items/{item_id}/actions", response_model=ItemActionsResponse)
async def get_item_actions(
    item_id: uuid.UUID, db: DbSession, response: Response, principal: OptionalPrincipal = None
) -> ItemActionsResponse:
    actions = await item_actions.get_item_actions(db, item_id, principal)
    set_personalised_cache_headers(response, principal)
    return actions
