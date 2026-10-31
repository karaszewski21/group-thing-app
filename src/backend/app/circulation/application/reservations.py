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
    ReservationType,
)
from app.core.errors import BusinessConflictException, EntityNotFoundException


async def _current_holder_user_id(db: AsyncSession, item: InventoryItem) -> uuid.UUID:
    """Who currently physically holds this item — the party a fulfillment
    credits and a new reservation records as `giver_user_id`.
    `item.inventory_id` always reflects the current physical location (the
    owner's PERSONAL inventory, including post-`SWAP`/`GIFT`), so the holder
    is simply that inventory's owner."""
    inventory = await get_inventory(db, item.inventory_id)
    return inventory.owner_user_id


async def create_reservation(
    db: AsyncSession,
    *,
    item_id: uuid.UUID,
    reservation_type: ReservationType,
    reserved_by_user_id: uuid.UUID,
    term_id: uuid.UUID | None = None,
    event_id: uuid.UUID | None = None,
    expires_at: datetime | None = None,
    notes: str | None = None,
    commit: bool = True,
) -> Reservation:
    """A PENDING reservation of an AVAILABLE item in exactly one context, a
    Term or an Event. Commits, or with `commit=False` only flushes so the
    caller's row locks hold until its own commit."""
    if (term_id is None) == (event_id is None):
        raise ValueError("A reservation needs exactly one context: term_id or event_id")
    item = await get_item(db, item_id)
    balance = await get_item_balance(db, cast(uuid.UUID, item.id))
    if balance.status != BalanceStatus.AVAILABLE:
        raise BusinessConflictException(
            f"InventoryItem {item.id} is not eligible for a {reservation_type} reservation "
            f"(status={balance.status})"
        )

    reservation = Reservation(
        item_id=item.id,
        reservation_type=reservation_type,
        reserved_by_user_id=reserved_by_user_id,
        giver_user_id=await _current_holder_user_id(db, item),
        term_id=term_id,
        event_id=event_id,
        reserved_at=datetime.utcnow(),
        expires_at=expires_at,
        status=ReservationStatus.PENDING,
        notes=notes,
    )
    db.add(reservation)

    balance.status = BalanceStatus.RESERVED
    balance.reserved_at = datetime.utcnow()
    balance.due_date = expires_at

    if not commit:
        await db.flush()
        return reservation
    await db.commit()
    await db.refresh(reservation)
    return reservation


async def get_reservation(db: AsyncSession, reservation_id: uuid.UUID) -> Reservation:
    reservation = await repository.get_reservation(db, reservation_id)
    if reservation is None:
        raise EntityNotFoundException("Reservation", reservation_id)
    return reservation


async def find_reservation_context_occurs_on(
    db: AsyncSession, reservation: Reservation
) -> datetime | None:
    """The Term's `occurs_on` or the Event's `starts_at`; `None` once the
    reservation has no context (its Event was deleted)."""
    term = await repository.find_reservation_term(db, reservation.term_id)
    if term is not None:
        return term.occurs_on
    event = await repository.find_reservation_event(db, reservation.event_id)
    return event.starts_at if event is not None else None


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


async def list_active_hand_over_reservations_for_events(
    db: AsyncSession, event_ids: list[uuid.UUID]
) -> list[Reservation]:
    """Thin wrapper, same shape as `list_reservations` above."""
    return await repository.list_active_hand_over_reservations_for_events(db, event_ids)


async def list_open_reservations_for_event(
    db: AsyncSession, event_id: uuid.UUID
) -> list[Reservation]:
    """Thin wrapper, same shape as `list_reservations` above."""
    return await repository.list_open_reservations_for_event(db, event_id)
