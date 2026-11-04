"""`app.locations` business logic. Ownership (only the owning party may edit
or delete a place) is enforced here, not by the coarse
`AUTHORIZATION_MATRIX`, per `standards/backend/security.md`: a missing or
soft-deleted row is 404 first, then a foreign row is 403.

`Location.locality` is `lazy="raise"`: every row handed to a response comes
from `load_location`/`load_locations_by_ids` (also used by the three
`locations_acl.py` modules), including the re-read after a write."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from datetime import datetime
from decimal import Decimal
from typing import cast

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import contains_eager, joinedload

from app.core.errors import AccessDeniedException, EntityNotFoundException

from .models import Locality, Location
from .schemas import LocationRequest


def _coordinate(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


def _select_with_locality() -> Select[tuple[Location]]:
    """`populate_existing` so a row already in the session (e.g. after a PUT
    changed `locality_id`) is refreshed together with its new locality."""
    return (
        select(Location)
        .options(joinedload(Location.locality))
        .execution_options(populate_existing=True)
    )


async def load_location(db: AsyncSession, location_id: uuid.UUID) -> Location | None:
    """A place with its locality, soft-deleted rows included."""
    result = await db.scalars(_select_with_locality().where(Location.id == location_id))
    return result.one_or_none()


async def load_locations_by_ids(
    db: AsyncSession, ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, Location]:
    """One `IN` query with the localities joined; soft-deleted rows included
    so existing references still render."""
    if not ids:
        return {}
    rows = await db.scalars(_select_with_locality().where(Location.id.in_(set(ids))))
    return {cast(uuid.UUID, location.id): location for location in rows}


async def list_my_locations(db: AsyncSession, owner_party_id: uuid.UUID) -> list[Location]:
    result = await db.scalars(
        select(Location)
        .join(Location.locality)
        .options(contains_eager(Location.locality))
        .where(Location.owner_party_id == owner_party_id, Location.deleted_at.is_(None))
        .order_by(Locality.name, Location.created_at)
    )
    return list(result)


async def _require_locality(db: AsyncSession, locality_id: str) -> None:
    if await db.get(Locality, locality_id) is None:
        raise EntityNotFoundException("Locality", locality_id)


def _apply(location: Location, data: LocationRequest) -> None:
    location.locality_id = data.locality_id
    location.formatted_address = data.formatted_address
    location.source = data.source
    location.google_place_id = data.google_place_id
    location.lat = _coordinate(data.lat)
    location.lng = _coordinate(data.lng)


async def _reload(db: AsyncSession, location_id: uuid.UUID) -> Location:
    """The row just written, re-read with its (possibly new) locality."""
    return cast(Location, await load_location(db, location_id))


async def create_location(
    db: AsyncSession, owner_party_id: uuid.UUID, data: LocationRequest
) -> Location:
    """Always a new row (no dedup); 404 for an unknown locality."""
    await _require_locality(db, data.locality_id)
    location = Location(owner_party_id=owner_party_id)
    _apply(location, data)
    db.add(location)
    await db.commit()
    return await _reload(db, cast(uuid.UUID, location.id))


async def get_own_location(
    db: AsyncSession, location_id: uuid.UUID, owner_party_id: uuid.UUID
) -> Location:
    """Loads the row including soft-deleted ones so a deleted place is a 404
    (never a 403), then checks ownership."""
    location = await load_location(db, location_id)
    if location is None or location.deleted_at is not None:
        raise EntityNotFoundException("Location", location_id)
    if location.owner_party_id != owner_party_id:
        raise AccessDeniedException("You do not own this Location")
    return location


async def update_location(
    db: AsyncSession,
    location_id: uuid.UUID,
    owner_party_id: uuid.UUID,
    data: LocationRequest,
) -> Location:
    """A `PUT`: replaces the locality and the whole address."""
    location = await get_own_location(db, location_id, owner_party_id)
    await _require_locality(db, data.locality_id)
    _apply(location, data)
    await db.commit()
    return await _reload(db, location_id)


async def soft_delete_location(
    db: AsyncSession, location_id: uuid.UUID, owner_party_id: uuid.UUID
) -> None:
    location = await get_own_location(db, location_id, owner_party_id)
    location.deleted_at = datetime.utcnow()
    await db.commit()
