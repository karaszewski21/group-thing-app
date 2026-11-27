"""Points ledger posting and account reads for `app.points`.

Every movement of points is one balanced `PointTransaction` posted in the
same commit as the event it records: an award (an exchange confirm, an
attendance close) moves points from the EMISSION account to PARTY
accounts; a POINTS purchase blocks the price on the buyer's HELD account
(HOLD) and later either settles it (SALE: the held points go to BURN and
the seller is credited from EMISSION) or gives it back (RELEASE).

Contract of the ledger:

- Append-only. `post_points` is the only code path that writes
  `point_transactions` and `point_entries`; rows are never updated or
  deleted. It only flushes; the calling use case commits.
- What a transaction type may do is declared once, in `TRANSACTION_RULES`:
  its source type, whether it uses a pair slot, whether it counts toward
  reputation, and the account types it may debit (`debits`, the negative
  entries) and credit (`credits`, the positive ones). `post_points` refuses
  an entry on any other account type, a zero amount and entries not summing
  to 0, all before anything is written.
- Balance check: no PARTY or HELD account may go below 0. For every such
  account a posting debits, `post_points` adds the posting's net amount to
  the account's balance read in the same session and refuses a negative
  result. The check is only sound while the caller holds the account's row
  lock from `lock_accounts`, which every poster takes first.
- One account per `(party_id, account_type)`: a person's PARTY account
  holds the available points, the HELD account the points blocked by open
  POINTS reservations. PARTY and HELD accounts are created lazily by
  `lock_accounts`; reads never create one. `lock_owner_accounts` (a
  listing becoming POINTS) is the one caller that skips the eligibility
  check: it uses the owner's PARTY account only as the mutex of the
  `max_points_offers` count and posts nothing, so the account it may
  create stays at 0. EMISSION (where awarded and sold
  points come from) and BURN (where spent points go) are single system
  accounts without a party, found by `system_account_id`.
- `(transaction_type, source_type, source_id)` is unique, so each posting
  happens at most once. Callers skip a source key that `source_key_exists`
  reports; the unique constraint (IntegrityError → 409) is the backstop for
  a concurrent post. A POINTS reservation's HOLD is settled by exactly one
  of SALE and RELEASE: each settling caller locks the buyer's accounts and
  checks the other type's source key before posting.
- Balance = SUM of an account's entries; reputation = SUM of a PARTY
  account's entries in the transaction types whose rule `counts_reputation`
  (GIVE_FREE). Neither is stored, and a person without an account has 0.
- Lock order: the reservation rows a step settles come first (in id
  order: a confirm, a cancel and an event deletion each lock them before
  any account, so a cancel racing a confirm or an event deletion waits on
  the reservation instead of deadlocking), then the point accounts (one
  sorted `lock_accounts` call per transaction step, inserted and locked in
  `(party_id, account_type)` order, so concurrent posters never deadlock
  on them), then the item rows, then the listing preference row. The take
  path is the one documented exception (event, then preference, then
  accounts): a path holding accounts and wanting a preference never meets
  a takeable POINTS item, and the reservation a take creates is new.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import Select, exists, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.points.models import (
    PointAccount,
    PointAccountType,
    PointEntry,
    PointSourceType,
    PointTransaction,
    PointTransactionType,
)

DESCRIPTION_MAX_LENGTH = 500


_EMISSION = PointAccountType.EMISSION
_PARTY = PointAccountType.PARTY
_HELD = PointAccountType.HELD
_BURN = PointAccountType.BURN
_BALANCE_CHECKED = frozenset({_PARTY, _HELD})
_SYSTEM_ACCOUNTS = frozenset({_EMISSION, _BURN})


@dataclass(frozen=True)
class TransactionRule:
    source_type: PointSourceType
    pair_limited: bool
    counts_reputation: bool
    debits: frozenset[PointAccountType]
    credits: frozenset[PointAccountType]


def _award(
    *, source_type: PointSourceType, pair_limited: bool, counts_reputation: bool
) -> TransactionRule:
    return TransactionRule(
        source_type=source_type,
        pair_limited=pair_limited,
        counts_reputation=counts_reputation,
        debits=frozenset({_EMISSION}),
        credits=frozenset({_PARTY}),
    )


TRANSACTION_RULES: dict[PointTransactionType, TransactionRule] = {
    PointTransactionType.GIVE_FREE: _award(
        source_type=PointSourceType.RESERVATION, pair_limited=True, counts_reputation=True
    ),
    PointTransactionType.EXCHANGE: _award(
        source_type=PointSourceType.RESERVATION, pair_limited=True, counts_reputation=False
    ),
    PointTransactionType.WISHLIST_MATCH: _award(
        source_type=PointSourceType.RESERVATION, pair_limited=True, counts_reputation=False
    ),
    PointTransactionType.ATTENDANCE: _award(
        source_type=PointSourceType.TERM_ATTENDANCE, pair_limited=False, counts_reputation=False
    ),
    # buyer / seller: the price leaves the buyer's PARTY account for HELD.
    PointTransactionType.HOLD: TransactionRule(
        source_type=PointSourceType.RESERVATION,
        pair_limited=False,
        counts_reputation=False,
        debits=frozenset({_PARTY}),
        credits=frozenset({_HELD}),
    ),
    # seller / buyer: the held price is burnt and the seller credited from EMISSION.
    PointTransactionType.SALE: TransactionRule(
        source_type=PointSourceType.RESERVATION,
        pair_limited=True,
        counts_reputation=False,
        debits=frozenset({_HELD, _EMISSION}),
        credits=frozenset({_BURN, _PARTY}),
    ),
    # buyer / seller: the held price goes back to the buyer's PARTY account.
    PointTransactionType.RELEASE: TransactionRule(
        source_type=PointSourceType.RESERVATION,
        pair_limited=False,
        counts_reputation=False,
        debits=frozenset({_HELD}),
        credits=frozenset({_PARTY}),
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
    transaction with them, flushed and not committed. A missing rule, no
    entries, a zero amount, entries not summing to 0, an entry on an account
    type the rule does not declare for its sign, or a debit taking a PARTY
    or HELD account below 0 raise `LedgerInvariantError` before anything is
    written. The caller holds the debited accounts' `lock_accounts` lock."""
    rule = TRANSACTION_RULES.get(transaction_type)
    if rule is None:
        raise LedgerInvariantError(f"No ledger rule for {transaction_type}")
    if not entries or any(line.amount == 0 for line in entries):
        raise LedgerInvariantError(f"Point entries must be non-zero: {entries}")
    if sum(line.amount for line in entries) != 0:
        raise LedgerInvariantError(f"Unbalanced point transaction: {entries}")
    types = await _require_account_types(db, transaction_type, rule, entries)
    await _require_balances(db, types, entries)

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
    db: AsyncSession,
    transaction_type: PointTransactionType,
    rule: TransactionRule,
    entries: Sequence[PointLine],
) -> dict[uuid.UUID, PointAccountType]:
    """Debits land only on the rule's `debits` account types, credits only
    on its `credits`; returns `{account_id: account_type}`."""
    types: dict[uuid.UUID, PointAccountType] = dict(
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
        declared = rule.debits if line.amount < 0 else rule.credits
        if account_type not in declared:
            raise LedgerInvariantError(
                f"{transaction_type} entry of {line.amount} on a {account_type} account, "
                f"expected one of {sorted(declared)}"
            )
    return types


async def _require_balances(
    db: AsyncSession,
    types: dict[uuid.UUID, PointAccountType],
    entries: Sequence[PointLine],
) -> None:
    """No debited PARTY or HELD account ends below 0, one query."""
    net: dict[uuid.UUID, int] = {}
    for line in entries:
        net[line.account_id] = net.get(line.account_id, 0) + line.amount
    checked = {
        account_id
        for account_id, amount in net.items()
        if amount < 0 and types[account_id] in _BALANCE_CHECKED
    }
    if not checked:
        return
    balances = dict(
        (
            await db.execute(
                select(PointEntry.account_id, func.sum(PointEntry.amount))
                .where(PointEntry.account_id.in_(checked))
                .group_by(PointEntry.account_id)
            )
        )
        .tuples()
        .all()
    )
    for account_id in sorted(checked):
        balance = int(balances.get(account_id) or 0)
        if balance + net[account_id] < 0:
            raise LedgerInvariantError(
                f"Debit of {-net[account_id]} exceeds the balance {balance} "
                f"of {types[account_id]} account {account_id}"
            )


def _truncate(description: str) -> str:
    if len(description) <= DESCRIPTION_MAX_LENGTH:
        return description
    return description[: DESCRIPTION_MAX_LENGTH - 1] + "…"


async def system_account_id(db: AsyncSession, account_type: PointAccountType) -> uuid.UUID:
    """The id of the single EMISSION or BURN account."""
    if account_type not in _SYSTEM_ACCOUNTS:
        raise LedgerInvariantError(f"{account_type} is not a system account")
    return (
        await db.execute(select(PointAccount.id).where(PointAccount.account_type == account_type))
    ).scalar_one()


AccountKey = tuple[uuid.UUID, PointAccountType]


async def lock_accounts(
    db: AsyncSession, keys: Iterable[AccountKey]
) -> dict[AccountKey, uuid.UUID]:
    """Creates the missing `(party_id, account_type)` accounts (PARTY or
    HELD) and locks all of them, both in `(party_id, account_type)` order;
    returns `{(party_id, account_type): account_id}` in that order. The
    caller checks that each party is an eligible person."""
    ordered = sorted(set(keys))
    if not ordered:
        return {}
    if any(account_type not in _BALANCE_CHECKED for _, account_type in ordered):
        raise LedgerInvariantError(f"Only PARTY and HELD accounts are per party: {ordered}")
    now = datetime.utcnow()
    await db.execute(
        insert(PointAccount)
        .values(
            [
                {
                    "id": uuid.uuid4(),
                    "account_type": account_type,
                    "party_id": party_id,
                    "created_at": now,
                    "updated_at": now,
                }
                for party_id, account_type in ordered
            ]
        )
        .on_conflict_do_nothing(index_elements=[PointAccount.party_id, PointAccount.account_type])
    )
    rows = (
        (
            await db.execute(
                select(PointAccount.party_id, PointAccount.account_type, PointAccount.id)
                .where(tuple_(PointAccount.party_id, PointAccount.account_type).in_(ordered))
                .order_by(PointAccount.party_id, PointAccount.account_type)
                .with_for_update()
            )
        )
        .tuples()
        .all()
    )
    return {
        (party_id, account_type): account_id
        for party_id, account_type, account_id in rows
        if party_id is not None
    }


def hold_credits_select(
    reservation_ids: Collection[uuid.UUID], *columns: InstrumentedAttribute[Any]
) -> Select[Any]:
    """`columns` of the reservations' HOLD transactions joined to their
    credit on the buyer's HELD account (the held price), unexecuted."""
    return (
        select(*columns)
        .join_from(PointTransaction, PointEntry, PointEntry.transaction_id == PointTransaction.id)
        .join(PointAccount, PointAccount.id == PointEntry.account_id)
        .where(
            PointTransaction.transaction_type == PointTransactionType.HOLD,
            PointTransaction.source_type == PointSourceType.RESERVATION,
            PointTransaction.source_id.in_(set(reservation_ids)),
            PointAccount.account_type == _HELD,
            PointEntry.amount > 0,
        )
    )


async def hold_amounts(
    db: AsyncSession, reservation_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, int]:
    """`{reservation_id: price}` from each reservation's HOLD credit on the
    buyer's HELD account, one query; reservations without a HOLD are left
    out, and an empty input runs no query."""
    if not reservation_ids:
        return {}
    rows = await db.execute(
        hold_credits_select(reservation_ids, PointTransaction.source_id, PointEntry.amount)
    )
    return {source_id: int(amount) for source_id, amount in rows.tuples()}


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
