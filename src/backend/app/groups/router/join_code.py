"""`/api/groups/.../join-code` routes — a PRIVATE Circle's access code over
`application/join_code.py`."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups import service
from app.groups.schemas import JoinCodeResponse, RedeemJoinCodeRequest, RedeemJoinCodeResponse

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
AuthenticatedPrincipal = Annotated[Principal, Depends(require_any())]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


# The literal `/public/` path is declared before the `{group_id}` routes.
@router.post("/api/groups/public/{group_id}/join-code", response_model=RedeemJoinCodeResponse)
async def redeem_join_code(
    group_id: uuid.UUID,
    body: RedeemJoinCodeRequest,
    db: DbSession,
    principal: AuthenticatedPrincipal,
) -> RedeemJoinCodeResponse:
    created = await service.redeem_join_code(db, principal, group_id, body.code)
    return RedeemJoinCodeResponse(created=created)


@router.get("/api/groups/{group_id}/join-code", response_model=JoinCodeResponse)
async def get_join_code(
    group_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> JoinCodeResponse:
    return JoinCodeResponse(code=await service.get_join_code(db, principal, group_id))


@router.post("/api/groups/{group_id}/join-code/regenerate", response_model=JoinCodeResponse)
async def regenerate_join_code(
    group_id: uuid.UUID, db: DbSession, principal: EditPrincipal
) -> JoinCodeResponse:
    return JoinCodeResponse(code=await service.regenerate_join_code(db, principal, group_id))
