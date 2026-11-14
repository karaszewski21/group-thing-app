"""Anti-corruption layer over `app.inventory`: the ONLY `app.search` module
that imports the inventory vertical. It exposes the select of listed items
(live AVAILABLE, RESERVED or IN_TRANSIT items with their product), the
date of an item's newest open reservation, the item table (for an item's
place), the item condition and the balance status types. It
must not import `..schemas`."""

from __future__ import annotations

from app.inventory.models import BalanceStatus, InventoryItem, ItemCondition
from app.inventory.service import (
    listed_items_with_product_select,
    newest_open_reservation_starts_at,
)

__all__ = [
    "BalanceStatus",
    "InventoryItem",
    "ItemCondition",
    "listed_items_with_product_select",
    "newest_open_reservation_starts_at",
]
