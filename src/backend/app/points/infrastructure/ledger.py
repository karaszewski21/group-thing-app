"""Points ledger posting and account reads for `app.points`.

Every award is one balanced `PointTransaction`: a debit on the EMISSION
account and credits on the beneficiaries' PARTY accounts, posted in the
same commit as the event it rewards (an exchange confirm, an attendance
close).

Contract of the ledger:

- Append-only. `post_points` is the only code path that writes
  `point_transactions` and `point_entries`; rows are never updated or
  deleted. It only flushes; the calling use case commits.
- What a transaction type may do is declared once, in `TRANSACTION_RULES`:
  its source type, whether it uses a pair slot, whether it counts toward
  reputation and which account type is debited. In stage 1 only EMISSION is
  ever debited, so no PARTY balance can drop below 0; `post_points` refuses
  any debit of a PARTY account.
- `(transaction_type, source_type, source_id)` is unique, so each award is
  posted at most once. Callers skip a source key that `source_key_exists`
  reports; the unique constraint (IntegrityError → 409) is the backstop for
  a concurrent post.
- Balance = SUM of an account's entries; reputation = SUM of its entries in
  the transaction types whose rule `counts_reputation` (GIVE_FREE). Neither
  is stored, and a person without an account has 0 of both.
- PARTY accounts are created lazily by `lock_accounts`, inserted and locked
  in party-id order, so concurrent posters never deadlock on them. Reads
  never create an account.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.points.models import (
    PointAccount,
    PointAccountType,
    PointEntry,
    PointSourceType,
    PointTransaction,
    PointTransactionType,
)

DESCRIPTION_MAX_LENGTH = 500


@dataclass(frozen=True)
class TransactionRule:
    source_type: PointSourceType
    pair_limited: bool
    counts_reputation: bool
    debits: PointAccountType


TRANSACTION_RULES: dict[PointTransactionType, TransactionRule] = {
    PointTransactionType.GIVE_FREE: TransactionRule(
        source_type=PointSourceType.RESERVATION,
        pair_limited=True,
        counts_reputation=True,
        debits=PointAccountType.EMISSION,
    ),
    PointTransactionType.EXCHANGE: TransactionRule(
        source_type=PointSourceType.RESERVATION,
        pair_limited=True,
        counts_reputation=False,
        debits=PointAccountType.EMISSION,
    ),
    PointTransactionType.WISHLIST_MATCH: TransactionRule(
        source_type=PointSourceType.RESERVATION,
        pair_limited=True,
        counts_reputation=False,
        debits=PointAccountType.EMISSION,
    ),
    PointTransactionType.ATTENDANCE: TransactionRule(
        source_type=PointSourceType.TERM_ATTENDANCE,
        pair_limited=False,
        counts_reputation=False,
        debits=PointAccountType.EMISSION,
    ),
}


@dataclass(frozen=True)
class PointLine:
    """One entry to post: `amount` (non-zero, negative = debit) on `account_id`."""

    account_id: uuid.UUID
    amount: int


class LedgerInvariantError(RuntimeError):
    """A posting that breaks the ledger contract: a programming error, so
    it surfaces as a logged 500, never as a client-facing 400."""


async def post_points(
    db: AsyncSession,
    *,
    transaction_type: PointTransactionType,
    source_id: uuid.UUID,
    party_id: uuid.UUID,
    counterparty_party_id: uuid.UUID | None,
    cap_month: date | None,
    description: str,
    occurred_at: datetime,
    entries: Sequence[PointLine],
) -> PointTransaction:
    """Validates the entries against the type's rule and posts one
    transaction with them, flushed and not committed. A missing rule, a zero
    amount, entries not summing to 0, or a debit on an account of another
    type than the rule's (never PARTY) raise `LedgerInvariantError` before
    anything is written."""
    rule = TRANSACTION_RULES.get(transaction_type)
    if rule is None:
        raise LedgerInvariantError(f"No ledger rule for {transaction_type}")
    if rule.debits == PointAccountType.PARTY:
        raise LedgerInvariantError("Stage 1 never debits a PARTY account")
    if not entries or any(line.amount == 0 for line in entries):
        raise LedgerInvariantError(f"Point entries must be non-zero: {entries}")
    if sum(line.amount for line in entries) != 0:
        raise LedgerInvariantError(f"Unbalanced point transaction: {entries}")
    await _require_account_types(db, rule, entries)

    transaction = PointTransaction(
        transaction_type=transaction_type,
        source_type=rule.source_type,
        source_id=source_id,
        party_id=party_id,
        counterparty_party_id=counterparty_party_id,
        cap_month=cap_month,
        description=_truncate(description),
        occurred_at=occurred_at,
    )
    db.add(transaction)
    await db.flush()
    db.add_all(
        PointEntry(transaction_id=transaction.id, account_id=line.account_id, amount=line.amount)
        for line in entries
    )
    await db.flush()
    return transaction


async def _require_account_types(
    db: AsyncSession, rule: TransactionRule, entries: Sequence[PointLine]
) -> None:
    """Debits land only on the rule's debited account type, credits only on
    PARTY accounts."""
    types = dict(
        (
            await db.execute(
                select(PointAccount.id, PointAccount.account_type).where(
                    PointAccount.id.in_({line.account_id for line in entries})
                )
            )
        )
        .tuples()
        .all()
    )
    for line in entries:
        account_type = types.get(line.account_id)
        if account_type is None:
            raise LedgerInvariantError(f"Unknown point account {line.account_id}")
        expected = rule.debits if line.amount < 0 else PointAccountType.PARTY
        if account_type != expected:
            raise LedgerInvariantError(
                f"Entry of {line.amount} on a {account_type} account, expected {expected}"
            )


def _truncate(description: str) -> str:
    if len(description) <= DESCRIPTION_MAX_LENGTH:
        return description
    return description[: DESCRIPTION_MAX_LENGTH - 1] + "…"


async def emission_account_id(db: AsyncSession) -> uuid.UUID:
    return (
        await db.execute(
            select(PointAccount.id).where(PointAccount.account_type == PointAccountType.EMISSION)
        )
    ).scalar_one()


async def lock_accounts(
    db: AsyncSession, party_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    """Creates the missing PARTY accounts and locks all of them, both in
    party-id order; returns `{party_id: account_id}` in that order. The
    caller checks that each party is an eligible person."""
    ordered = sorted(set(party_ids))
    if not ordered:
        return {}
    now = datetime.utcnow()
    await db.execute(
        insert(PointAccount)
        .values(
            [
                {
                    "id": uuid.uuid4(),
                    "account_type": PointAccountType.PARTY,
                    "party_id": party_id,
                    "created_at": now,
                    "updated_at": now,
                }
                for party_id in ordered
            ]
        )
        .on_conflict_do_nothing(index_elements=[PointAccount.party_id])
    )
    rows = (
        (
            await db.execute(
                select(PointAccount.party_id, PointAccount.id)
                .where(PointAccount.party_id.in_(ordered))
                .order_by(PointAccount.party_id)
                .with_for_update()
            )
        )
        .tuples()
        .all()
    )
    return {party_id: account_id for party_id, account_id in rows if party_id is not None}


async def existing_source_ids(
    db: AsyncSession,
    transaction_type: PointTransactionType,
    source_type: PointSourceType,
    source_ids: Collection[uuid.UUID],
) -> set[uuid.UUID]:
    """The `source_ids` already posted under the source key, one query."""
    if not source_ids:
        return set()
    rows = await db.scalars(
        select(PointTransaction.source_id).where(
            PointTransaction.transaction_type == transaction_type,
            PointTransaction.source_type == source_type,
            PointTransaction.source_id.in_(set(source_ids)),
        )
    )
    return set(rows.all())


async def source_key_exists(
    db: AsyncSession,
    transaction_type: PointTransactionType,
    source_type: PointSourceType,
    source_id: uuid.UUID,
) -> bool:
    return bool(
        await db.scalar(
            select(
                exists().where(
                    PointTransaction.transaction_type == transaction_type,
                    PointTransaction.source_type == source_type,
                    PointTransaction.source_id == source_id,
                )
            )
        )
    )


async def account_balance(db: AsyncSession, account_id: uuid.UUID) -> int:
    return int(
        await db.scalar(
            select(func.coalesce(func.sum(PointEntry.amount), 0)).where(
                PointEntry.account_id == account_id
            )
        )
        or 0
    )


async def account_reputation(db: AsyncSession, account_id: uuid.UUID) -> int:
    reputation_types = [t for t, rule in TRANSACTION_RULES.items() if rule.counts_reputation]
    return int(
        await db.scalar(
            select(func.coalesce(func.sum(PointEntry.amount), 0))
            .join(PointTransaction, PointTransaction.id == PointEntry.transaction_id)
            .where(
                PointEntry.account_id == account_id,
                PointTransaction.transaction_type.in_(reputation_types),
            )
        )
        or 0
    )
