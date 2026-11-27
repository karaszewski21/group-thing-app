"""Anti-corruption layer over `app.points`: the ONLY `app.groups` module
that imports the points context. A confirmed exchange and a closed
attendance list earn their awards in the caller's commit; points only
flushes."""

from __future__ import annotations

import uuid
from collections.abc import Collection, Sequence
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.points import service as points_service

from .inventory_bridge import Reservation

AttendanceRules = points_service.AttendanceRules
PriceBounds = points_service.PriceBounds
Purchase = points_service.Purchase
is_valid_price = points_service.is_valid_price
clamp_price = points_service.clamp_price


async def lock_purchase(
    db: AsyncSession, buyer_party_id: uuid.UUID, seller_party_id: uuid.UUID, price: int
) -> Purchase:
    """A POINTS take's checks (eligibility, family, pair limit incl. open
    holds, balance) under the buyer's and the seller's account locks; each
    refusal is a 409."""
    return await points_service.lock_purchase(db, buyer_party_id, seller_party_id, price)


async def post_hold(
    db: AsyncSession, purchase: Purchase, reservation_id: uuid.UUID, product_name: str
) -> None:
    """HOLD: the price moves from the buyer's PARTY to their HELD account."""
    await points_service.post_hold(db, purchase, reservation_id, product_name)


async def hold_amounts(
    db: AsyncSession, reservation_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """`{reservation_id: held points}` of the POINTS reservations among
    `reservation_ids`, one query (none for an empty input)."""
    return await points_service.hold_amounts(db, reservation_ids)


async def lock_owner_accounts(db: AsyncSession, party_id: uuid.UUID) -> None:
    """Locks exactly the owner's `(party, PARTY)` account: the mutex of the
    `max_points_offers` count, taken before the item row lock."""
    await points_service.lock_owner_accounts(db, party_id)


async def price_bounds(db: AsyncSession, points_value: int) -> PriceBounds:
    """The POINTS price range around the item's STORED `points_value`, the
    same bounds `GET /api/points/item-value?item_id=` serves."""
    return await points_service.bounds_for(db, points_value)


async def max_points_offers(db: AsyncSession) -> int:
    """How many POINTS listings one owner may hold."""
    return await points_service.max_points_offers(db)


async def attendance_rules(db: AsyncSession) -> AttendanceRules:
    """The allowed term levels, the close minimum and the auto-close delay,
    read fresh from the points config."""
    return await points_service.attendance_rules(db)


async def award_exchange(db: AsyncSession, reservations: Sequence[Reservation]) -> None:
    """`reservations` are the legs about to be fulfilled: one GIFT, one
    POINTS (settled as SALE), or both legs of a SWAP."""
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
