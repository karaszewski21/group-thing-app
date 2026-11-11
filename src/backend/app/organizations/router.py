"""`/api/organizations` routes."""

from __future__ import annotations

import uuid
from typing import Annotated, cast

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.db import get_db
from app.media import service as media
from app.media.models import MediaKind
from app.media.schemas import OwnerMediaResponse, ReorderMediaRequest
from app.storage.images import MAX_UPLOAD_BYTES
from app.storage.service import ObjectStorage, get_storage
from app.users.models import UserProfile
from app.users.service import get_profile_by_principal

from . import service
from .models import Organization
from .schemas import (
    CreateOwnOrganizationRequest,
    MyOrganizationResponse,
    OrganizationResponse,
    PublicOrganizationResponse,
    UpdateOrganizationRequest,
)

router = APIRouter(tags=["organizations"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


async def _require_owned(
    db: AsyncSession, principal: Principal, organization_id: uuid.UUID
) -> tuple[Organization, UserProfile]:
    """404 for an unknown Organization before 403 for someone else's."""
    profile = await get_profile_by_principal(db, principal)
    organization = await service.get_organization(db, organization_id)
    own = await service.get_own_organization(db, profile.party_id)
    if own is None or own.id != organization.id:
        raise AccessDeniedException("You do not own this Organization")
    return organization, profile


@router.get("/api/public/organizations/{slug}", response_model=PublicOrganizationResponse)
async def get_public_organization(
    slug: str, db: DbSession, storage: Storage
) -> PublicOrganizationResponse:
    """Unauthenticated — this is the page a shared `domena.pl/<slug>` link
    resolves to, per `AUTHORIZATION_MATRIX` row 48 (PUBLIC, declared ahead
    of the blanket `/api/organizations` READ row). Without configured
    storage the page renders with no media."""
    organization = await service.get_organization_by_slug(db, slug)
    if organization is None:
        raise EntityNotFoundException("Organization", slug)
    response = PublicOrganizationResponse.model_validate(organization)
    public_media = await media.load_public_media(db, storage, organization.party_id)
    return response.model_copy(update=dict(public_media))


@router.get("/api/organizations/mine", response_model=MyOrganizationResponse)
async def get_my_organization(
    db: DbSession, principal: ReadPrincipal, storage: Storage
) -> MyOrganizationResponse:
    profile = await get_profile_by_principal(db, principal)
    organization = await service.get_own_organization(db, profile.party_id)
    if organization is None:
        raise EntityNotFoundException("Organization", profile.party_id)
    owner_media = (
        [] if storage is None else await media.load_owner_media(db, storage, organization.party_id)
    )
    return MyOrganizationResponse(
        **OrganizationResponse.model_validate(organization).model_dump(), media=owner_media
    )


@router.post(
    "/api/organizations/mine",
    response_model=OrganizationResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_my_organization(
    body: CreateOwnOrganizationRequest, db: DbSession, principal: EditPrincipal, storage: Storage
) -> OrganizationResponse:
    profile = await get_profile_by_principal(db, principal)
    organization = await service.create_own_organization(
        db, profile.party_id, body, storage, profile.account_user_id
    )
    return OrganizationResponse.model_validate(organization)


@router.patch("/api/organizations/{organization_id}", response_model=OrganizationResponse)
async def update_organization(
    organization_id: uuid.UUID,
    body: UpdateOrganizationRequest,
    db: DbSession,
    principal: EditPrincipal,
) -> OrganizationResponse:
    profile = await get_profile_by_principal(db, principal)
    organization = await service.update_organization(db, organization_id, profile.party_id, body)
    return OrganizationResponse.model_validate(organization)


@router.post(
    "/api/organizations/{organization_id}/media",
    response_model=OwnerMediaResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_organization_media(
    organization_id: uuid.UUID,
    kind: MediaKind,
    db: DbSession,
    principal: EditPrincipal,
    storage: Storage,
    file: Annotated[UploadFile, File()],
) -> OwnerMediaResponse:
    """Multipart upload (`file`) of the avatar, the cover or a gallery photo.
    Reads at most one byte past the limit, so an oversized upload is refused
    without buffering it all."""
    organization, profile = await _require_owned(db, principal, organization_id)
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    return await media.upload_media(
        db,
        storage,
        organization.party_id,
        cast(uuid.UUID, profile.account_user_id),
        kind,
        data,
    )


@router.patch(
    "/api/organizations/{organization_id}/media/order", response_model=list[OwnerMediaResponse]
)
async def reorder_organization_media(
    organization_id: uuid.UUID,
    body: ReorderMediaRequest,
    db: DbSession,
    principal: EditPrincipal,
    storage: Storage,
) -> list[OwnerMediaResponse]:
    organization, _ = await _require_owned(db, principal, organization_id)
    return await media.reorder_gallery(db, storage, organization.party_id, body.media_ids)


@router.delete(
    "/api/organizations/{organization_id}/media/{media_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_organization_media(
    organization_id: uuid.UUID, media_id: uuid.UUID, db: DbSession, principal: EditPrincipal
) -> None:
    organization, _ = await _require_owned(db, principal, organization_id)
    await media.delete_media(db, organization.party_id, media_id)
