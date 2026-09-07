"""`/api/auth/register` and `/api/people` routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth_deps import Principal, require_any
from app.core.security import encode_login_token
from app.db import get_db
from app.groups.schemas import LeadershipResponse
from app.groups.service import build_leadership_responses, list_active_leaderships_for_party

from . import service
from .schemas import RegisterRequest, RegisterResponse, UserProfileResponse

router = APIRouter(tags=["users"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]


@router.post(
    "/api/auth/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED
)
async def register(body: RegisterRequest, db: DbSession) -> RegisterResponse:
    """Public — no `principal` dependency. `["READ", "EDIT"]` mirrors
    exactly what `service.create_account` always grants."""
    user, party_id = await service.register(db, body)
    token = encode_login_token(
        user.username, ["READ", "EDIT"], settings.jwt_secret, settings.jwt_expiration_ms
    )
    return RegisterResponse(token=token, party_id=party_id, role=body.role)


@router.get("/api/people/me", response_model=UserProfileResponse)
async def get_my_profile(db: DbSession, principal: ReadPrincipal) -> UserProfileResponse:
    profile = await service.get_profile_by_principal(db, principal)
    return UserProfileResponse.model_validate(profile)


@router.get("/api/people/{user_profile_id}", response_model=UserProfileResponse)
async def get_profile(
    user_profile_id: int, db: DbSession, principal: ReadPrincipal
) -> UserProfileResponse:
    profile = await service.get_profile(db, user_profile_id)
    return UserProfileResponse.model_validate(profile)


@router.get("/api/people/by-party/{party_id}", response_model=UserProfileResponse)
async def get_profile_by_party(
    party_id: int, db: DbSession, principal: ReadPrincipal
) -> UserProfileResponse:
    profile = await service.get_profile_by_party(db, party_id)
    return UserProfileResponse.model_validate(profile)


@router.get("/api/people/{user_profile_id}/leaderships", response_model=list[LeadershipResponse])
async def list_leaderships_for_person(
    user_profile_id: int, db: DbSession, principal: ReadPrincipal
) -> list[LeadershipResponse]:
    profile = await service.get_profile(db, user_profile_id)
    leaderships = await list_active_leaderships_for_party(db, profile.party_id)
    rows = await build_leadership_responses(db, leaderships)
    return [LeadershipResponse(**row) for row in rows]
