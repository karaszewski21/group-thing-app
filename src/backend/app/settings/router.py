"""`/api/admin/settings` routes, mounted by `app.main`; ADMIN-only (matrix
row 83)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.db import get_db

from . import service
from .schemas import AppSettingsResponse, AppSettingsUpdateRequest

router = APIRouter(prefix="/api/admin/settings", tags=["settings"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
AdminPrincipal = Annotated[Principal, Depends(require_any("ADMIN"))]


@router.get("", response_model=AppSettingsResponse)
async def get_settings(db: DbSession, _principal: AdminPrincipal) -> AppSettingsResponse:
    return AppSettingsResponse.model_validate(await service.load_settings(db))


@router.put("", response_model=AppSettingsResponse)
async def update_settings(
    body: AppSettingsUpdateRequest, db: DbSession, _principal: AdminPrincipal
) -> AppSettingsResponse:
    return AppSettingsResponse.model_validate(await service.update_settings(db, body))
