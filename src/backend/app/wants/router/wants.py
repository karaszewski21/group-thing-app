"""`/api/wants` routes. Every `/{want_id}` route answers 404 for a want that
is unknown, belongs to another party or was withdrawn. The action routes
return the want, except the "opened" mark, which returns nothing."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.storage.service import ObjectStorage, get_storage

from ..application import reads, writes
from ..schemas import (
    CloseWantRequest,
    CreateWantRequest,
    UpdateWantRequest,
    WantMatchResponse,
    WantResponse,
)

router = APIRouter(prefix="/api/wants", tags=["wants"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]
# Wants are for logged-in users only: the OAuth `mcp:read`/`mcp:edit` scopes
# are deliberately not accepted here (authorization matrix rows 66-67).
ReadPrincipal = Annotated[Principal, Depends(require_any("READ"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT"))]


# The literal paths are declared before the `/{want_id}` routes.
@router.get("", response_model=list[WantResponse])
async def list_wants(
    db: DbSession,
    principal: ReadPrincipal,
    matched_item_id: Annotated[uuid.UUID | None, Query()] = None,
) -> list[WantResponse]:
    return await reads.list_wants(db, principal, matched_item_id=matched_item_id)


@router.post("", response_model=WantResponse, status_code=status.HTTP_201_CREATED)
async def create_want(
    body: CreateWantRequest, db: DbSession, principal: EditPrincipal
) -> WantResponse:
    return await writes.create_want(db, principal, body, now=datetime.utcnow())


@router.get("/{want_id}", response_model=WantResponse)
async def get_want(want_id: uuid.UUID, db: DbSession, principal: ReadPrincipal) -> WantResponse:
    return await reads.get_want(db, principal, want_id)


@router.patch("/{want_id}", response_model=WantResponse)
async def update_want(
    want_id: uuid.UUID, body: UpdateWantRequest, db: DbSession, principal: EditPrincipal
) -> WantResponse:
    return await writes.update_want(db, principal, want_id, body, now=datetime.utcnow())


@router.post("/{want_id}/extend", response_model=WantResponse)
async def extend_want(want_id: uuid.UUID, db: DbSession, principal: EditPrincipal) -> WantResponse:
    return await writes.extend_want(db, principal, want_id, now=datetime.utcnow())


@router.post("/{want_id}/close", response_model=WantResponse)
async def close_want(
    want_id: uuid.UUID, body: CloseWantRequest, db: DbSession, principal: EditPrincipal
) -> WantResponse:
    return await writes.close_want(db, principal, want_id, body.outcome, now=datetime.utcnow())


@router.post("/{want_id}/resume", response_model=WantResponse)
async def resume_want(want_id: uuid.UUID, db: DbSession, principal: EditPrincipal) -> WantResponse:
    return await writes.resume_want(db, principal, want_id, now=datetime.utcnow())


@router.get("/{want_id}/matches", response_model=list[WantMatchResponse])
async def list_matches(
    want_id: uuid.UUID, db: DbSession, principal: ReadPrincipal, storage: Storage
) -> list[WantMatchResponse]:
    return await reads.list_matches(db, principal, want_id, storage)


@router.post("/{want_id}/matches/seen", response_model=WantResponse)
async def mark_matches_seen(
    want_id: uuid.UUID, db: DbSession, principal: EditPrincipal
) -> WantResponse:
    return await writes.mark_matches_seen(db, principal, want_id, now=datetime.utcnow())


@router.post("/{want_id}/matches/{item_id}/opened", status_code=status.HTTP_204_NO_CONTENT)
async def mark_match_opened(
    want_id: uuid.UUID, item_id: uuid.UUID, db: DbSession, principal: EditPrincipal
) -> None:
    await writes.mark_match_opened(db, principal, want_id, item_id, now=datetime.utcnow())
