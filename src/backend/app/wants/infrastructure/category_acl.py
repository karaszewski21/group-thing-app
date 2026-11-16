"""Anti-corruption layer over `app.category`: the ONLY `app.wants` module
that imports the category vertical. It only re-exports the `Category`
entity; the wants queries build on its table. It must not import
`..schemas`."""

from __future__ import annotations

from app.category.models import Category

__all__ = ["Category"]
