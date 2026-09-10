"""`Account` / `CirculationTransaction` read use cases for `app.circulation`.
The accounting/posting rules live in `app.circulation.infrastructure.ledger`."""

from __future__ import annotations

from decimal import Decimal
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.infrastructure import ledger, repository
from app.circulation.models import Account, CirculationTransaction, EntrySide
from app.core.errors import EntityNotFoundException


async def get_account_balance(db: AsyncSession, user_id: int) -> tuple[Account, Decimal]:
    account = await ledger.get_or_create_user_balance_account(db, user_id)
    await db.commit()
    entries = await repository.list_entries_for_account(db, cast(int, account.id))
    total = Decimal("0")
    for entry in entries:
        total += entry.amount if entry.entry_side == EntrySide.DEBIT else -entry.amount
    return account, total


async def get_transaction(db: AsyncSession, transaction_id: int) -> CirculationTransaction:
    """Full audit-trail read (doc's "Pełna historia" benefit) — always
    eager-loads `entries` + each entry's `account`, per
    `standards/backend/models.md`'s `lazy=\"raise\"` contract."""
    transaction = await repository.find_transaction_with_entries(db, transaction_id)
    if transaction is None:
        raise EntityNotFoundException("CirculationTransaction", transaction_id)
    return transaction


async def list_transactions_for_account(
    db: AsyncSession, account_id: int
) -> list[CirculationTransaction]:
    return await repository.list_transactions_for_account(db, account_id)
