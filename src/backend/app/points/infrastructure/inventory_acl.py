"""Read-only ACL over the item tables: the stored `points_value` and the
product name of the exchanged items, and an item's owner and value for the
owner-only price range. Ad-hoc Core refs, so points and
inventory never import each other's models (inventory reaches points
through its own `points_acl`)."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import DateTime, SmallInteger, String, column, select, table
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

_UUID = postgresql.UUID(as_uuid=True)
_items = table(
    "inventory_items",
    column("id", _UUID),
    column("product_id", _UUID),
    column("points_value", SmallInteger),
    column("owner_inventory_id", _UUID),
    column("deleted_at", DateTime),
)
_products = table("products", column("id", _UUID), column("name", String))
_inventories = table("inventories", column("id", _UUID), column("owner_user_id", _UUID))


@dataclass(frozen=True)
class ExchangedItem:
    points_value: int | None
    product_name: str


async def exchanged_items(
    db: AsyncSession, item_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, ExchangedItem]:
    rows = (
        await db.execute(
            select(_items.c.id, _items.c.points_value, _products.c.name)
            .join_from(_items, _products, _products.c.id == _items.c.product_id)
            .where(_items.c.id.in_(set(item_ids)))
        )
    ).tuples()
    return {item_id: ExchangedItem(value, name) for item_id, value, name in rows}


@dataclass(frozen=True)
class OwnedItem:
    owner_user_id: uuid.UUID
    points_value: int | None


async def owned_item(db: AsyncSession, item_id: uuid.UUID) -> OwnedItem | None:
    """The owning user (via `owner_inventory_id`, as inventory's own edit
    gate) and the stored value of a live item; `None` when unknown or
    deleted."""
    row = (
        await db.execute(
            select(_inventories.c.owner_user_id, _items.c.points_value)
            .join_from(_items, _inventories, _inventories.c.id == _items.c.owner_inventory_id)
            .where(_items.c.id == item_id, _items.c.deleted_at.is_(None))
        )
    ).one_or_none()
    return None if row is None else OwnedItem(row.owner_user_id, row.points_value)
