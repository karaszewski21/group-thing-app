"""`/api/memberships` routes — create / end a circle membership."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups import service
from app.groups.schemas import CreateMembershipRequest, MembershipResponse

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


# --- Membership ----------------------------------------------------------------


@router.post(
    "/api/memberships", response_model=MembershipResponse, status_code=status.HTTP_201_CREATED
)
async def create_membership(
    body: CreateMembershipRequest, db: DbSession, principal: EditPrincipal
) -> MembershipResponse:
    membership = await service.create_membership(db, principal, body)
    rows = await service.build_membership_responses(db, [membership])
    return MembershipResponse(**rows[0])


@router.post("/api/memberships/{membership_id}/end", response_model=MembershipResponse)
async def end_membership(
    membership_id: int, db: DbSession, principal: EditPrincipal, valid_to: date | None = None
) -> MembershipResponse:
    membership = await service.end_membership(
        db, principal, membership_id, valid_to or date.today()
    )
    rows = await service.build_membership_responses(db, [membership])
    return MembershipResponse(**rows[0])
