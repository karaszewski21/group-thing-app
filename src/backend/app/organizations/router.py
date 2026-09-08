"""`/api/organizations` routes."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal, require_any
from app.core.errors import EntityNotFoundException
from app.db import get_db
from app.users.service import get_profile_by_principal

from . import service
from .schemas import (
    CreateOwnOrganizationRequest,
    OrganizationResponse,
    PublicOrganizationResponse,
    UpdateOrganizationRequest,
)

router = APIRouter(tags=["organizations"])

DbSession = Annotated[AsyncSession, Depends(get_db)]
ReadPrincipal = Annotated[Principal, Depends(require_any("READ", "mcp:read"))]
EditPrincipal = Annotated[Principal, Depends(require_any("EDIT", "mcp:edit"))]


@router.get("/api/organizations/public/{slug}", response_model=PublicOrganizationResponse)
async def get_public_organization(slug: str, db: DbSession) -> PublicOrganizationResponse:
    """Unauthenticated — this is the page a shared `domena.pl/<slug>` link
    resolves to, per `AUTHORIZATION_MATRIX` row 48 (PUBLIC, declared ahead
    of the blanket `/api/organizations` READ row)."""
    organization = await service.get_organization_by_slug(db, slug)
    if organization is None:
        raise EntityNotFoundException("Organization", slug)
    return PublicOrganizationResponse.model_validate(organization)


@router.get("/api/organizations/mine", response_model=OrganizationResponse)
async def get_my_organization(db: DbSession, principal: ReadPrincipal) -> OrganizationResponse:
    profile = await get_profile_by_principal(db, principal)
    organization = await service.get_own_organization(db, profile.party_id)
    if organization is None:
        raise EntityNotFoundException("Organization", profile.party_id)
    return OrganizationResponse.model_validate(organization)


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
    organization_id: int, body: UpdateOrganizationRequest, db: DbSession, principal: EditPrincipal
) -> OrganizationResponse:
    profile = await get_profile_by_principal(db, principal)
    organization = await service.update_organization(
        db, organization_id, profile.party_id, body
    )
    return OrganizationResponse.model_validate(organization)
