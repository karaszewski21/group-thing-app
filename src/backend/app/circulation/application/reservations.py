"""`Reservation` creation use cases + the driven `InventoryBalance`
field-mutation cascades (kept inline per D2 — the pure state machine
extraction is deferred)."""

from __future__ import annotations

import uuid

from datetime import datetime
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.inventory import get_inventory
from app.circulation.application.inventory_items import get_item, get_item_balance
from app.circulation.infrastructure import repository
from app.circulation.models import (
    BalanceStatus,
    InventoryItem,
    Reservation,
    ReservationStatus,
)
from app.circulation.schemas import CreateReservationRequest
from app.core.errors import BusinessConflictException, EntityNotFoundException


async def _current_holder_user_id(db: AsyncSession, item: InventoryItem) -> uuid.UUID:
    """Who currently physically holds this item — the party a fulfillment
    credits and a new reservation records as `giver_user_id`.
    `item.inventory_id` always reflects the current physical location (the
    owner's PERSONAL inventory, including post-`SWAP`/`GIFT`), so the holder
    is simply that inventory's owner."""
    inventory = await get_inventory(db, item.inventory_id)
    return inventory.owner_user_id


async def create_reservation(db: AsyncSession, data: CreateReservationRequest) -> Reservation:
    item = await get_item(db, data.item_id)
    balance = await get_item_balance(db, cast(uuid.UUID, item.id))
    if balance.status != BalanceStatus.AVAILABLE:
        raise BusinessConflictException(
            f"InventoryItem {item.id} is not eligible for a {data.reservation_type} reservation "
            f"(status={balance.status})"
        )

    reservation = Reservation(
        item_id=item.id,
        reservation_type=data.reservation_type,
        reserved_by_user_id=data.reserved_by_user_id,
        giver_user_id=await _current_holder_user_id(db, item),
        term_id=data.term_id,
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


async def get_reservation(db: AsyncSession, reservation_id: uuid.UUID) -> Reservation:
    reservation = await repository.get_reservation(db, reservation_id)
    if reservation is None:
        raise EntityNotFoundException("Reservation", reservation_id)
    return reservation


async def find_reservation_term_occurs_on(db: AsyncSession, term_id: uuid.UUID) -> datetime | None:
    term = await repository.find_reservation_term(db, term_id)
    return term.occurs_on if term is not None else None


async def list_reservations(db: AsyncSession, item_id: uuid.UUID) -> list[Reservation]:
    return await repository.list_reservations_for_item(db, item_id)


async def list_active_reservations_for_taker(
    db: AsyncSession, account_user_id: uuid.UUID
) -> list[Reservation]:
    """Thin wrapper, same shape as `list_reservations` above."""
    return await repository.list_active_reservations_for_taker(db, account_user_id)


async def list_active_hand_over_reservations_for_terms(
    db: AsyncSession, term_ids: list[uuid.UUID]
) -> list[Reservation]:
    """Thin wrapper, same shape as `list_reservations` above."""
    return await repository.list_active_hand_over_reservations_for_terms(db, term_ids)
