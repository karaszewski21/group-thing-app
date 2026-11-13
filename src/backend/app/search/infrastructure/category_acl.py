"""Anti-corruption layer over `app.category`: the ONLY `app.search` module
that imports the category vertical. It exposes the `categories` table
(name, folded `path_text`, `parent_id`) for the matched-categories CTE, the
category filter's subtree and its existence check. It must not import
`..schemas`."""

from __future__ import annotations

from app.category.models import Category

__all__ = ["Category"]
