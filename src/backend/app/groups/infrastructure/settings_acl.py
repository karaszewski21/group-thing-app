"""Anti-corruption layer over `app.settings`: the ONLY `app.groups` module
that imports the settings context."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.settings import service as settings_service


async def max_featured_items(db: AsyncSession) -> int:
    """How many listed items one owner may feature at once; 0 = off."""
    return await settings_service.max_featured_items(db)
