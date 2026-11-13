"""Anti-corruption layer over `app.product`: the ONLY `app.search` module
that imports the product vertical. It exposes the `products` table (name,
category and the generated `search_vector`, read only inside search SQL)
and the batched first-approved-photo lookup for the item thumbnails. It
must not import `..schemas`."""

from __future__ import annotations

from app.product.models import Product
from app.product.service import first_approved_photo_by_product

__all__ = ["Product", "first_approved_photo_by_product"]
