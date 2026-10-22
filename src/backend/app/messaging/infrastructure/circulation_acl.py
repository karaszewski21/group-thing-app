"""Anti-corruption layer over `app.circulation`: the ONLY `app.messaging`
module that imports the circulation context. Item lookups include
soft-deleted items. Must not import `..schemas` (cycle)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.models import InventoryItem
from app.circulation.service import (
    find_item_including_deleted,
    list_item_refs,
    resolve_owning_inventory,
)

from . import users_acl

__all__ = [
    "InventoryItem",
    "find_item_including_deleted",
    "get_owner_party_id",
    "list_item_refs",
]


async def get_owner_party_id(db: AsyncSession, item: InventoryItem) -> uuid.UUID:
    """The party of the item's *permanent* owner (`home_inventory_id` while
    lent out), soft-deleted items included."""
    inventory = await resolve_owning_inventory(db, item)
    return await users_acl.get_party_id_by_account_user_id(db, inventory.owner_user_id)
