"""`GET /api/items/{item_id}/actions?term=|event=` — the item page's action
read model (PUBLIC, `OptionalPrincipal`). `term`/`event` are hints from the
URL: a malformed or unknown id yields `context=null`, never an error."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import OptionalPrincipal
from app.db import get_db
from app.groups.application import item_actions
from app.groups.schemas import ItemActionsResponse

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


def _hint(value: str | None) -> uuid.UUID | None:
    if value is None:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        return None


@router.get("/api/items/{item_id}/actions", response_model=ItemActionsResponse)
async def get_item_actions(
    item_id: uuid.UUID,
    db: DbSession,
    term: str | None = None,
    event: str | None = None,
    principal: OptionalPrincipal = None,
) -> ItemActionsResponse:
    if term is not None and event is not None:
        raise ValueError("Podaj termin albo wydarzenie, nie oba")
    return await item_actions.get_item_actions(db, item_id, principal, _hint(term), _hint(event))
