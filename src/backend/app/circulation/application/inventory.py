"""`Inventory` use cases for `app.circulation`."""

from __future__ import annotations

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


async def get_or_create_personal_inventory(db: AsyncSession, owner_user_id: int) -> Inventory:
    """Used by `app.party`'s Pledge->Reservation bridge — a guardian
    registering their first item doesn't need to have manually created an
    Inventory beforehand."""
    inventory = await repository.find_personal_inventory(db, owner_user_id)
    if inventory is not None:
        return inventory
    inventory = Inventory(
        owner_user_id=owner_user_id, inventory_type=InventoryType.PERSONAL, location=None
    )
    db.add(inventory)
    await db.flush()
    return inventory
