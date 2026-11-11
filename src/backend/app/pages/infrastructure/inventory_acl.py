"""Anti-corruption layer over `app.inventory`: the ONLY `app.pages` module
that imports the inventory vertical. It exposes the select of listed items
(live AVAILABLE, RESERVED or IN_TRANSIT items with their product) that the
owner pages join with groups' pending proposer. It must not import
`..schemas`."""

from __future__ import annotations

from app.inventory.service import listed_items_with_product_select

__all__ = ["listed_items_with_product_select"]
