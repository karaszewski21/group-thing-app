"""Anti-corruption layer over `app.organizations`: the ONLY `app.groups`
module that imports the organizations vertical. Used by `slug_resolver`
and `application/public_view` to resolve a Circle organizer's owned
`Organization`, and by the organizer page to go the other way (slug ->
Organization -> owner party), without a cross-boundary model or ORM
relationship."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.organizations import service as organizations_service
from app.organizations.models import Organization

from ..schemas import PublicCircleOrganization

__all__ = [
    "get_organization_by_slug",
    "get_own_organization",
    "get_owner_party_id",
    "public_organization",
]


async def get_own_organization(db: AsyncSession, party_id: uuid.UUID) -> Organization | None:
    return await organizations_service.get_own_organization(db, party_id)


async def get_organization_by_slug(db: AsyncSession, slug: str) -> Organization | None:
    return await organizations_service.get_organization_by_slug(db, slug)


async def get_owner_party_id(db: AsyncSession, organization_id: uuid.UUID) -> uuid.UUID | None:
    return await organizations_service.get_owner_party_id(db, organization_id)


def public_organization(organization: Organization | None) -> PublicCircleOrganization | None:
    if organization is None:
        return None
    return PublicCircleOrganization(
        name=organization.name,
        primary_color=organization.primary_color,
        accent_color=organization.accent_color,
        palette_preset=organization.palette_preset,
    )
