"""Item-movement ledger posting for `app.inventory`.

Every change of an item's location is one balanced `InventoryTransaction`
(-1 on the source inventory's account, +1 on the target's, the EXTERNAL
account standing in for the outside world), posted in the same commit as
the `InventoryItem.inventory_id` / `owner_inventory_id` / `deleted_at` /
`location_id` projection it explains.

Contract of the ledger:

- `post_movement` is the only code path that writes `inventory_transactions`
  and `inventory_entries` or changes the projection columns above. It only
  flushes; the calling use case in `application/` commits.
- What a movement type may do is declared once, in `MOVEMENT_RULES`: how
  many legs, from where to where, whether it hands ownership over and
  whether it clears the item's pickup place. A new movement type is a new
  `MovementType` value plus its rule here.
- `inventory_id` is where the item is now, `owner_inventory_id` whose it is;
  they differ only while the item is away from its owner (a LEND until its
  RETURN). Ownership decisions read `owner_inventory_id`.
- Other modules never read `accounts` / `inventory_entries` directly; they
  go through `app.inventory`'s service or an ACL.

Concurrency: the projection update runs under `BaseEntity`'s
`version_id_col`, so a concurrent movement of the same item updates 0 rows,
raises `StaleDataError` and surfaces as 409 through the shared handler. The
`from` check below is only a defensive assertion against a caller bug.
"""

from __future__ import annotations

import enum
import uuid
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessConflictException, EntityNotFoundException
from app.inventory.domain.reservation_rules import _next_transaction_number
from app.inventory.infrastructure import repository
from app.inventory.models import (
    Account,
    AccountType,
    InventoryEntry,
    InventoryItem,
    InventoryTransaction,
    InventoryType,
    MovementType,
)


class Side(enum.Enum):
    """Where a leg may start or end: the outside world (the EXTERNAL
    account), any inventory, or the item's owning inventory."""

    EXTERNAL = enum.auto()
    INVENTORY = enum.auto()
    OWNER = enum.auto()


@dataclass(frozen=True)
class MovementRule:
    legs: int
    source: Side
    target: Side
    transfers_ownership: bool
    requires_item_at_owner: bool
    clears_location: bool = False
    crossing_swap: bool = False


MOVEMENT_RULES: dict[MovementType, MovementRule] = {
    MovementType.REGISTER: MovementRule(
        legs=1,
        source=Side.EXTERNAL,
        target=Side.INVENTORY,
        transfers_ownership=True,
        requires_item_at_owner=False,
    ),
    MovementType.REMOVE: MovementRule(
        legs=1,
        source=Side.INVENTORY,
        target=Side.EXTERNAL,
        transfers_ownership=False,
        requires_item_at_owner=True,
    ),
    MovementType.GIFT: MovementRule(
        legs=1,
        source=Side.INVENTORY,
        target=Side.INVENTORY,
        transfers_ownership=True,
        requires_item_at_owner=True,
        clears_location=True,
    ),
    MovementType.SWAP: MovementRule(
        legs=2,
        source=Side.INVENTORY,
        target=Side.INVENTORY,
        transfers_ownership=True,
        requires_item_at_owner=True,
        clears_location=True,
        crossing_swap=True,
    ),
    MovementType.LEND: MovementRule(
        legs=1,
        source=Side.INVENTORY,
        target=Side.INVENTORY,
        transfers_ownership=False,
        requires_item_at_owner=True,
    ),
    MovementType.RETURN: MovementRule(
        legs=1,
        source=Side.INVENTORY,
        target=Side.OWNER,
        transfers_ownership=False,
        requires_item_at_owner=False,
    ),
}


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
) -> InventoryTransaction:
    """Validates the legs, posts one transaction with a -1/+1 entry pair per
    leg and updates each item's projection, all flushed and not committed.
    Rule violations raise `BusinessConflictException` before anything is
    written; an unbalanced entry set raises `ValueError`."""
    rule = MOVEMENT_RULES[movement_type]
    _validate_legs(movement_type, rule, legs)
    accounts = await _resolve_accounts(db, legs)
    if rule.crossing_swap:
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
        raise ValueError(f"Unbalanced inventory transaction: {dict(totals)}")

    transaction = InventoryTransaction(
        transaction_number=_next_transaction_number(),
        movement_type=movement_type,
        occurred_at=occurred_at,
        description=description,
    )
    db.add(transaction)
    await db.flush()
    db.add_all(
        InventoryEntry(
            transaction_id=transaction.id,
            account_id=account.id,
            item_id=item_id,
            quantity=quantity,
            reservation_id=reservation_id,
        )
        for account, item_id, quantity, reservation_id in entry_lines
    )

    for leg in legs:
        _apply_projection(rule, leg, occurred_at)
    await db.flush()
    return transaction


def _validate_legs(
    movement_type: MovementType, rule: MovementRule, legs: Sequence[MovementLeg]
) -> None:
    if rule.legs == 2:
        if len(legs) != 2 or legs[0].item.id == legs[1].item.id:
            raise BusinessConflictException("Zamiana wymaga dwóch nóg z różnymi rzeczami")
    elif len(legs) != rule.legs:
        raise BusinessConflictException(f"Ruch {movement_type} wymaga dokładnie jednej nogi")

    for leg in legs:
        _require_leg_shape(movement_type, rule, leg)
        item = leg.item
        if item.deleted_at is not None:
            raise BusinessConflictException("Rzecz została usunięta")
        if leg.from_inventory_id is not None and item.inventory_id != leg.from_inventory_id:
            raise BusinessConflictException("Rzecz nie znajduje się w inwentarzu źródłowym")
        if rule.target == Side.OWNER and item.owner_inventory_id != leg.to_inventory_id:
            raise BusinessConflictException("Zwrot musi trafić do inwentarza właściciela rzeczy")
        if rule.requires_item_at_owner and item.inventory_id != item.owner_inventory_id:
            raise BusinessConflictException("Rzecz jest wypożyczona i najpierw musi wrócić")


def _require_leg_shape(movement_type: MovementType, rule: MovementRule, leg: MovementLeg) -> None:
    source, target = leg.from_inventory_id, leg.to_inventory_id
    valid = (source is None) == (rule.source == Side.EXTERNAL) and (target is None) == (
        rule.target == Side.EXTERNAL
    )
    if source is not None and target is not None and source == target:
        valid = False
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


def _apply_projection(rule: MovementRule, leg: MovementLeg, occurred_at: datetime) -> None:
    item = leg.item
    if leg.to_inventory_id is None:
        item.deleted_at = occurred_at
        return
    item.inventory_id = leg.to_inventory_id
    if rule.transfers_ownership:
        item.owner_inventory_id = leg.to_inventory_id
    if rule.clears_location:
        item.location_id = None
