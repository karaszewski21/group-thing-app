"""Anti-corruption layer over `app.circulation`: the ONLY `app.groups`
module that imports the circulation vertical. `application/pledge_fulfillment`
drives the Pledge->Reservation bridge exclusively through these thin
pass-throughs, and reads `ReservationStatus` from here rather than
importing circulation models directly."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation import service as circulation_service
from app.circulation.models import Inventory, InventoryItem, Reservation, ReservationStatus

__all__ = [
    "ReservationStatus",
    "create_lend_reservation",
    "get_or_create_personal_inventory",
    "get_reservation",
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


async def get_reservation(db: AsyncSession, reservation_id: int) -> Reservation:
    return await circulation_service.get_reservation(db, reservation_id)
