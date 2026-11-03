"""Anti-corruption layer over `app.organizations`: the ONLY `app.messaging`
module that imports the organizations vertical. Must not import
`..schemas` (cycle)."""

from __future__ import annotations

import uuid
from collections.abc import Collection

from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.domain.organizer_slug import derive_party_slug
from app.organizations.service import get_own_organizations_by_party_ids

__all__ = ["list_party_slugs"]


async def list_party_slugs(
    db: AsyncSession, party_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Each party's public-URL prefix: its own Organization slug, else its
    party id (`derive_party_slug`), in one statement."""
    organizations = await get_own_organizations_by_party_ids(db, party_ids)
    return {
        party_id: derive_party_slug(
            party_id, organizations[party_id].slug if party_id in organizations else None
        )
        for party_id in party_ids
    }
