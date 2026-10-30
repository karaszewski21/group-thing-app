"""Anti-corruption layer over `app.circulation`: the ONLY `app.events`
module that imports the circulation vertical. It exposes the unexecuted
select of live AVAILABLE items with their product name, which the event
page joins with the listing preferences in one statement. It must not
import `..schemas`."""

from __future__ import annotations

from app.circulation.service import (
    available_items_with_product_select as available_items_select,
)

__all__ = ["available_items_select"]
