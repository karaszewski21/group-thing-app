"""`/api/auth/register` and `/api/people` routes."""

from __future__ import annotations

import uuid
from typing import Annotated, cast

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.auth_deps import Principal, require_any
from app.core.security import encode_login_token
from app.db import get_db
from app.groups.schemas import LeadershipResponse
from app.groups.service import build_leadership_responses, list_active_leaderships_for_party
from app.product.images import MAX_UPLOAD_BYTES
from app.storage.service import ObjectStorage, get_storage

from . import service
from .models import UserProfile
from .schemas import (
    AvatarResponse,
    RegisterRequest,
    RegisterResponse,
    UpdateMyProfileRequest,
    UserProfileResponse,
)

router = APIRouter(tags=["users"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


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


async def _to_profile_response(db: DbSession, profile: UserProfile) -> UserProfileResponse:
    response = UserProfileResponse.model_validate(profile)
    response.is_organizer = await service.is_active_organizer(db, profile.party_id)
    return response


async def _to_my_profile_response(
    db: DbSession, profile: UserProfile, storage: ObjectStorage | None
) -> UserProfileResponse:
    """The caller's own profile, with their avatar in any moderation status."""
    response = await _to_profile_response(db, profile)
    avatar = await service.get_avatar(db, cast(uuid.UUID, profile.id))
    if avatar is not None and storage is not None:
        response.avatar = service.avatar_response(avatar, storage)
    return response


@router.get("/api/people/me", response_model=UserProfileResponse)
async def get_my_profile(
    db: DbSession, principal: ReadPrincipal, storage: Storage
) -> UserProfileResponse:
    profile = await service.get_profile_by_principal(db, principal)
    return await _to_my_profile_response(db, profile, storage)


@router.patch("/api/people/me", response_model=UserProfileResponse)
async def update_my_profile(
    body: UpdateMyProfileRequest, db: DbSession, principal: EditPrincipal, storage: Storage
) -> UserProfileResponse:
    profile = await service.update_my_profile(db, principal, body)
    return await _to_my_profile_response(db, profile, storage)


@router.post("/api/people/me/avatar", response_model=AvatarResponse)
async def set_my_avatar(
    db: DbSession,
    principal: EditPrincipal,
    storage: Storage,
    file: Annotated[UploadFile, File()],
) -> AvatarResponse:
    """Multipart upload of one image (`file`), replacing the caller's avatar.
    Reads at most one byte past the limit, like product photo uploads."""
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    avatar = await service.set_my_avatar(db, principal, data, storage)
    assert storage is not None  # `set_my_avatar` refuses the upload otherwise
    return service.avatar_response(avatar, storage)


@router.delete("/api/people/me/avatar", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
async def remove_my_avatar(db: DbSession, principal: EditPrincipal) -> None:
    await service.remove_my_avatar(db, principal)


@router.get("/api/people/{user_profile_id}", response_model=UserProfileResponse)
async def get_profile(
    user_profile_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> UserProfileResponse:
    profile = await service.get_profile(db, user_profile_id)
    return await _to_profile_response(db, profile)


@router.get("/api/people/by-party/{party_id}", response_model=UserProfileResponse)
async def get_profile_by_party(
    party_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> UserProfileResponse:
    profile = await service.get_profile_by_party(db, party_id)
    return await _to_profile_response(db, profile)


@router.get("/api/people/by-account-user-id/{account_user_id}", response_model=UserProfileResponse)
async def get_profile_by_account_user_id(
    account_user_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> UserProfileResponse:
    """Resolves a raw `app.circulation` `users.id` (e.g. an `Inventory.
    owner_user_id`) back to its display profile — used by the "Wypożyczone"
    panel view to show who a borrowed item's lender is."""
    profile = await service.get_profile_by_account_user_id(db, account_user_id)
    return await _to_profile_response(db, profile)


@router.get("/api/people/{user_profile_id}/leaderships", response_model=list[LeadershipResponse])
async def list_leaderships_for_person(
    user_profile_id: uuid.UUID, db: DbSession, principal: ReadPrincipal
) -> list[LeadershipResponse]:
    profile = await service.get_profile(db, user_profile_id)
    leaderships = await list_active_leaderships_for_party(db, profile.party_id)
    rows = await build_leadership_responses(db, leaderships)
    return [LeadershipResponse(**row) for row in rows]
