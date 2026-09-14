"""Anti-corruption layer over `app.circulation`: the ONLY `app.groups`
module that imports the circulation vertical. `application/pledge_fulfillment`
drives the Pledge->Reservation bridge exclusively through these thin
pass-throughs, and reads `ReservationStatus` from here rather than
importing circulation models directly. `application/term_item_listings`
and `application/attendance` drive the ItemListingPreference->Reservation
bridge the same way, via the `create_reservation`/`create_swap`/
`list_reservations` pass-throughs and the re-exported `ReservationType`."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation import service as circulation_service
from app.circulation.models import (
    BalanceStatus,
    Inventory,
    InventoryBalance,
    InventoryItem,
    InventoryType,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.circulation.schemas import CreateReservationRequest, CreateSwapRequest

__all__ = [
    "BalanceStatus",
    "InventoryItem",
    "InventoryType",
    "Reservation",
    "ReservationStatus",
    "ReservationType",
    "create_lend_reservation",
    "create_reservation",
    "create_swap",
    "get_inventory",
    "get_item",
    "get_item_balance",
    "get_or_create_personal_inventory",
    "get_reservation",
    "list_reservations",
    "register_item",
]


async def get_or_create_personal_inventory(db: AsyncSession, owner_user_id: int) -> Inventory:
    return await circulation_service.get_or_create_personal_inventory(db, owner_user_id)


async def register_item(
    db: AsyncSession, inventory_id: int, product_id: int, condition: str
) -> InventoryItem:
    return await circulation_service.register_item(db, inventory_id, product_id, condition)


async def create_lend_reservation(
    db: AsyncSession, *, item_id: int, reserved_by_user_id: int
) -> Reservation:
    return await circulation_service.create_lend_reservation(
        db, item_id=item_id, reserved_by_user_id=reserved_by_user_id
    )


async def create_reservation(
    db: AsyncSession, *, item_id: int, reservation_type: ReservationType, reserved_by_user_id: int
) -> Reservation:
    """Generic reservation creation (`LEND`/`GIFT` for the exchange
    mechanism — `create_lend_reservation` above stays as the narrower
    Pledge-only helper). Used by `app.groups.application.term_item_listings`."""
    return await circulation_service.create_reservation(
        db,
        CreateReservationRequest(
            item_id=item_id,
            reservation_type=reservation_type,
            reserved_by_user_id=reserved_by_user_id,
        ),
    )


async def create_swap(
    db: AsyncSession,
    *,
    first_item_id: int,
    first_reserved_by_user_id: int,
    second_item_id: int,
    second_reserved_by_user_id: int,
) -> tuple[Reservation, Reservation]:
    """Used by `app.groups.application.term_item_listings`'s `SWAP` take
    path. Returns `(first, second)` — the **first** is the listed-item leg,
    whose reservation id `_resolve_listing_status` later reports back as
    `resolved_reservation_id` (derived, not stored)."""
    return await circulation_service.create_swap(
        db,
        CreateSwapRequest(
            first_item_id=first_item_id,
            first_reserved_by_user_id=first_reserved_by_user_id,
            second_item_id=second_item_id,
            second_reserved_by_user_id=second_reserved_by_user_id,
        ),
    )


async def get_reservation(db: AsyncSession, reservation_id: int) -> Reservation:
    return await circulation_service.get_reservation(db, reservation_id)


async def list_reservations(db: AsyncSession, item_id: int) -> list[Reservation]:
    """Used by `application/term_item_listings.py` to derive an item's
    current listing status (active or most-recently-fulfilled reservation)
    since that's no longer cached on a stored listing row."""
    return await circulation_service.list_reservations(db, item_id)


async def get_item(db: AsyncSession, item_id: int) -> InventoryItem:
    return await circulation_service.get_item(db, item_id)


async def get_item_balance(db: AsyncSession, item_id: int) -> InventoryBalance:
    return await circulation_service.get_item_balance(db, item_id)


async def get_inventory(db: AsyncSession, inventory_id: int) -> Inventory:
    return await circulation_service.get_inventory(db, inventory_id)
