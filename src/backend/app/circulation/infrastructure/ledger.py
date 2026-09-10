"""Points-ledger posting for `app.circulation` (the accounting subdomain).

Posting rule (`docs/system-wypozyczalni-inventory-accounting.md` §3): a
`CirculationTransaction` is created only when a `Reservation` reaches
`fulfilled`, and always credits the **current holder** of the item at that
moment — the party physically handing it onward — never `reserved_by` (the
recipient). This one rule unifies `lend`/`return`/`swap`/`gift` into a
single fulfillment code path instead of four bespoke branches for the
accounting half.

Posted amount is a flat `Decimal("1")` per transaction — points-worth
differentiation per product was deliberately descoped (see the
product-catalog unification plan); `Product` carries no points-value field.

`post_circulation` is the single entry point; it is the ONLY place a
`CirculationTransaction` is created.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.domain.constants import _EMISSION_ACCOUNT_CODE
from app.circulation.domain.reservation_rules import _next_transaction_number
from app.circulation.infrastructure import repository
from app.circulation.models import (
    Account,
    AccountType,
    CirculationEntry,
    CirculationTransaction,
    EntrySide,
)
from app.core.errors import EntityNotFoundException


async def get_or_create_user_balance_account(db: AsyncSession, user_id: int) -> Account:
    code = f"100-{user_id}"
    account = await repository.find_account_by_code(db, code)
    if account is not None:
        return account
    account = Account(
        code=code,
        name="Saldo punktow uzytkownika",
        account_type=AccountType.USER_BALANCE,
        owner_user_id=user_id,
    )
    db.add(account)
    await db.flush()
    return account


async def _get_emission_account(db: AsyncSession) -> Account:
    account = await repository.find_account_by_code(db, _EMISSION_ACCOUNT_CODE)
    if account is None:
        raise EntityNotFoundException("Account", _EMISSION_ACCOUNT_CODE)
    return account


async def post_circulation(
    db: AsyncSession, *, giver_user_id: int, amount: Decimal, description: str
) -> CirculationTransaction:
    giver_account = await get_or_create_user_balance_account(db, giver_user_id)
    emission_account = await _get_emission_account(db)

    today = datetime.utcnow().date()
    txn = CirculationTransaction(
        transaction_number=_next_transaction_number(),
        transaction_date=today,
        description=description,
        is_posted=True,
    )
    db.add(txn)
    await db.flush()

    db.add_all(
        [
            CirculationEntry(
                transaction_id=txn.id,
                account_id=giver_account.id,
                amount=amount,
                entry_side=EntrySide.DEBIT,
                description=description,
                entry_date=today,
            ),
            CirculationEntry(
                transaction_id=txn.id,
                account_id=emission_account.id,
                amount=amount,
                entry_side=EntrySide.CREDIT,
                description=f"Emisja punktow za obieg - {description}",
                entry_date=today,
            ),
        ]
    )
    return txn
