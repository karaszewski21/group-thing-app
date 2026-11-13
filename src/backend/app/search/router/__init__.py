"""`/api/public/search` route of the global search.

Exposes the single `router` object (`from app.search.router import router`).
"""

from __future__ import annotations

from app.search.router.search import router

__all__ = ["router"]
