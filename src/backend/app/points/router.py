"""`/api/points` routes, mounted by `app.main`. The config is ADMIN-only
(matrix row 68); the other reads are for logged-in users only, without the
OAuth `mcp:*` scopes (row 69)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.core.cache_headers import set_personalised_cache_headers
from app.core.pagination import Page, Pagination
from app.db import get_db

from .application import config, reads
from .schemas import (
    AttendanceRulesResponse,
    PointHistoryEntryResponse,
    PointsConfigResponse,
    PointsSummaryResponse,
    UpdatePointsConfigRequest,
)

router = APIRouter(prefix="/api/points", tags=["points"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
AdminPrincipal = Annotated[Principal, Depends(require_any("ADMIN"))]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ"))]


@router.get("/config", response_model=PointsConfigResponse)
async def get_config(db: DbSession, _principal: AdminPrincipal) -> PointsConfigResponse:
    return PointsConfigResponse.model_validate(await config.load_config(db))


@router.put("/config", response_model=PointsConfigResponse)
async def update_config(
    body: UpdatePointsConfigRequest, db: DbSession, _principal: AdminPrincipal
) -> PointsConfigResponse:
    return PointsConfigResponse.model_validate(await config.update_config(db, body))


@router.get("/attendance-rules", response_model=AttendanceRulesResponse)
async def get_attendance_rules(db: DbSession, _principal: ReadPrincipal) -> AttendanceRulesResponse:
    current = await config.load_config(db)
    return AttendanceRulesResponse(
        levels=current.attendance_levels,
        min_present=current.attendance_min_present,
        auto_close_days=current.attendance_auto_close_days,
    )


@router.get("/me", response_model=PointsSummaryResponse)
async def get_my_points(
    db: DbSession, response: Response, principal: ReadPrincipal
) -> PointsSummaryResponse:
    summary = await reads.my_summary(db, principal)
    set_personalised_cache_headers(response, principal)
    return summary


@router.get("/me/history", response_model=Page[PointHistoryEntryResponse])
async def get_my_points_history(
    db: DbSession, response: Response, principal: ReadPrincipal, pagination: Pagination
) -> Page[PointHistoryEntryResponse]:
    history = await reads.my_history(db, principal, pagination)
    set_personalised_cache_headers(response, principal)
    return history
