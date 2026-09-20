"""`Inventory` use cases for `app.circulation`."""

from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.infrastructure import repository
from app.circulation.models import Inventory, InventoryType
from app.circulation.schemas import CreateInventoryRequest
from app.core.errors import EntityNotFoundException


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
    inventory = await repository.get_inventory(db, inventory_id)
    if inventory is None:
        raise EntityNotFoundException("Inventory", inventory_id)
    return inventory


async def list_inventories(db: AsyncSession, owner_user_id: int | None) -> list[Inventory]:
    return await repository.list_inventories(db, owner_user_id)


async def _get_or_create_inventory(
    db: AsyncSession, owner_user_id: int, inventory_type: InventoryType
) -> Inventory:
    """Shared body for `get_or_create_personal_inventory`/
    `get_or_create_virtual_inventory`. The check-then-insert below has a
    window where two near-simultaneous callers for the same
    `(owner_user_id, inventory_type)` can both see "none exists" and both
    insert — migration `0033` adds a partial unique index on exactly this
    pair (for PERSONAL/VIRTUAL) so the loser's insert raises
    `IntegrityError` instead of silently creating a duplicate; caught here
    via a `SAVEPOINT` (`begin_nested`) so only this insert rolls back, not
    the caller's wider transaction, then re-fetched to return the winner's
    row."""
    find = repository.find_personal_inventory if inventory_type == InventoryType.PERSONAL else repository.find_virtual_inventory
    inventory = await find(db, owner_user_id)
    if inventory is not None:
        return inventory
    inventory = Inventory(owner_user_id=owner_user_id, inventory_type=inventory_type, location=None)
    try:
        async with db.begin_nested():
            db.add(inventory)
            await db.flush()
    except IntegrityError:
        inventory = await find(db, owner_user_id)
        if inventory is None:
            raise
    return inventory


async def get_or_create_personal_inventory(db: AsyncSession, owner_user_id: int) -> Inventory:
    """Used by `app.party`'s Pledge->Reservation bridge — a guardian
    registering their first item doesn't need to have manually created an
    Inventory beforehand."""
    return await _get_or_create_inventory(db, owner_user_id, InventoryType.PERSONAL)


async def get_or_create_virtual_inventory(db: AsyncSession, owner_user_id: int) -> Inventory:
    """A borrower's holding place for items lent to them — auto-provisioned
    on first loan, mirroring `get_or_create_personal_inventory`. Used by
    `application/reservation_transitions.py`'s LEND fulfillment branch."""
    return await _get_or_create_inventory(db, owner_user_id, InventoryType.VIRTUAL)
