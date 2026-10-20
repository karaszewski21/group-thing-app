"""`app.locations` business logic. Ownership (only the owning party may edit
or delete a place) is enforced here, not by the coarse
`AUTHORIZATION_MATRIX`, per `standards/backend/security.md`: a missing or
soft-deleted row is 404 first, then a foreign row is 403."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)

from .models import Location, LocationSource
from .schemas import CreateLocationRequest, UpdateLocationRequest


class GoogleAddressNotEditable(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__("The address of a Google Maps place cannot be edited")


def _coordinate(value: float | None) -> Decimal | None:
    return None if value is None else Decimal(str(value))


async def list_my_locations(db: AsyncSession, owner_party_id: uuid.UUID) -> list[Location]:
    result = await db.execute(
        select(Location)
        .where(Location.owner_party_id == owner_party_id, Location.deleted_at.is_(None))
        .order_by(Location.name, Location.created_at)
    )
    return list(result.scalars())


async def _find_active_by_place_id(
    db: AsyncSession, owner_party_id: uuid.UUID, google_place_id: str
) -> Location | None:
    result = await db.execute(
        select(Location).where(
            Location.owner_party_id == owner_party_id,
            Location.google_place_id == google_place_id,
            Location.deleted_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def create_location(
    db: AsyncSession, owner_party_id: uuid.UUID, data: CreateLocationRequest
) -> tuple[Location, bool]:
    """Returns `(location, created)`. A GOOGLE place the owner already has
    as an active row is returned as is (`created=False`) rather than
    duplicated. The check-then-insert race is closed by the partial unique
    index from migration 0057: the loser's insert fails inside a SAVEPOINT
    and the winner's row is re-fetched."""
    place_id = data.google_place_id
    if data.source == LocationSource.GOOGLE and place_id is not None:
        existing = await _find_active_by_place_id(db, owner_party_id, place_id)
        if existing is not None:
            return existing, False

    location = Location(
        owner_party_id=owner_party_id,
        name=data.name,
        formatted_address=data.formatted_address,
        google_place_id=place_id,
        lat=_coordinate(data.lat),
        lng=_coordinate(data.lng),
        notes=data.notes,
        source=data.source,
    )
    try:
        async with db.begin_nested():
            db.add(location)
            await db.flush()
    except IntegrityError:
        if place_id is None:
            raise
        existing = await _find_active_by_place_id(db, owner_party_id, place_id)
        if existing is None:
            raise
        await db.commit()
        return existing, False
    await db.commit()
    await db.refresh(location)
    return location, True


async def get_own_location(
    db: AsyncSession, location_id: uuid.UUID, owner_party_id: uuid.UUID
) -> Location:
    """Loads the row including soft-deleted ones so a deleted place is a 404
    (never a 403), then checks ownership."""
    location = await db.get(Location, location_id)
    if location is None or location.deleted_at is not None:
        raise EntityNotFoundException("Location", location_id)
    if location.owner_party_id != owner_party_id:
        raise AccessDeniedException("You do not own this Location")
    return location


async def update_location(
    db: AsyncSession,
    location_id: uuid.UUID,
    owner_party_id: uuid.UUID,
    data: UpdateLocationRequest,
) -> Location:
    location = await get_own_location(db, location_id, owner_party_id)
    if "formatted_address" in data.model_fields_set and location.source == LocationSource.GOOGLE:
        raise GoogleAddressNotEditable()
    for field in data.model_fields_set:
        setattr(location, field, getattr(data, field))
    await db.commit()
    await db.refresh(location)
    return location


async def soft_delete_location(
    db: AsyncSession, location_id: uuid.UUID, owner_party_id: uuid.UUID
) -> None:
    location = await get_own_location(db, location_id, owner_party_id)
    location.deleted_at = datetime.utcnow()
    await db.commit()
