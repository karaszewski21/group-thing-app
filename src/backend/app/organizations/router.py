"""`/api/organizations` routes."""

from __future__ import annotations

import uuid
from typing import Annotated, cast

from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.core.errors import EntityNotFoundException
from app.db import get_db
from app.storage.images import MAX_UPLOAD_BYTES
from app.storage.service import ObjectStorage, get_storage
from app.users.service import get_profile_by_principal

from . import media, service
from .models import MediaKind
from .schemas import (
    CreateOwnOrganizationRequest,
    MyOrganizationResponse,
    OrganizationResponse,
    OwnerMediaResponse,
    PublicOrganizationResponse,
    ReorderOrganizationMediaRequest,
    UpdateOrganizationRequest,
)

router = APIRouter(tags=["organizations"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]
Storage = Annotated[ObjectStorage | None, Depends(get_storage)]


@router.get("/api/organizations/public/{slug}", response_model=PublicOrganizationResponse)
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
    if storage is None:
        return response
    return response.model_copy(
        update=await media.load_public_media(db, storage, cast(uuid.UUID, organization.id))
    )


@router.get("/api/organizations/mine", response_model=MyOrganizationResponse)
async def get_my_organization(
    db: DbSession, principal: ReadPrincipal, storage: Storage
) -> MyOrganizationResponse:
    profile = await get_profile_by_principal(db, principal)
    organization = await service.get_own_organization(db, profile.party_id)
    if organization is None:
        raise EntityNotFoundException("Organization", profile.party_id)
    owner_media = (
        []
        if storage is None
        else await media.load_owner_media(db, storage, cast(uuid.UUID, organization.id))
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
    body: CreateOwnOrganizationRequest, db: DbSession, principal: EditPrincipal
) -> OrganizationResponse:
    profile = await get_profile_by_principal(db, principal)
    organization = await service.create_own_organization(db, profile.party_id, body)
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
    """Multipart upload (`file`) of the logo, the cover or a gallery photo.
    Reads at most one byte past the limit, so an oversized upload is refused
    without buffering it all."""
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    return await media.upload_media(db, storage, principal, organization_id, kind, data)


@router.patch(
    "/api/organizations/{organization_id}/media/order", response_model=list[OwnerMediaResponse]
)
async def reorder_organization_media(
    organization_id: uuid.UUID,
    body: ReorderOrganizationMediaRequest,
    db: DbSession,
    principal: EditPrincipal,
    storage: Storage,
) -> list[OwnerMediaResponse]:
    return await media.reorder_gallery(db, storage, principal, organization_id, body.media_ids)


@router.delete(
    "/api/organizations/{organization_id}/media/{media_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_model=None,
)
async def delete_organization_media(
    organization_id: uuid.UUID, media_id: uuid.UUID, db: DbSession, principal: EditPrincipal
) -> None:
    await media.delete_media(db, principal, organization_id, media_id)
