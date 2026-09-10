"""`Reservation` lifecycle transitions (confirm / cancel / fulfill) and the
driven `InventoryBalance` field-mutation cascades (kept inline per D2). The
`CirculationTransaction` posting itself lives in
`app.circulation.infrastructure.ledger`."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.inventory import (
    get_inventory,
    get_or_create_personal_inventory,
)
from app.circulation.application.inventory_items import get_item, get_item_balance
from app.circulation.application.reservations import get_reservation
from app.circulation.domain.constants import _DEFAULT_LEND_DAYS, _POSTED_AMOUNT
from app.circulation.domain.reservation_rules import _require_party_to_reservation
from app.circulation.infrastructure import ledger, repository
from app.circulation.models import (
    BalanceStatus,
    InventoryItem,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.core.errors import BusinessConflictException
from app.product import service as product_service


async def _current_holder_user_id(db: AsyncSession, item: InventoryItem) -> int:
    """Who currently physically holds this item — the party a fulfillment
    now credits. `LEND`/`RETURN` never change `Inventory.owner_user_id`
    (temporary possession, per the reference doc's §6 note), so the holder
    must be derived from the most recent *fulfilled* reservation instead of
    read straight off the FK: an unreturned fulfilled `LEND`'s recipient is
    the current holder; anything else (no history, or the most recent
    fulfilled reservation is a `RETURN`/`SWAP`/`GIFT`, which do update
    `inventory_id` or hand it back) means the item's own inventory owner is.
    """
    most_recent = await repository.latest_fulfilled_reservation_for_item(db, cast(int, item.id))
    if most_recent is not None and most_recent.reservation_type == ReservationType.LEND:
        return most_recent.reserved_by_user_id
    inventory = await get_inventory(db, item.inventory_id)
    return inventory.owner_user_id


async def _load_reservation_for_transition(
    db: AsyncSession, reservation: Reservation
) -> tuple[InventoryItem, int]:
    """The load-and-context lookup shared by confirm/cancel/fulfill, run
    *after* each caller's own status guard (order preserved from the
    pre-refactor single-function form)."""
    item = await get_item(db, reservation.item_id)
    holder_user_id = await _current_holder_user_id(db, item)
    return item, holder_user_id


async def confirm_reservation(
    db: AsyncSession, reservation_id: int, acting_user_id: int
) -> Reservation:
    reservation = await get_reservation(db, reservation_id)
    if reservation.status != ReservationStatus.PENDING:
        raise BusinessConflictException(f"Reservation {reservation_id} is not PENDING")
    item, holder_user_id = await _load_reservation_for_transition(db, reservation)
    _require_party_to_reservation(reservation, holder_user_id, acting_user_id)

    reservation.status = ReservationStatus.CONFIRMED
    balance = await get_item_balance(db, cast(int, item.id))
    balance.status = BalanceStatus.IN_TRANSIT

    await db.commit()
    await db.refresh(reservation)
    return reservation


async def cancel_reservation(
    db: AsyncSession, reservation_id: int, acting_user_id: int
) -> Reservation:
    reservation = await get_reservation(db, reservation_id)
    if reservation.status in (ReservationStatus.FULFILLED, ReservationStatus.CANCELLED):
        raise BusinessConflictException(f"Reservation {reservation_id} cannot be cancelled")
    item, holder_user_id = await _load_reservation_for_transition(db, reservation)
    _require_party_to_reservation(reservation, holder_user_id, acting_user_id)

    reservation.status = ReservationStatus.CANCELLED
    balance = await get_item_balance(db, cast(int, item.id))
    balance.status = BalanceStatus.AVAILABLE
    balance.reserved_at = None
    balance.due_date = None

    await db.commit()
    await db.refresh(reservation)
    return reservation


async def fulfill_reservation(
    db: AsyncSession, reservation_id: int, acting_user_id: int
) -> Reservation:
    """The only place a `CirculationTransaction` is created — matches the
    reference doc's "never at pending/confirmed" rule exactly."""
    reservation = await get_reservation(db, reservation_id)
    if reservation.status != ReservationStatus.CONFIRMED:
        raise BusinessConflictException(f"Reservation {reservation_id} is not CONFIRMED")
    item, holder_user_id = await _load_reservation_for_transition(db, reservation)
    _require_party_to_reservation(reservation, holder_user_id, acting_user_id)

    product = await product_service.get_product(db, item.product_id)
    balance = await get_item_balance(db, cast(int, item.id))
    now = datetime.utcnow()

    if reservation.reservation_type == ReservationType.LEND:
        balance.status = BalanceStatus.LENT
        balance.lent_at = now
        balance.due_date = reservation.expires_at or (now + timedelta(days=_DEFAULT_LEND_DAYS))
    elif reservation.reservation_type == ReservationType.RETURN:
        balance.status = BalanceStatus.AVAILABLE
        balance.returned_at = now
        balance.reserved_at = None
        balance.lent_at = None
        balance.due_date = None
    else:  # SWAP, GIFT: permanent change of possession
        target_inventory = await get_or_create_personal_inventory(
            db, reservation.reserved_by_user_id
        )
        item.inventory_id = target_inventory.id
        balance.status = BalanceStatus.AVAILABLE
        balance.reserved_at = None
        balance.due_date = None

    reservation.status = ReservationStatus.FULFILLED

    description = f"{reservation.reservation_type.value}: {product.name}"
    await ledger.post_circulation(
        db, giver_user_id=holder_user_id, amount=_POSTED_AMOUNT, description=description
    )

    await db.commit()
    await db.refresh(reservation)
    return reservation
