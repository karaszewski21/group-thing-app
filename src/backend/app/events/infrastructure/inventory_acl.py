"""Anti-corruption layer over `app.inventory`: the ONLY `app.events`
module that imports the inventory vertical. It exposes the unexecuted
select of live listable (AVAILABLE, RESERVED or IN_TRANSIT) items with their
product name and reserver, which the event page joins with the listing
preferences in one statement. It must not import `..schemas`."""

from __future__ import annotations

from app.inventory.service import (
    listed_items_with_product_select as listed_items_select,
)

__all__ = ["listed_items_select"]
