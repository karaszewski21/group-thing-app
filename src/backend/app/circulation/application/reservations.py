"""`Reservation` creation use cases + the driven `InventoryBalance`
field-mutation cascades (kept inline per D2 — the pure state machine
extraction is deferred)."""

from __future__ import annotations

from datetime import datetime
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.inventory_items import get_item, get_item_balance
from app.circulation.infrastructure import repository
from app.circulation.models import (
    BalanceStatus,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.circulation.schemas import CreateReservationRequest, CreateSwapRequest
from app.core.errors import BusinessConflictException, EntityNotFoundException


async def create_reservation(db: AsyncSession, data: CreateReservationRequest) -> Reservation:
    item = await get_item(db, data.item_id)
    balance = await get_item_balance(db, cast(int, item.id))
    # RETURN is the one type that starts from LENT (giving back an item
    # currently on loan); every other type starts from AVAILABLE.
    required_status = (
        BalanceStatus.LENT
        if data.reservation_type == ReservationType.RETURN
        else BalanceStatus.AVAILABLE
    )
    if balance.status != required_status:
        raise BusinessConflictException(
            f"InventoryItem {item.id} is not eligible for a {data.reservation_type} reservation "
            f"(status={balance.status})"
        )

    reservation = Reservation(
        item_id=item.id,
        reservation_type=data.reservation_type,
        reserved_by_user_id=data.reserved_by_user_id,
        reserved_at=datetime.utcnow(),
        expires_at=data.expires_at,
        status=ReservationStatus.PENDING,
        notes=data.notes,
    )
    db.add(reservation)

    balance.status = BalanceStatus.RESERVED
    balance.reserved_at = datetime.utcnow()
    balance.due_date = data.expires_at

    await db.commit()
    await db.refresh(reservation)
    return reservation


async def create_lend_reservation(
    db: AsyncSession, *, item_id: int, reserved_by_user_id: int
) -> Reservation:
    """Used by `app.party`'s Pledge->Reservation bridge."""
    return await create_reservation(
        db,
        CreateReservationRequest(
            item_id=item_id,
            reservation_type=ReservationType.LEND,
            reserved_by_user_id=reserved_by_user_id,
        ),
    )


async def create_swap(db: AsyncSession, data: CreateSwapRequest) -> tuple[Reservation, Reservation]:
    first_item = await get_item(db, data.first_item_id)
    second_item = await get_item(db, data.second_item_id)
    first_balance = await get_item_balance(db, cast(int, first_item.id))
    second_balance = await get_item_balance(db, cast(int, second_item.id))
    if (
        first_balance.status != BalanceStatus.AVAILABLE
        or second_balance.status != BalanceStatus.AVAILABLE
    ):
        raise BusinessConflictException("Both swap items must be AVAILABLE")

    now = datetime.utcnow()
    first = Reservation(
        item_id=first_item.id,
        reservation_type=ReservationType.SWAP,
        reserved_by_user_id=data.first_reserved_by_user_id,
        reserved_at=now,
        expires_at=data.expires_at,
        status=ReservationStatus.PENDING,
    )
    second = Reservation(
        item_id=second_item.id,
        reservation_type=ReservationType.SWAP,
        reserved_by_user_id=data.second_reserved_by_user_id,
        reserved_at=now,
        expires_at=data.expires_at,
        status=ReservationStatus.PENDING,
    )
    db.add_all([first, second])
    await db.flush()
    first.paired_reservation_id = second.id
    second.paired_reservation_id = first.id

    first_balance.status = BalanceStatus.RESERVED
    first_balance.reserved_at = now
    second_balance.status = BalanceStatus.RESERVED
    second_balance.reserved_at = now

    await db.commit()
    await db.refresh(first)
    await db.refresh(second)
    return first, second


async def get_reservation(db: AsyncSession, reservation_id: int) -> Reservation:
    reservation = await repository.get_reservation(db, reservation_id)
    if reservation is None:
        raise EntityNotFoundException("Reservation", reservation_id)
    return reservation


async def list_reservations(db: AsyncSession, item_id: int) -> list[Reservation]:
    return await repository.list_reservations_for_item(db, item_id)
