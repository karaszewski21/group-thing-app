"""Anti-corruption layer over `app.locations`: the ONLY `app.circulation`
module that imports the locations vertical. An Inventory keeps a plain
`location_id` FK column; this module validates a newly assigned id against
the caller's own saved places (`get_owned_location`, the locations
service's 404-then-403 ownership check) and loads the referenced row for
responses. It re-exports `LocationRefResponse` for `app.circulation.schemas`
and so must not import `..schemas` itself (cycle)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.locations.models import Location
from app.locations.schemas import LocationRefResponse
from app.locations.service import get_own_location

__all__ = [
    "LocationRefResponse",
    "get_location_ref",
    "get_owned_location",
]


async def get_owned_location(
    db: AsyncSession, location_id: uuid.UUID, owner_party_id: uuid.UUID
) -> LocationRefResponse:
    """404 for an unknown or soft-deleted id, 403 for another owner's."""
    return LocationRefResponse.model_validate(
        await get_own_location(db, location_id, owner_party_id)
    )


async def get_location_ref(
    db: AsyncSession, location_id: uuid.UUID | None
) -> LocationRefResponse | None:
    """A referenced place, soft-deleted rows included so it still renders."""
    location = None if location_id is None else await db.get(Location, location_id)
    return None if location is None else LocationRefResponse.model_validate(location)
