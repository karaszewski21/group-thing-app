"""Anti-corruption layer over `app.product`: the ONLY `app.pages` module that
imports the product vertical. It exposes the batched first-approved-photo
lookup for the owner pages' item thumbnails. It must not import
`..schemas`."""

from __future__ import annotations

from app.product.service import first_approved_photo_by_product

__all__ = ["first_approved_photo_by_product"]
