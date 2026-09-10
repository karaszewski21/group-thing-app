"""`InventoryItem` use cases for `app.circulation`, plus the ownership
gate guarding the edit/delete surface (co-located with the mutations it
guards, per `standards/backend/security.md`)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.identity import get_user_id_by_principal
from app.circulation.application.inventory import get_inventory
from app.circulation.infrastructure import repository
from app.circulation.models import (
    BalanceStatus,
    InventoryBalance,
    InventoryItem,
    ItemCondition,
)
from app.circulation.schemas import UpdateInventoryItemRequest
from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.product import service as product_service


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
    item = await repository.get_item(db, item_id)
    if item is None:
        raise EntityNotFoundException("InventoryItem", item_id)
    if item.deleted_at is not None:
        raise EntityNotFoundException("InventoryItem", item_id)
    return item


async def list_items(db: AsyncSession, inventory_id: int) -> list[InventoryItem]:
    return await repository.list_items_for_inventory(db, inventory_id)


async def get_item_balance(db: AsyncSession, item_id: int) -> InventoryBalance:
    balance = await repository.find_item_balance(db, item_id)
    if balance is None:
        raise EntityNotFoundException("InventoryBalance", item_id)
    return balance


async def _require_item_owner(
    db: AsyncSession, item_id: int, principal: Principal
) -> InventoryItem:
    """Ownership gate for the edit/delete surface: only the owner of the
    inventory holding an item may mutate it. Circulation deals in raw
    `users.id` (see `get_user_id_by_principal`), never `party_id`."""
    acting_user_id = await get_user_id_by_principal(db, principal)
    item = await get_item(db, item_id)
    inventory = await get_inventory(db, item.inventory_id)
    if inventory.owner_user_id != acting_user_id:
        raise AccessDeniedException
    return item


async def update_item(
    db: AsyncSession, item_id: int, principal: Principal, data: UpdateInventoryItemRequest
) -> InventoryItem:
    """PATCH an item's `condition`. Allowed regardless of the item's
    `InventoryBalance` status — a reserved or lent item can still have its
    condition corrected."""
    item = await _require_item_owner(db, item_id, principal)
    if data.product_id is not None and data.product_id != item.product_id:
        await product_service.get_product(db, data.product_id)
        item.product_id = data.product_id
    if data.condition is not None:
        item.condition = data.condition
    await db.commit()
    await db.refresh(item)
    return item


async def soft_delete_item(db: AsyncSession, item_id: int, principal: Principal) -> None:
    """Soft-delete an item (sets `deleted_at`). Blocked with a 409 when the
    item's balance is not `AVAILABLE` — a reserved/in-transit/lent item
    can't be withdrawn from circulation. The 1:1 `InventoryBalance` row is
    left in place."""
    item = await _require_item_owner(db, item_id, principal)
    balance = await get_item_balance(db, item_id)
    if balance.status != BalanceStatus.AVAILABLE:
        raise BusinessConflictException(
            "Nie można usunąć — rzecz jest zarezerwowana lub wypożyczona"
        )
    item.deleted_at = datetime.utcnow()
    await db.commit()
