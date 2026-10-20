"""Anti-corruption layer over `app.locations`: the ONLY `app.groups` module
that imports the locations vertical. Circles and Terms keep a plain
`location_id` FK column; this module validates a newly assigned id against
the caller's own saved places (`get_owned_location`, the locations
service's 404-then-403 ownership check) and loads referenced rows for responses.
It re-exports `LocationRefResponse`/`PublicLocationResponse` for
`app.groups.schemas` and so must not import `..schemas` itself (cycle)."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.locations.models import Location
from app.locations.schemas import LocationRefResponse, PublicLocationResponse
from app.locations.service import get_own_location as get_owned_location

__all__ = [
    "LocationRefResponse",
    "PublicLocationResponse",
    "get_location",
    "get_locations_by_ids",
    "get_owned_location",
    "location_ref_response",
    "public_location_response",
]


async def get_location(db: AsyncSession, location_id: uuid.UUID | None) -> Location | None:
    """A single referenced place, soft-deleted rows included."""
    return None if location_id is None else await db.get(Location, location_id)


async def get_locations_by_ids(
    db: AsyncSession, ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, Location]:
    """One `IN` query; soft-deleted rows included so existing references
    still render."""
    if not ids:
        return {}
    rows = await db.scalars(select(Location).where(Location.id.in_(set(ids))))
    return {cast(uuid.UUID, location.id): location for location in rows}


def location_ref_response(location: Location | None) -> LocationRefResponse | None:
    return None if location is None else LocationRefResponse.model_validate(location)


def public_location_response(location: Location | None) -> PublicLocationResponse | None:
    return None if location is None else PublicLocationResponse.model_validate(location)
