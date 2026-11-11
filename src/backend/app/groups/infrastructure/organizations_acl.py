"""Anti-corruption layer over `app.organizations`: the ONLY `app.groups`
module that imports the organizations vertical. Used by `slug_resolver`
and `application/public_view` to resolve a Circle organizer's owned
`Organization`, without a cross-boundary model or ORM relationship."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.organizations import service as organizations_service
from app.organizations.models import Organization

from ..schemas import PublicCircleOrganization

__all__ = [
    "Organization",
    "get_own_organization",
    "public_organization",
]


async def get_own_organization(db: AsyncSession, party_id: uuid.UUID) -> Organization | None:
    return await organizations_service.get_own_organization(db, party_id)


def public_organization(organization: Organization | None) -> PublicCircleOrganization | None:
    if organization is None:
        return None
    return PublicCircleOrganization(
        name=organization.name,
        primary_color=organization.primary_color,
        accent_color=organization.accent_color,
        palette_preset=organization.palette_preset,
    )
