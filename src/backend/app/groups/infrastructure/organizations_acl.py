"""Anti-corruption layer over `app.organizations`: the ONLY `app.groups`
module that imports the organizations vertical. Used by `slug_resolver`
and `application/public_view` to resolve a Circle organizer's owned
`Organization` without a cross-boundary model or ORM relationship."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.organizations import service as organizations_service
from app.organizations.models import Organization

__all__ = ["get_own_organization"]


async def get_own_organization(db: AsyncSession, party_id: int) -> Organization | None:
    return await organizations_service.get_own_organization(db, party_id)
