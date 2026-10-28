"""Anti-corruption layer over `app.locations`: the ONLY `app.events` module
that imports the locations vertical. An Event keeps a plain `location_id` FK
column; this module validates a newly assigned id against the caller's own
saved places (`get_owned_location`, the locations service's 404-then-403
ownership check) and loads the referenced row for responses. It re-exports
`LocationRefResponse` for `app.events.schemas` and so must not import
`..schemas` itself (cycle)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.locations.models import Location
from app.locations.schemas import LocationRefResponse
from app.locations.service import get_own_location as get_owned_location

__all__ = [
    "LocationRefResponse",
    "get_location",
    "get_owned_location",
    "location_ref_response",
]


async def get_location(db: AsyncSession, location_id: uuid.UUID | None) -> Location | None:
    """A single referenced place, soft-deleted rows included."""
    return None if location_id is None else await db.get(Location, location_id)


def location_ref_response(location: Location | None) -> LocationRefResponse | None:
    return None if location is None else LocationRefResponse.model_validate(location)
