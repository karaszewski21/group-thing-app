"""`Reservation` creation use cases + the driven `InventoryBalance`
field-mutation cascades (kept inline per D2 — the pure state machine
extraction is deferred)."""

from __future__ import annotations

import uuid

from datetime import datetime
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.inventory import get_inventory
from app.circulation.application.inventory_items import (
    get_item,
    get_item_balance,
    resolve_owning_inventory,
)
from app.circulation.infrastructure import repository
from app.circulation.models import (
    BalanceStatus,
    InventoryItem,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.circulation.schemas import CreateReservationRequest
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)


async def _resolve_return_term_id(db: AsyncSession, item_id: uuid.UUID) -> uuid.UUID:
    """A RETURN reverses a specific prior LEND, so its `term_id` is derived
    server-side rather than caller-supplied — the one real RETURN call site
    (`PanelDataContext.tsx::returnBorrowedItem`) has no Term context at all.
    Mirrors `term_item_listings._resolve_listing_status`'s "chosen
    reservation" pattern: among this item's LEND reservations that actually
    put it into `LENT` (i.e. `FULFILLED`), pick the most recent one (by
    `created_at` — a UUID primary key carries no creation-order information)
    and reuse its `term_id`."""
    reservations = await repository.list_reservations_for_item(db, item_id)
    lend_reservations = [
        r
        for r in reservations
        if r.reservation_type == ReservationType.LEND and r.status == ReservationStatus.FULFILLED
    ]
    if not lend_reservations:
        raise BusinessConflictException(
            f"InventoryItem {item_id} has no fulfilled LEND reservation to derive a RETURN "
            "term_id from"
        )
    chosen = max(lend_reservations, key=lambda r: r.created_at)
    return cast(uuid.UUID, chosen.term_id)


async def _current_holder_user_id(db: AsyncSession, item: InventoryItem) -> uuid.UUID:
    """Who currently physically holds this item — the party a fulfillment
    credits and a new reservation records as `giver_user_id`.
    `item.inventory_id` always reflects the current physical location: the
    borrower's VIRTUAL inventory during a `LEND`, or the owner's PERSONAL
    inventory otherwise (including post-`SWAP`/`GIFT`) — so the holder is
    simply that inventory's owner."""
    inventory = await get_inventory(db, item.inventory_id)
    return inventory.owner_user_id


async def create_reservation(db: AsyncSession, data: CreateReservationRequest) -> Reservation:
    item = await get_item(db, data.item_id)
    balance = await get_item_balance(db, cast(uuid.UUID, item.id))
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
    # Only the RETURN may touch an item that is out on loan; anything else
    # would re-lend or give away someone else's item.
    if data.reservation_type != ReservationType.RETURN and item.home_inventory_id is not None:
        raise BusinessConflictException(
            f"InventoryItem {item.id} is on loan and cannot enter a {data.reservation_type} "
            "reservation"
        )

    if data.reservation_type == ReservationType.RETURN:
        term_id = await _resolve_return_term_id(db, cast(uuid.UUID, item.id))
    else:
        # `CreateReservationRequest`'s own validator guarantees this for
        # every non-RETURN type.
        assert data.term_id is not None
        term_id = data.term_id

    reservation = Reservation(
        item_id=item.id,
        reservation_type=data.reservation_type,
        reserved_by_user_id=data.reserved_by_user_id,
        giver_user_id=await _current_holder_user_id(db, item),
        term_id=term_id,
        reserved_at=datetime.utcnow(),
        expires_at=data.expires_at,
        status=ReservationStatus.PENDING,
        notes=data.notes,
    )
    db.add(reservation)

    balance.status = BalanceStatus.RESERVED
    balance.reserved_at = datetime.utcnow()
    # A RETURN keeps the loan's own due date (a cancelled RETURN falls back
    # to LENT with it intact).
    if data.reservation_type != ReservationType.RETURN:
        balance.due_date = data.expires_at

    await db.commit()
    await db.refresh(reservation)
    return reservation


async def create_return_reservation(
    db: AsyncSession, *, item_id: uuid.UUID, notes: str | None, acting_user_id: uuid.UUID
) -> Reservation:
    """The raw-route RETURN ("Oddaję"): only the current holder of a lent
    item may start it, and the item always goes back to its home owner —
    `reserved_by_user_id` is derived here, never caller-supplied."""
    item = await get_item(db, item_id)
    if item.home_inventory_id is None:
        raise AccessDeniedException("Tę rzecz można oddać tylko, gdy jest pożyczona")
    if await _current_holder_user_id(db, item) != acting_user_id:
        raise AccessDeniedException("Zwrot może rozpocząć tylko osoba, która ma tę rzecz")
    home_inventory = await resolve_owning_inventory(db, item)
    return await create_reservation(
        db,
        CreateReservationRequest(
            item_id=item_id,
            reservation_type=ReservationType.RETURN,
            reserved_by_user_id=home_inventory.owner_user_id,
            notes=notes,
        ),
    )


async def create_lend_reservation(
    db: AsyncSession, *, item_id: uuid.UUID, reserved_by_user_id: uuid.UUID, term_id: uuid.UUID
) -> Reservation:
    """Used by `app.party`'s Pledge->Reservation bridge."""
    return await create_reservation(
        db,
        CreateReservationRequest(
            item_id=item_id,
            reservation_type=ReservationType.LEND,
            reserved_by_user_id=reserved_by_user_id,
            term_id=term_id,
        ),
    )


async def get_reservation(db: AsyncSession, reservation_id: uuid.UUID) -> Reservation:
    reservation = await repository.get_reservation(db, reservation_id)
    if reservation is None:
        raise EntityNotFoundException("Reservation", reservation_id)
    return reservation


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
