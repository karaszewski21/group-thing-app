"""Item-movement ledger posting for `app.circulation`.

Every change of an item's location is one balanced `CirculationTransaction`
(-1 on the source inventory's account, +1 on the target's, the EXTERNAL
account standing in for the outside world), posted in the same commit as
the `InventoryItem.inventory_id` / `home_inventory_id` / `deleted_at`
projection it explains. `post_movement` is the only code path that changes
those columns. It only flushes; the calling use case in `application/`
commits.

Concurrency: the projection update runs under `BaseEntity`'s
`version_id_col`, so a concurrent movement of the same item updates 0 rows,
raises `StaleDataError` and surfaces as 409 through the shared handler. The
`from` check below is only a defensive assertion against a caller bug.
"""

from __future__ import annotations

import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.domain.reservation_rules import _next_transaction_number
from app.circulation.infrastructure import repository
from app.circulation.models import (
    Account,
    AccountType,
    CirculationEntry,
    CirculationTransaction,
    InventoryItem,
    InventoryType,
    MovementType,
)
from app.core.errors import BusinessConflictException, EntityNotFoundException

_LEGS_WITHOUT_HOME = (
    MovementType.LEND,
    MovementType.GIFT,
    MovementType.SWAP,
    MovementType.REMOVE,
)


@dataclass(frozen=True)
class MovementLeg:
    """One item moving `from_inventory_id` -> `to_inventory_id`; `None` on
    either side means the EXTERNAL account. The caller reads
    `from_inventory_id` from `item.inventory_id` before posting."""

    item: InventoryItem
    from_inventory_id: uuid.UUID | None
    to_inventory_id: uuid.UUID | None
    reservation_id: uuid.UUID | None


async def post_movement(
    db: AsyncSession,
    *,
    movement_type: MovementType,
    legs: Sequence[MovementLeg],
    description: str,
    occurred_at: datetime,
) -> CirculationTransaction:
    """Validates the legs, posts one transaction with a -1/+1 entry pair per
    leg and updates each item's projection, all flushed and not committed.
    Rule violations raise `BusinessConflictException` before anything is
    written; an unbalanced entry set raises `ValueError`."""
    _validate_legs(movement_type, legs)
    accounts = await _resolve_accounts(db, legs)
    if movement_type == MovementType.SWAP:
        _require_personal_swap_crossing(legs, accounts)

    entry_lines = [
        (accounts[side], cast(uuid.UUID, leg.item.id), quantity, leg.reservation_id)
        for leg in legs
        for side, quantity in ((leg.from_inventory_id, -1), (leg.to_inventory_id, 1))
    ]
    totals: Counter[uuid.UUID] = Counter()
    for _, item_id, quantity, _ in entry_lines:
        totals[item_id] += quantity
    if any(totals.values()):
        raise ValueError(f"Unbalanced circulation transaction: {dict(totals)}")

    transaction = CirculationTransaction(
        transaction_number=_next_transaction_number(),
        movement_type=movement_type,
        occurred_at=occurred_at,
        description=description,
    )
    db.add(transaction)
    await db.flush()
    db.add_all(
        CirculationEntry(
            transaction_id=transaction.id,
            account_id=account.id,
            item_id=item_id,
            quantity=quantity,
            reservation_id=reservation_id,
        )
        for account, item_id, quantity, reservation_id in entry_lines
    )

    for leg in legs:
        _apply_projection(movement_type, leg, occurred_at)
    await db.flush()
    return transaction


def _validate_legs(movement_type: MovementType, legs: Sequence[MovementLeg]) -> None:
    if movement_type == MovementType.SWAP:
        if len(legs) != 2 or legs[0].item.id == legs[1].item.id:
            raise BusinessConflictException("Zamiana wymaga dwóch nóg z różnymi rzeczami")
    elif len(legs) != 1:
        raise BusinessConflictException(f"Ruch {movement_type} wymaga dokładnie jednej nogi")

    for leg in legs:
        _require_leg_shape(movement_type, leg)
        item = leg.item
        if item.deleted_at is not None:
            raise BusinessConflictException("Rzecz została usunięta")
        if leg.from_inventory_id is not None and item.inventory_id != leg.from_inventory_id:
            raise BusinessConflictException("Rzecz nie znajduje się w inwentarzu źródłowym")
        if movement_type == MovementType.RETURN and item.home_inventory_id != leg.to_inventory_id:
            raise BusinessConflictException("Zwrot musi trafić do inwentarza domowego rzeczy")
        if movement_type in _LEGS_WITHOUT_HOME and item.home_inventory_id is not None:
            raise BusinessConflictException("Rzecz jest wypożyczona i najpierw musi wrócić")


def _require_leg_shape(movement_type: MovementType, leg: MovementLeg) -> None:
    source, target = leg.from_inventory_id, leg.to_inventory_id
    if movement_type == MovementType.REGISTER:
        valid = source is None and target is not None
    elif movement_type == MovementType.REMOVE:
        valid = source is not None and target is None
    else:
        valid = source is not None and target is not None and source != target
    if not valid:
        raise BusinessConflictException(f"Nieprawidłowy kształt nogi ruchu {movement_type}")


async def _resolve_accounts(
    db: AsyncSession, legs: Sequence[MovementLeg]
) -> dict[uuid.UUID | None, Account]:
    """Accounts keyed by inventory id, the EXTERNAL account under `None`."""
    sides = {side for leg in legs for side in (leg.from_inventory_id, leg.to_inventory_id)}
    inventory_ids = {side for side in sides if side is not None}
    found = await repository.find_accounts_for_posting(
        db, inventory_ids, include_external=None in sides
    )
    accounts: dict[uuid.UUID | None, Account] = {
        None if account.account_type == AccountType.EXTERNAL else account.inventory_id: account
        for account in found
    }
    for side in sides:
        if side not in accounts:
            raise EntityNotFoundException("Account", side if side is not None else "EXTERNAL")
    return accounts


def _require_personal_swap_crossing(
    legs: Sequence[MovementLeg], accounts: dict[uuid.UUID | None, Account]
) -> None:
    """X goes PERSONAL(A) -> PERSONAL(B) and Y goes PERSONAL(B) -> PERSONAL(A)
    with A and B owned by different users."""
    x, y = legs
    inventories = [
        accounts[side].inventory
        for side in (x.from_inventory_id, x.to_inventory_id, y.from_inventory_id, y.to_inventory_id)
    ]
    personal = [
        inventory
        for inventory in inventories
        if inventory is not None and inventory.inventory_type == InventoryType.PERSONAL
    ]
    crossing = x.from_inventory_id == y.to_inventory_id and x.to_inventory_id == y.from_inventory_id
    if not crossing or len(personal) != len(inventories):
        raise BusinessConflictException(
            "Zamiana wymaga wzajemnej wymiany między inwentarzami osobistymi dwóch stron"
        )
    if personal[0].owner_user_id == personal[1].owner_user_id:
        raise BusinessConflictException("Zamiana wymaga dwóch różnych właścicieli")


def _apply_projection(movement_type: MovementType, leg: MovementLeg, occurred_at: datetime) -> None:
    item = leg.item
    if leg.to_inventory_id is not None:
        item.inventory_id = leg.to_inventory_id
    else:
        item.deleted_at = occurred_at
    if movement_type == MovementType.LEND:
        item.home_inventory_id = leg.from_inventory_id
    elif movement_type == MovementType.RETURN:
        item.home_inventory_id = None
