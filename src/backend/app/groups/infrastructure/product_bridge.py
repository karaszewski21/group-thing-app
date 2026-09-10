"""Anti-corruption layer over `app.product`: the ONLY `app.groups` module
that imports the product vertical for a *write-path* dependency.
`application/terms` validates a `NeededItem.product_id` through this thin
pass-through so an unknown id fails fast as a clean 404 rather than an FK
`IntegrityError` (wrong-semantics 409). The read-side product join lives in
`infrastructure/repository` (the `UserProfile` precedent)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.product import service as product_service
from app.product.models import Product

__all__ = ["get_product"]


async def get_product(db: AsyncSession, product_id: int) -> Product:
    return await product_service.get_product(db, product_id)
