"""`Inventory` use cases for `app.circulation`."""

from __future__ import annotations

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.identity import (
    find_user_id_by_principal,
    get_user_id_by_principal,
)
from app.circulation.infrastructure import locations_acl, repository
from app.circulation.models import Account, AccountType, Inventory, InventoryType
from app.circulation.schemas import (
    CreateInventoryRequest,
    InventoryLocationResponse,
    SetInventoryLocationRequest,
)
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException


async def create_inventory(
    db: AsyncSession, owner_user_id: uuid.UUID, data: CreateInventoryRequest
) -> Inventory:
    inventory = Inventory(
        owner_user_id=owner_user_id, inventory_type=data.inventory_type, location=data.location
    )
    db.add(inventory)
    await db.flush()
    db.add(Account(account_type=AccountType.INVENTORY, inventory_id=inventory.id))
    await db.commit()
    await db.refresh(inventory)
    return inventory


async def get_inventory(db: AsyncSession, inventory_id: uuid.UUID) -> Inventory:
    inventory = await repository.get_inventory(db, inventory_id)
    if inventory is None:
        raise EntityNotFoundException("Inventory", inventory_id)
    return inventory


async def list_inventories(db: AsyncSession, owner_user_id: uuid.UUID | None) -> list[Inventory]:
    return await repository.list_inventories(db, owner_user_id)


async def get_or_create_personal_inventory(db: AsyncSession, owner_user_id: uuid.UUID) -> Inventory:
    """The user's PERSONAL inventory, created on first use (a recipient's
    first GIFT/SWAP needs no manually created Inventory). The
    check-then-insert below has a window where two near-simultaneous callers
    for the same user can both see "none exists" and both insert — migration
    `0033` adds a partial unique index on `(owner_user_id, inventory_type)`
    so the loser's insert raises `IntegrityError` instead of silently
    creating a duplicate; caught here via a `SAVEPOINT` (`begin_nested`) so
    only this insert rolls back, not the caller's wider transaction, then
    re-fetched to return the winner's row. The inventory's ledger account is
    inserted in the same `SAVEPOINT`, so a lost race rolls back both and the
    winner's row already has its account."""
    inventory = await repository.find_personal_inventory(db, owner_user_id)
    if inventory is not None:
        return inventory
    inventory = Inventory(
        owner_user_id=owner_user_id, inventory_type=InventoryType.PERSONAL, location=None
    )
    try:
        async with db.begin_nested():
            db.add(inventory)
            await db.flush()
            db.add(Account(account_type=AccountType.INVENTORY, inventory_id=inventory.id))
            await db.flush()
    except IntegrityError:
        inventory = await repository.find_personal_inventory(db, owner_user_id)
        if inventory is None:
            raise
    return inventory


async def get_my_inventory_location(
    db: AsyncSession, principal: Principal
) -> InventoryLocationResponse:
    """The caller's pickup place on their PERSONAL inventory; `None` without
    one. A place soft-deleted later still renders, with `deleted_at` set."""
    user_id = await find_user_id_by_principal(db, principal)
    inventory = None if user_id is None else await repository.find_personal_inventory(db, user_id)
    location_id = None if inventory is None else inventory.location_id
    return InventoryLocationResponse(location=await locations_acl.get_location_ref(db, location_id))


async def set_my_inventory_location(
    db: AsyncSession, principal: Principal, data: SetInventoryLocationRequest
) -> InventoryLocationResponse:
    """Sets (or with `None` clears) the caller's pickup place, validated
    against their own saved places: 404 unknown/soft-deleted, 403 foreign."""
    user_id = await get_user_id_by_principal(db, principal)
    location = None
    if data.location_id is not None:
        party_id = await repository.find_party_id_by_user_id(db, user_id)
        if party_id is None:
            raise EntityNotFoundException("UserProfile", principal.username)
        location = await locations_acl.get_owned_location(db, data.location_id, party_id)
    inventory = await get_or_create_personal_inventory(db, user_id)
    inventory.location_id = data.location_id
    await db.commit()
    return InventoryLocationResponse(location=location)
