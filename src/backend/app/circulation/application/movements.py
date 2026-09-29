"""Read use cases for the item-movement ledger of `app.circulation`."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.infrastructure import repository
from app.circulation.models import CirculationTransaction
from app.core.errors import EntityNotFoundException


async def get_transaction(db: AsyncSession, transaction_id: uuid.UUID) -> CirculationTransaction:
    """One movement with its entries, each entry's account and the
    account's inventory eager-loaded, per the `lazy="raise"` contract of
    `standards/backend/models.md`."""
    transaction = await repository.find_transaction_with_entries(db, transaction_id)
    if transaction is None:
        raise EntityNotFoundException("CirculationTransaction", transaction_id)
    return transaction
