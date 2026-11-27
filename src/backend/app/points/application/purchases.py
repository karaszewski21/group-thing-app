"""POINTS purchases (spec R5–R7), flush-only, inside the caller's commit:
a take locks the accounts and posts HOLD, a confirm settles it as SALE, a
cancel gives it back as RELEASE. HOLD and RELEASE name the buyer as party
and the seller as counterparty, SALE the reverse."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.errors import BusinessConflictException
from app.points.application.config import load_config
from app.points.infrastructure import families_acl, users_acl
from app.points.infrastructure.ledger import (
    TRANSACTION_RULES,
    AccountKey,
    LedgerInvariantError,
    PointLine,
    account_balance,
    hold_credits_select,
    lock_accounts,
    post_points,
    source_key_exists,
    system_account_id,
)
from app.points.models import (
    PointAccountType,
    PointEntry,
    PointSourceType,
    PointTransaction,
    PointTransactionType,
)

INELIGIBLE_MESSAGE = "Za punkty mogą kupować tylko osoby z kontem."
FAMILY_MESSAGE = "Nie można kupować za punkty od członka własnej rodziny."
PAIR_LIMIT_MESSAGE = "Limit nagród dla tej pary został wyczerpany — spróbuj za kilka dni."
SHORT_BALANCE_MESSAGE = "Za mało punktów — ktoś był szybszy albo masz inne blokady."
SETTLED_MESSAGE = "Ta transakcja została już rozstrzygnięta"

_PARTY = PointAccountType.PARTY
_HELD = PointAccountType.HELD
_HOLD = PointTransactionType.HOLD
_SALE = PointTransactionType.SALE
_RELEASE = PointTransactionType.RELEASE
_RESERVATION = PointSourceType.RESERVATION


class PurchaseConflictException(BusinessConflictException):
    """A POINTS purchase refused for a user-facing reason (409)."""


@dataclass(frozen=True)
class Purchase:
    """A take's locked accounts and checked price, handed to `post_hold`."""

    buyer_party_id: uuid.UUID
    seller_party_id: uuid.UUID
    price: int
    accounts: dict[AccountKey, uuid.UUID]


@dataclass(frozen=True)
class _Hold:
    buyer_party_id: uuid.UUID
    seller_party_id: uuid.UUID
    price: int
    description: str


async def lock_owner_accounts(db: AsyncSession, party_id: uuid.UUID) -> None:
    """Locks the owner's PARTY account alone, ahead of the item row lock of a
    listing that becomes POINTS. The account is only the mutex of the
    `max_points_offers` count, nothing is posted to it, so the eligibility
    check `lock_accounts` leaves to its callers is skipped on purpose: an
    account it creates for a non-eligible owner stays at 0."""
    await lock_accounts(db, [(party_id, _PARTY)])


async def lock_purchase(
    db: AsyncSession, buyer_party_id: uuid.UUID, seller_party_id: uuid.UUID, price: int
) -> Purchase:
    """Checks that the buyer may pay `price` to the seller and locks the
    buyer's PARTY and HELD and the seller's PARTY accounts in one sorted
    call; the checks reading the ledger run under that lock."""
    eligible = await users_acl.eligible_persons(db, {buyer_party_id, seller_party_id})
    if buyer_party_id not in eligible or seller_party_id not in eligible:
        raise PurchaseConflictException(INELIGIBLE_MESSAGE)
    if await families_acl.share_active_family(db, buyer_party_id, seller_party_id):
        raise PurchaseConflictException(FAMILY_MESSAGE)

    accounts = await lock_accounts(
        db, [(buyer_party_id, _PARTY), (buyer_party_id, _HELD), (seller_party_id, _PARTY)]
    )
    config = await load_config(db)
    since = datetime.utcnow() - timedelta(days=config.pair_window_days)
    used = await used_pair_slots(
        db, buyer_party_id, seller_party_id, since=since
    ) + await _open_pair_holds(db, buyer_party_id, seller_party_id)
    if used >= config.pair_reward_limit:
        raise PurchaseConflictException(PAIR_LIMIT_MESSAGE)
    if await account_balance(db, accounts[(buyer_party_id, _PARTY)]) < price:
        raise PurchaseConflictException(SHORT_BALANCE_MESSAGE)
    return Purchase(buyer_party_id, seller_party_id, price, accounts)


async def post_hold(
    db: AsyncSession, purchase: Purchase, reservation_id: uuid.UUID, product_name: str
) -> None:
    """HOLD: the price moves from the buyer's PARTY to their HELD account."""
    buyer = purchase.buyer_party_id
    await post_points(
        db,
        transaction_type=_HOLD,
        source_id=reservation_id,
        party_id=buyer,
        counterparty_party_id=purchase.seller_party_id,
        cap_month=None,
        description=product_name,
        occurred_at=datetime.utcnow(),
        entries=[
            PointLine(purchase.accounts[(buyer, _PARTY)], -purchase.price),
            PointLine(purchase.accounts[(buyer, _HELD)], purchase.price),
        ],
    )


async def settle_sale(db: AsyncSession, reservation_id: uuid.UUID) -> None:
    """SALE at confirm: the held price is burnt and the seller credited the
    same amount from EMISSION. Skipped when already sold, 409 once released;
    nothing is re-checked and no award is posted."""
    hold = await _read_hold(db, reservation_id)
    accounts = await lock_accounts(
        db, [(hold.buyer_party_id, _HELD), (hold.seller_party_id, _PARTY)]
    )
    if await source_key_exists(db, _RELEASE, _RESERVATION, reservation_id):
        raise PurchaseConflictException(SETTLED_MESSAGE)
    if await source_key_exists(db, _SALE, _RESERVATION, reservation_id):
        return
    await post_points(
        db,
        transaction_type=_SALE,
        source_id=reservation_id,
        party_id=hold.seller_party_id,
        counterparty_party_id=hold.buyer_party_id,
        cap_month=None,
        description=hold.description,
        occurred_at=datetime.utcnow(),
        entries=[
            PointLine(accounts[(hold.buyer_party_id, _HELD)], -hold.price),
            PointLine(await system_account_id(db, PointAccountType.BURN), hold.price),
            PointLine(await system_account_id(db, PointAccountType.EMISSION), -hold.price),
            PointLine(accounts[(hold.seller_party_id, _PARTY)], hold.price),
        ],
    )


async def release_hold(db: AsyncSession, reservation_id: uuid.UUID) -> None:
    """RELEASE at cancel: the held price goes back to the buyer's PARTY
    account. Skipped when already released, 409 once sold."""
    hold = await _read_hold(db, reservation_id)
    buyer = hold.buyer_party_id
    accounts = await lock_accounts(db, [(buyer, _HELD), (buyer, _PARTY)])
    if await source_key_exists(db, _SALE, _RESERVATION, reservation_id):
        raise PurchaseConflictException(SETTLED_MESSAGE)
    if await source_key_exists(db, _RELEASE, _RESERVATION, reservation_id):
        return
    await post_points(
        db,
        transaction_type=_RELEASE,
        source_id=reservation_id,
        party_id=buyer,
        counterparty_party_id=hold.seller_party_id,
        cap_month=None,
        description=hold.description,
        occurred_at=datetime.utcnow(),
        entries=[
            PointLine(accounts[(buyer, _HELD)], -hold.price),
            PointLine(accounts[(buyer, _PARTY)], hold.price),
        ],
    )


async def lock_release_accounts(db: AsyncSession, reservation_ids: Collection[uuid.UUID]) -> None:
    """Locks every buyer's HELD and PARTY accounts of the reservations'
    HOLDs in one sorted call (one read), so a following `release_hold` per
    reservation never waits on an account lock."""
    if not reservation_ids:
        return
    buyers = (
        await db.scalars(
            select(PointTransaction.party_id).where(
                PointTransaction.transaction_type == _HOLD,
                PointTransaction.source_type == _RESERVATION,
                PointTransaction.source_id.in_(set(reservation_ids)),
            )
        )
    ).all()
    await lock_accounts(db, [(buyer, kind) for buyer in buyers for kind in (_HELD, _PARTY)])


async def used_pair_slots(db: AsyncSession, a: uuid.UUID, b: uuid.UUID, *, since: datetime) -> int:
    """The pair's pair-limited transactions (awards and SALE), in either
    direction, since `since`."""
    pair_limited = [t for t, rule in TRANSACTION_RULES.items() if rule.pair_limited]
    return int(
        await db.scalar(
            select(func.count())
            .select_from(PointTransaction)
            .where(
                PointTransaction.transaction_type.in_(pair_limited),
                _between(PointTransaction, a, b),
                PointTransaction.occurred_at >= since,
            )
        )
        or 0
    )


async def _open_pair_holds(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> int:
    """The pair's HOLDs of any age, in either direction, not yet settled by
    a SALE or a RELEASE of the same reservation."""
    settled = aliased(PointTransaction)
    return int(
        await db.scalar(
            select(func.count())
            .select_from(PointTransaction)
            .where(
                PointTransaction.transaction_type == _HOLD,
                _between(PointTransaction, a, b),
                ~select(settled.id)
                .where(
                    settled.transaction_type.in_([_SALE, _RELEASE]),
                    settled.source_type == _RESERVATION,
                    settled.source_id == PointTransaction.source_id,
                )
                .exists(),
            )
        )
        or 0
    )


def _between(
    transaction: type[PointTransaction], a: uuid.UUID, b: uuid.UUID
) -> ColumnElement[bool]:
    return or_(
        and_(transaction.party_id == a, transaction.counterparty_party_id == b),
        and_(transaction.party_id == b, transaction.counterparty_party_id == a),
    )


async def _read_hold(db: AsyncSession, reservation_id: uuid.UUID) -> _Hold:
    """The reservation's HOLD with its price (the HELD credit); a POINTS
    reservation without one breaks the ledger contract."""
    row = (
        await db.execute(
            hold_credits_select(
                [reservation_id],
                PointTransaction.party_id,
                PointTransaction.counterparty_party_id,
                PointTransaction.description,
                PointEntry.amount,
            )
        )
    ).one_or_none()
    if row is None or row.counterparty_party_id is None:
        raise LedgerInvariantError(f"No HOLD for POINTS reservation {reservation_id}")
    return _Hold(row.party_id, row.counterparty_party_id, int(row.amount), row.description)
