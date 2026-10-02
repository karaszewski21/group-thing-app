"""`/api/moderation` — ADMIN-only review queue and decisions (authorization
matrix row `^/api/moderation(/.*)?$` -> ADMIN)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.storage.service import ObjectStorage, get_storage

from . import service
from .schemas import ModerationDecisionRequest, ModerationQueueEntryResponse
from .status import ModerationStatus

router = APIRouter(prefix="/api/moderation", tags=["moderation"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
AdminPrincipal = Annotated[Principal, Depends(require_any("ADMIN"))]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


@router.get("/queue", response_model=list[ModerationQueueEntryResponse])
async def list_queue(
    db: DbSession,
    principal: AdminPrincipal,
    storage: Storage,
    status: ModerationStatus = ModerationStatus.NEEDS_REVIEW,
) -> list[ModerationQueueEntryResponse]:
    entries = await service.list_queue(db, status, storage)
    return [ModerationQueueEntryResponse.model_validate(entry) for entry in entries]


@router.post("/decisions", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def decide(
    body: ModerationDecisionRequest, db: DbSession, principal: AdminPrincipal, storage: Storage
) -> None:
    await service.decide(
        db,
        principal,
        subject_type=body.subject_type,
        subject_id=body.subject_id,
        outcome=body.outcome,
        note=body.note,
        storage=storage,
    )
