"""`/api/moderation` — ADMIN-only review queue and decisions (authorization
matrix row `^/api/moderation(/.*)?$` -> ADMIN)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.core.pagination import Page, Pagination
from app.db import get_db
from app.product import service as product_service
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


@router.get("/photos", response_model=Page[ModerationQueueEntryResponse])
async def list_photos(
    db: DbSession,
    principal: AdminPrincipal,
    storage: Storage,
    pagination: Pagination,
    status: ModerationStatus | None = None,
) -> Page[ModerationQueueEntryResponse]:
    entries, total = await service.list_photos(db, status, storage, pagination)
    return Page(
        items=[ModerationQueueEntryResponse.model_validate(entry) for entry in entries],
        total=total,
        page=pagination.page,
        size=pagination.size,
    )


@router.delete("/photos/{photo_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_photo(photo_id: uuid.UUID, db: DbSession, principal: AdminPrincipal) -> None:
    """Removes the photo from the database and, via the outbox, both of its
    files from object storage."""
    await product_service.delete_photo_as_admin(db, photo_id)


@router.post("/decisions", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def decide(
    body: ModerationDecisionRequest, db: DbSession, principal: AdminPrincipal, storage: Storage
) -> None:
    await service.decide(
        db,
        principal,
        subject_id=body.subject_id,
        outcome=body.outcome,
        note=body.note,
        storage=storage,
    )
