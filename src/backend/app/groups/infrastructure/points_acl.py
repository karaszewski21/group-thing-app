"""Anti-corruption layer over `app.points`: the ONLY `app.groups` module
that imports the points context. A confirmed exchange and a closed
attendance list earn their awards in the caller's commit; points only
flushes."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.points import service as points_service

from .inventory_bridge import Reservation

AttendanceRules = points_service.AttendanceRules


async def attendance_rules(db: AsyncSession) -> AttendanceRules:
    """The allowed term levels, the close minimum and the auto-close delay,
    read fresh from the points config."""
    return await points_service.attendance_rules(db)


async def award_exchange(db: AsyncSession, reservations: Sequence[Reservation]) -> None:
    """`reservations` are the legs about to be fulfilled: one GIFT, or both
    legs of a SWAP."""
    await points_service.award_exchange(
        db,
        [
            points_service.ExchangeLeg(
                reservation_id=cast(uuid.UUID, r.id),
                created_at=r.created_at,
                reservation_type=r.reservation_type.value,
                item_id=r.item_id,
                giver_user_id=r.giver_user_id,
                recipient_user_id=r.reserved_by_user_id,
            )
            for r in reservations
        ],
    )


async def award_attendance(
    db: AsyncSession,
    group_name: str,
    level: int,
    attendees: Sequence[tuple[uuid.UUID, uuid.UUID]],
) -> int:
    """`attendees` are the `(attendance_id, party_id)` rows counted present
    at close; returns how many ATTENDANCE awards were posted."""
    return await points_service.award_attendance(db, group_name, level, attendees)
