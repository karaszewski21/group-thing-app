"""`/api/groups/.../join-requests` routes — a PRIVATE Circle's access-request
lifecycle over `application/join_requests.py`."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db
from app.groups import service
from app.groups.schemas import (
    CreateJoinRequestRequest,
    JoinRequestResponse,
    PendingJoinRequestResponse,
)

router = APIRouter(tags=["groups"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
AuthenticatedPrincipal = Annotated[Principal, Depends(require_any())]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.post(
    "/api/groups/public/{group_id}/join-requests",
    response_model=JoinRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_join_request(
    group_id: int,
    db: DbSession,
    principal: AuthenticatedPrincipal,
    body: CreateJoinRequestRequest | None = None,
) -> JoinRequestResponse:
    term_id = body.term_id if body is not None else None
    join_request = await service.create_join_request(db, principal, group_id, term_id)
    return JoinRequestResponse.model_validate(join_request)


@router.post(
    "/api/groups/public/{group_id}/join-requests/{request_id}/withdraw",
    response_model=JoinRequestResponse,
)
async def withdraw_join_request(
    group_id: int, request_id: int, db: DbSession, principal: AuthenticatedPrincipal
) -> JoinRequestResponse:
    join_request = await service.withdraw_join_request(db, principal, group_id, request_id)
    return JoinRequestResponse.model_validate(join_request)


# Declared before `/api/groups/{group_id}/join-requests` so `mine` is never
# parsed as a `group_id`.
@router.get("/api/groups/mine/join-requests", response_model=list[PendingJoinRequestResponse])
async def list_my_pending_join_requests(
    db: DbSession, principal: ReadPrincipal
) -> list[PendingJoinRequestResponse]:
    return await service.list_my_pending_join_requests(db, principal)


@router.get("/api/groups/{group_id}/join-requests", response_model=list[PendingJoinRequestResponse])
async def list_group_pending_join_requests(
    group_id: int, db: DbSession, principal: ReadPrincipal
) -> list[PendingJoinRequestResponse]:
    return await service.list_group_pending_join_requests(db, principal, group_id)


@router.post(
    "/api/groups/{group_id}/join-requests/{request_id}/approve",
    response_model=JoinRequestResponse,
)
async def approve_join_request(
    group_id: int, request_id: int, db: DbSession, principal: EditPrincipal
) -> JoinRequestResponse:
    join_request = await service.approve_join_request(db, principal, group_id, request_id)
    return JoinRequestResponse.model_validate(join_request)


@router.post(
    "/api/groups/{group_id}/join-requests/{request_id}/reject",
    response_model=JoinRequestResponse,
)
async def reject_join_request(
    group_id: int, request_id: int, db: DbSession, principal: EditPrincipal
) -> JoinRequestResponse:
    join_request = await service.reject_join_request(db, principal, group_id, request_id)
    return JoinRequestResponse.model_validate(join_request)
