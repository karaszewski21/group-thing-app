"""Read-only ACL over the item tables: the stored `points_value` and the
product name of the exchanged items. Ad-hoc Core refs, so points and
inventory never import each other's models (inventory reaches points
through its own `points_acl`)."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import SmallInteger, String, column, select, table
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

_UUID = postgresql.UUID(as_uuid=True)
_items = table(
    "inventory_items",
    column("id", _UUID),
    column("product_id", _UUID),
    column("points_value", SmallInteger),
)
_products = table("products", column("id", _UUID), column("name", String))


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
