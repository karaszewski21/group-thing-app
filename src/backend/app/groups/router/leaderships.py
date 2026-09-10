"""`/api/leaderships` routes — assign / end a circle leadership."""

from __future__ import annotations

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups import service
from app.groups.schemas import AssignLeadershipRequest, LeadershipResponse

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


# --- Leadership ---------------------------------------------------------------


@router.post(
    "/api/leaderships", response_model=LeadershipResponse, status_code=status.HTTP_201_CREATED
)
async def assign_leadership(
    body: AssignLeadershipRequest, db: DbSession, principal: EditPrincipal
) -> LeadershipResponse:
    leadership = await service.assign_leadership(
        db, body.group_id, body.organizer_party_id, body.valid_from
    )
    rows = await service.build_leadership_responses(db, [leadership])
    return LeadershipResponse(**rows[0])


@router.post("/api/leaderships/{leadership_id}/end", response_model=LeadershipResponse)
async def remove_leadership(
    leadership_id: int, db: DbSession, principal: EditPrincipal, valid_to: date | None = None
) -> LeadershipResponse:
    leadership = await service.remove_leadership(db, leadership_id, valid_to or date.today())
    rows = await service.build_leadership_responses(db, [leadership])
    return LeadershipResponse(**rows[0])
