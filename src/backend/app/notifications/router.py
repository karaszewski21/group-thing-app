"""`/api/notifications` routes — the recipient's own in-app inbox.

Every handler derives the recipient from the principal (`profile.party_id`);
the recipient-ownership check on a single notification lives in
`service.mark_read` (raises `AccessDeniedException` -> 403), not the matrix.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.users.service import get_profile_by_principal

from . import service
from .schemas import NotificationResponse, UnreadCountResponse

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.get("/mine", response_model=list[NotificationResponse])
async def list_my_notifications(
    db: DbSession, principal: ReadPrincipal
) -> list[NotificationResponse]:
    profile = await get_profile_by_principal(db, principal)
    notifications = await service.list_my_notifications(db, profile.party_id)
    return [NotificationResponse.model_validate(n) for n in notifications]


@router.get("/unread-count", response_model=UnreadCountResponse)
async def get_unread_count(db: DbSession, principal: ReadPrincipal) -> UnreadCountResponse:
    profile = await get_profile_by_principal(db, principal)
    return UnreadCountResponse(count=await service.count_unread(db, profile.party_id))


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def mark_all_read(db: DbSession, principal: EditPrincipal) -> None:
    profile = await get_profile_by_principal(db, principal)
    await service.mark_all_read(db, profile.party_id)


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(notification_id: int, db: DbSession, principal: EditPrincipal) -> None:
    profile = await get_profile_by_principal(db, principal)
    await service.mark_read(db, notification_id, profile.party_id)
