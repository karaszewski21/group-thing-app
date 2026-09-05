"""Wypożyczalnia business logic: `Inventory`/`InventoryItem` CRUD (against
the shared `app.product.Product` catalog), the `InventoryBalance` state
machine driven by `Reservation.status` transitions, and the points-ledger
posting logic.

Posting rule (`docs/system-wypozyczalni-inventory-accounting.md` §3): a
`CirculationTransaction` is created only when a `Reservation` reaches
`fulfilled`, and always credits the **current holder** of the item at that
moment — the party physically handing it onward — never `reserved_by` (the
recipient). `_current_holder_user_id` derives who that is by walking the
item's fulfilled reservation history, since `Inventory.owner_user_id` alone
doesn't change for a temporary `LEND` (see that helper's docstring). This
one rule unifies `lend`/`return`/`swap`/`gift` into a single fulfillment
code path instead of four bespoke branches for the accounting half.

Posted amount is a flat `Decimal("1")` per transaction — points-worth
differentiation per product was deliberately descoped (see the
product-catalog unification plan); `Product` carries no points-value field.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.models import User
from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.product import service as product_service

from .models import (
    Account,
    AccountType,
    BalanceStatus,
    CirculationEntry,
    CirculationTransaction,
    EntrySide,
    Inventory,
    InventoryBalance,
    InventoryItem,
    InventoryType,
    ItemCondition,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from .schemas import CreateInventoryRequest, CreateReservationRequest, CreateSwapRequest

_EMISSION_ACCOUNT_CODE = "900-100"
_DEFAULT_LEND_DAYS = 14
_POSTED_AMOUNT = Decimal("1")

# --- Identity resolution -----------------------------------------------------


async def get_user_id_by_principal(db: AsyncSession, principal: Principal) -> int:
    """Resolves the calling `Principal` (a JWT `sub`/username) to its
    `users.id` — this vertical has no `Person` concept of its own (see
    module docstring), it only ever deals in raw `User` ids."""
    user = (
        await db.execute(select(User).where(User.username == principal.username))
    ).scalar_one_or_none()
    if user is None:
        raise EntityNotFoundException("User", principal.username)
    return cast(int, user.id)


# --- Inventory / InventoryItem ----------------------------------------------


async def create_inventory(
    db: AsyncSession, owner_user_id: int, data: CreateInventoryRequest
) -> Inventory:
    inventory = Inventory(
        owner_user_id=owner_user_id, inventory_type=data.inventory_type, location=data.location
    )
    db.add(inventory)
    await db.commit()
    await db.refresh(inventory)
    return inventory


async def get_inventory(db: AsyncSession, inventory_id: int) -> Inventory:
    inventory = await db.get(Inventory, inventory_id)
    if inventory is None:
        raise EntityNotFoundException("Inventory", inventory_id)
    return inventory


async def list_inventories(db: AsyncSession, owner_user_id: int | None) -> list[Inventory]:
    stmt = select(Inventory).order_by(Inventory.created_at.desc())
    if owner_user_id is not None:
        stmt = stmt.where(Inventory.owner_user_id == owner_user_id)
    return list((await db.execute(stmt)).scalars().all())


async def get_or_create_personal_inventory(db: AsyncSession, owner_user_id: int) -> Inventory:
    """Used by `app.party`'s Pledge->Reservation bridge — a guardian
    registering their first item doesn't need to have manually created an
    Inventory beforehand."""
    result = await db.execute(
        select(Inventory).where(
            Inventory.owner_user_id == owner_user_id,
            Inventory.inventory_type == InventoryType.PERSONAL,
        )
    )
    inventory = result.scalars().first()
    if inventory is not None:
        return inventory
    inventory = Inventory(
        owner_user_id=owner_user_id, inventory_type=InventoryType.PERSONAL, location=None
    )
    db.add(inventory)
    await db.flush()
    return inventory


async def register_item(
    db: AsyncSession,
    inventory_id: int,
    product_id: int,
    condition: str,
    *,
    owner_user_id: int | None = None,
) -> InventoryItem:
    inventory = await get_inventory(db, inventory_id)
    if owner_user_id is not None and inventory.owner_user_id != owner_user_id:
        raise AccessDeniedException
    await product_service.get_product(db, product_id)

    item = InventoryItem(
        inventory_id=inventory_id,
        product_id=product_id,
        condition=ItemCondition(condition),
        added_at=datetime.utcnow(),
    )
    db.add(item)
    await db.flush()

    balance = InventoryBalance(item_id=item.id, status=BalanceStatus.AVAILABLE)
    db.add(balance)
    await db.commit()
    await db.refresh(item)
    return item


async def get_item(db: AsyncSession, item_id: int) -> InventoryItem:
    item = await db.get(InventoryItem, item_id)
    if item is None:
        raise EntityNotFoundException("InventoryItem", item_id)
    return item


async def list_items(db: AsyncSession, inventory_id: int) -> list[InventoryItem]:
    result = await db.execute(
        select(InventoryItem).where(InventoryItem.inventory_id == inventory_id)
    )
    return list(result.scalars().all())


async def get_item_balance(db: AsyncSession, item_id: int) -> InventoryBalance:
    result = await db.execute(select(InventoryBalance).where(InventoryBalance.item_id == item_id))
    balance = result.scalar_one_or_none()
    if balance is None:
        raise EntityNotFoundException("InventoryBalance", item_id)
    return balance


# --- Accounts -----------------------------------------------------------


async def get_or_create_user_balance_account(db: AsyncSession, user_id: int) -> Account:
    code = f"100-{user_id}"
    result = await db.execute(select(Account).where(Account.code == code))
    account = result.scalar_one_or_none()
    if account is not None:
        return account
    account = Account(
        code=code,
        name="Saldo punktow uzytkownika",
        account_type=AccountType.USER_BALANCE,
        owner_user_id=user_id,
    )
    db.add(account)
    await db.flush()
    return account


async def _get_emission_account(db: AsyncSession) -> Account:
    result = await db.execute(select(Account).where(Account.code == _EMISSION_ACCOUNT_CODE))
    account = result.scalar_one_or_none()
    if account is None:
        raise EntityNotFoundException("Account", _EMISSION_ACCOUNT_CODE)
    return account


async def get_account_balance(db: AsyncSession, user_id: int) -> tuple[Account, Decimal]:
    account = await get_or_create_user_balance_account(db, user_id)
    await db.commit()
    result = await db.execute(
        select(CirculationEntry).where(CirculationEntry.account_id == account.id)
    )
    total = Decimal("0")
    for entry in result.scalars().all():
        total += entry.amount if entry.entry_side == EntrySide.DEBIT else -entry.amount
    return account, total


async def get_transaction(db: AsyncSession, transaction_id: int) -> CirculationTransaction:
    """Full audit-trail read (doc's "Pełna historia" benefit) — always
    eager-loads `entries` + each entry's `account`, per
    `standards/backend/models.md`'s `lazy=\"raise\"` contract."""
    result = await db.execute(
        select(CirculationTransaction)
        .options(selectinload(CirculationTransaction.entries).joinedload(CirculationEntry.account))
        .where(CirculationTransaction.id == transaction_id)
    )
    transaction = result.scalar_one_or_none()
    if transaction is None:
        raise EntityNotFoundException("CirculationTransaction", transaction_id)
    return transaction


async def list_transactions_for_account(
    db: AsyncSession, account_id: int
) -> list[CirculationTransaction]:
    result = await db.execute(
        select(CirculationTransaction)
        .join(CirculationEntry, CirculationEntry.transaction_id == CirculationTransaction.id)
        .options(selectinload(CirculationTransaction.entries).joinedload(CirculationEntry.account))
        .where(CirculationEntry.account_id == account_id)
        .order_by(CirculationTransaction.transaction_date.desc())
        .distinct()
    )
    return list(result.scalars().all())


# --- Reservation lifecycle + InventoryBalance state machine -----------------


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
    reservation = await db.get(Reservation, reservation_id)
    if reservation is None:
        raise EntityNotFoundException("Reservation", reservation_id)
    return reservation


async def list_reservations(db: AsyncSession, item_id: int) -> list[Reservation]:
    result = await db.execute(select(Reservation).where(Reservation.item_id == item_id))
    return list(result.scalars().all())


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
    result = await db.execute(
        select(Reservation)
        .where(Reservation.item_id == item.id, Reservation.status == ReservationStatus.FULFILLED)
        .order_by(Reservation.reserved_at.desc(), Reservation.id.desc())
    )
    most_recent = result.scalars().first()
    if most_recent is not None and most_recent.reservation_type == ReservationType.LEND:
        return most_recent.reserved_by_user_id
    inventory = await get_inventory(db, item.inventory_id)
    return inventory.owner_user_id


def _next_transaction_number() -> str:
    return f"TRX-{uuid.uuid4().hex[:12].upper()}"


async def _post_circulation_transaction(
    db: AsyncSession, *, giver_user_id: int, amount: Decimal, description: str
) -> CirculationTransaction:
    giver_account = await get_or_create_user_balance_account(db, giver_user_id)
    emission_account = await _get_emission_account(db)

    today = datetime.utcnow().date()
    txn = CirculationTransaction(
        transaction_number=_next_transaction_number(),
        transaction_date=today,
        description=description,
        is_posted=True,
    )
    db.add(txn)
    await db.flush()

    db.add_all(
        [
            CirculationEntry(
                transaction_id=txn.id,
                account_id=giver_account.id,
                amount=amount,
                entry_side=EntrySide.DEBIT,
                description=description,
                entry_date=today,
            ),
            CirculationEntry(
                transaction_id=txn.id,
                account_id=emission_account.id,
                amount=amount,
                entry_side=EntrySide.CREDIT,
                description=f"Emisja punktow za obieg - {description}",
                entry_date=today,
            ),
        ]
    )
    return txn


def _require_party_to_reservation(
    reservation: Reservation, holder_user_id: int, acting_user_id: int
) -> None:
    if acting_user_id not in (reservation.reserved_by_user_id, holder_user_id):
        raise AccessDeniedException


async def confirm_reservation(
    db: AsyncSession, reservation_id: int, acting_user_id: int
) -> Reservation:
    reservation = await get_reservation(db, reservation_id)
    if reservation.status != ReservationStatus.PENDING:
        raise BusinessConflictException(f"Reservation {reservation_id} is not PENDING")
    item = await get_item(db, reservation.item_id)
    holder_user_id = await _current_holder_user_id(db, item)
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
    item = await get_item(db, reservation.item_id)
    holder_user_id = await _current_holder_user_id(db, item)
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
    item = await get_item(db, reservation.item_id)
    holder_user_id = await _current_holder_user_id(db, item)
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
    await _post_circulation_transaction(
        db, giver_user_id=holder_user_id, amount=_POSTED_AMOUNT, description=description
    )

    await db.commit()
    await db.refresh(reservation)
    return reservation
