"""Anti-corruption layer over `app.locations`: the ONLY `app.inventory`
module that imports the locations vertical. An InventoryItem keeps a plain
`location_id` FK column; this module validates a newly assigned id against
the caller's own saved places (`get_owned_location`, the locations
service's 404-then-403 ownership check)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.locations.schemas import LocationRefResponse
from app.locations.service import get_own_location

__all__ = [
    "LocationRefResponse",
    "get_owned_location",
]


async def get_owned_location(
    db: AsyncSession, location_id: uuid.UUID, owner_party_id: uuid.UUID
) -> LocationRefResponse:
    """404 for an unknown or soft-deleted id, 403 for another owner's; the
    row comes from `load_location`, locality included."""
    return LocationRefResponse.model_validate(
        await get_own_location(db, location_id, owner_party_id)
    )
