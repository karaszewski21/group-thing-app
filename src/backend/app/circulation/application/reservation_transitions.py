"""`Reservation` lifecycle transitions (confirm / cancel / fulfill) and the
driven `InventoryBalance` field-mutation cascades (kept inline per D2).

`_confirm` / `_cancel` / `_fulfill` only mutate and flush; the public
wrappers commit. `_fulfill` returns the `MovementLeg` of the fulfilment and
the wrapper posts it through `post_movement`, the only code that changes an
item's location. `fulfill_exchange` / `cancel_exchange` resolve a whole
exchange (a LEND/GIFT leg or both SWAP legs) in one commit."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.inventory import (
    get_or_create_personal_inventory,
    get_or_create_virtual_inventory,
)
from app.circulation.application.inventory_items import get_item, get_item_balance
from app.circulation.application.reservations import _current_holder_user_id, get_reservation
from app.circulation.domain.constants import _DEFAULT_LEND_DAYS
from app.circulation.domain.reservation_rules import (
    _require_exchange_legs,
    _require_holder_to_confirm,
    _require_party_to_any_reservation,
    _require_party_to_reservation,
)
from app.circulation.infrastructure.ledger import MovementLeg, post_movement
from app.circulation.models import (
    BalanceStatus,
    InventoryItem,
    MovementType,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.core.errors import BusinessConflictException
from app.product import service as product_service


async def _load_reservation_for_transition(
    db: AsyncSession, reservation: Reservation
) -> tuple[InventoryItem, uuid.UUID]:
    """The load-and-context lookup shared by confirm/cancel/fulfill, run
    *after* each caller's own status guard."""
    item = await get_item(db, reservation.item_id)
    holder_user_id = await _current_holder_user_id(db, item)
    return item, holder_user_id


async def _confirm(db: AsyncSession, reservation: Reservation, acting_user_id: uuid.UUID) -> None:
    if reservation.status != ReservationStatus.PENDING:
        raise BusinessConflictException(f"Reservation {reservation.id} is not PENDING")
    item, holder_user_id = await _load_reservation_for_transition(db, reservation)
    _require_holder_to_confirm(holder_user_id, acting_user_id)

    reservation.status = ReservationStatus.CONFIRMED
    balance = await get_item_balance(db, cast(uuid.UUID, item.id))
    balance.status = BalanceStatus.IN_TRANSIT
    await db.flush()


async def _cancel(db: AsyncSession, reservation: Reservation, acting_user_id: uuid.UUID) -> None:
    if reservation.status in (ReservationStatus.FULFILLED, ReservationStatus.CANCELLED):
        raise BusinessConflictException(f"Reservation {reservation.id} cannot be cancelled")
    item, holder_user_id = await _load_reservation_for_transition(db, reservation)
    _require_party_to_reservation(reservation, holder_user_id, acting_user_id)

    reservation.status = ReservationStatus.CANCELLED
    balance = await get_item_balance(db, cast(uuid.UUID, item.id))
    balance.reserved_at = None
    if reservation.reservation_type == ReservationType.RETURN:
        # The item is still in the borrower's VIRTUAL inventory, so the loan
        # simply continues — same `lent_at`/`due_date`.
        balance.status = BalanceStatus.LENT
    else:
        balance.status = BalanceStatus.AVAILABLE
        balance.due_date = None
    await db.flush()


async def _fulfill(
    db: AsyncSession, reservation: Reservation, acting_user_id: uuid.UUID, now: datetime
) -> MovementLeg:
    """Marks the reservation FULFILLED, updates the balance and returns the
    leg moving the item from its current inventory to the reservation's
    target. The item's location itself is changed by `post_movement`."""
    if reservation.status != ReservationStatus.CONFIRMED:
        raise BusinessConflictException(f"Reservation {reservation.id} is not CONFIRMED")
    item, holder_user_id = await _load_reservation_for_transition(db, reservation)
    _require_party_to_reservation(reservation, holder_user_id, acting_user_id)

    balance = await get_item_balance(db, cast(uuid.UUID, item.id))
    from_inventory_id = item.inventory_id

    if reservation.reservation_type == ReservationType.LEND:
        if item.home_inventory_id is not None:
            raise BusinessConflictException(
                f"InventoryItem {item.id} is already on loan and cannot be lent again"
            )
        target = await get_or_create_virtual_inventory(db, reservation.reserved_by_user_id)
        to_inventory_id = cast(uuid.UUID, target.id)
        balance.status = BalanceStatus.LENT
        balance.lent_at = now
        balance.due_date = reservation.expires_at or (now + timedelta(days=_DEFAULT_LEND_DAYS))
    elif reservation.reservation_type == ReservationType.RETURN:
        if item.home_inventory_id is None:
            raise BusinessConflictException(
                f"InventoryItem {item.id} is not on loan and has no home to return to"
            )
        to_inventory_id = item.home_inventory_id
        balance.status = BalanceStatus.AVAILABLE
        balance.returned_at = now
        balance.reserved_at = None
        balance.lent_at = None
        balance.due_date = None
    else:  # SWAP, GIFT: permanent change of possession
        target = await get_or_create_personal_inventory(db, reservation.reserved_by_user_id)
        to_inventory_id = cast(uuid.UUID, target.id)
        balance.status = BalanceStatus.AVAILABLE
        balance.reserved_at = None
        balance.due_date = None

    reservation.status = ReservationStatus.FULFILLED
    await db.flush()
    return MovementLeg(
        item=item,
        from_inventory_id=from_inventory_id,
        to_inventory_id=to_inventory_id,
        reservation_id=cast(uuid.UUID, reservation.id),
    )


async def confirm_reservation(
    db: AsyncSession, reservation_id: uuid.UUID, acting_user_id: uuid.UUID
) -> Reservation:
    reservation = await get_reservation(db, reservation_id)
    await _confirm(db, reservation, acting_user_id)
    await db.commit()
    await db.refresh(reservation)
    return reservation


async def cancel_reservation(
    db: AsyncSession, reservation_id: uuid.UUID, acting_user_id: uuid.UUID
) -> Reservation:
    reservation = await get_reservation(db, reservation_id)
    await _cancel(db, reservation, acting_user_id)
    await db.commit()
    await db.refresh(reservation)
    return reservation


async def fulfill_reservation(
    db: AsyncSession, reservation_id: uuid.UUID, acting_user_id: uuid.UUID
) -> Reservation:
    """Fulfils a single-leg LEND, RETURN or GIFT and posts its movement in
    the same commit. A SWAP leg is rejected with 409, because an exchange
    is only ever fulfilled as a pair."""
    reservation = await get_reservation(db, reservation_id)
    if reservation.reservation_type == ReservationType.SWAP:
        raise BusinessConflictException("Zamiana realizowana jest wyłącznie parą")
    now = datetime.utcnow()
    leg = await _fulfill(db, reservation, acting_user_id, now)
    await _post_fulfilment(db, reservation.reservation_type, [leg], now)
    await db.commit()
    await db.refresh(reservation)
    return reservation


async def _post_fulfilment(
    db: AsyncSession, reservation_type: ReservationType, legs: list[MovementLeg], now: datetime
) -> None:
    """Posts the fulfilment legs as one movement described by the moved
    products, e.g. `"GIFT: X"` or `"SWAP: X ⇄ Y"`."""
    movement_type = MovementType(reservation_type.value)
    names = [(await product_service.get_product(db, leg.item.product_id)).name for leg in legs]
    await post_movement(
        db,
        movement_type=movement_type,
        legs=legs,
        description=f"{movement_type}: {' ⇄ '.join(names)}",
        occurred_at=now,
    )


async def _load_exchange(
    db: AsyncSession, reservation_ids: Sequence[uuid.UUID], acting_user_id: uuid.UUID
) -> list[Reservation]:
    reservations = [await get_reservation(db, reservation_id) for reservation_id in reservation_ids]
    _require_exchange_legs(reservations)
    _require_party_to_any_reservation(reservations, acting_user_id)
    return reservations


async def fulfill_exchange(
    db: AsyncSession, reservation_ids: Sequence[uuid.UUID], acting_user_id: uuid.UUID
) -> list[Reservation]:
    """Confirms (if still PENDING) and fulfils every leg of one exchange,
    posts them as a single movement and returns the reservations in input
    order. Raises 403 unless `acting_user_id` is the giver or the recipient
    of some leg; each leg itself runs on behalf of its item's holder.

    Commits the session's whole current transaction, including changes the
    caller only flushed beforehand; the caller relies on this commit and
    does not commit itself."""
    reservations = await _load_exchange(db, reservation_ids, acting_user_id)
    now = datetime.utcnow()
    # Every leg is built before posting, while all projections still show
    # the pre-exchange locations the legs move from.
    legs = []
    for reservation in reservations:
        _, holder_user_id = await _load_reservation_for_transition(db, reservation)
        if reservation.status == ReservationStatus.PENDING:
            await _confirm(db, reservation, holder_user_id)
        legs.append(await _fulfill(db, reservation, holder_user_id, now))
    await _post_fulfilment(db, reservations[0].reservation_type, legs, now)
    await db.commit()
    for reservation in reservations:
        await db.refresh(reservation)
    return reservations


async def cancel_exchange(
    db: AsyncSession, reservation_ids: Sequence[uuid.UUID], acting_user_id: uuid.UUID
) -> list[Reservation]:
    """Cancels every leg of one exchange and returns the reservations in
    input order. Same 403 rule and same commit contract as
    `fulfill_exchange`: commits the session's whole current transaction."""
    reservations = await _load_exchange(db, reservation_ids, acting_user_id)
    for reservation in reservations:
        _, holder_user_id = await _load_reservation_for_transition(db, reservation)
        await _cancel(db, reservation, holder_user_id)
    await db.commit()
    for reservation in reservations:
        await db.refresh(reservation)
    return reservations
