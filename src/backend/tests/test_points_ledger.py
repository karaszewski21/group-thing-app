"""Points ledger tests for `app.points`: the declared transaction rules,
`post_points` validation (declared account types, the balance check) and
posting, the lazily created and locked per-type accounts, the system
accounts and HOLD amounts, balance/reputation reads, the source-key
idempotency backstop, the single-writer guard and the shared
`mapped_transaction_conflicts` helper."""

from __future__ import annotations

import ast
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, cast

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError
from starlette.requests import Request

from app.core.errors import integrity_error_handler
from app.db import mapped_transaction_conflicts
from app.party.models import Party, PartyType
from app.points.application.config import load_config
from app.points.infrastructure.ledger import (
    TRANSACTION_RULES,
    LedgerInvariantError,
    PointLine,
    TransactionRule,
    account_balance,
    account_reputation,
    hold_amounts,
    lock_accounts,
    post_points,
    source_key_exists,
    system_account_id,
)
from app.points.models import (
    PointAccount,
    PointAccountType,
    PointSourceType,
    PointTransactionType,
)
from tests.conftest import pg_error
from tests.point_ledger_assertions import (
    assert_point_transactions_balanced,
    point_row_counts,
    transactions_for_party,
)

_APP_ROOT = Path(__file__).resolve().parents[1] / "app"
_LEDGER = _APP_ROOT / "points" / "infrastructure" / "ledger.py"

PARTY = PointAccountType.PARTY
HELD = PointAccountType.HELD
EMISSION = PointAccountType.EMISSION
BURN = PointAccountType.BURN
RESERVATION = PointSourceType.RESERVATION


async def _persons(db: AsyncSession, n: int) -> list[uuid.UUID]:
    parties = [Party(party_type=PartyType.PERSON) for _ in range(n)]
    db.add_all(parties)
    await db.flush()
    return [cast(uuid.UUID, party.id) for party in parties]


async def _post(
    db: AsyncSession,
    transaction_type: PointTransactionType,
    party_id: uuid.UUID,
    counterparty_party_id: uuid.UUID | None,
    entries: list[PointLine],
    *,
    source_id: uuid.UUID | None = None,
    description: str = "Rowerek",
) -> Any:
    attendance = transaction_type == PointTransactionType.ATTENDANCE
    return await post_points(
        db,
        transaction_type=transaction_type,
        source_id=source_id or uuid.uuid4(),
        party_id=party_id,
        counterparty_party_id=counterparty_party_id,
        cap_month=date(2026, 11, 1) if attendance else None,
        description=description,
        occurred_at=datetime.utcnow(),
        entries=entries,
    )


async def _post_gift(
    db: AsyncSession,
    giver_account_id: uuid.UUID,
    giver: uuid.UUID,
    recipient: uuid.UUID,
    value: int,
    *,
    source_id: uuid.UUID | None = None,
    description: str = "Rowerek",
) -> Any:
    emission = await system_account_id(db, EMISSION)
    return await _post(
        db,
        PointTransactionType.GIVE_FREE,
        giver,
        recipient,
        [PointLine(emission, -value), PointLine(giver_account_id, value)],
        source_id=source_id,
        description=description,
    )


def _rule(
    source_type: PointSourceType,
    pair_limited: bool,
    counts_reputation: bool,
    debits: set[PointAccountType],
    credits: set[PointAccountType],
) -> TransactionRule:
    return TransactionRule(
        source_type=source_type,
        pair_limited=pair_limited,
        counts_reputation=counts_reputation,
        debits=frozenset(debits),
        credits=frozenset(credits),
    )


def test_transactionRules_everyType_declaresDebitsCreditsAndParties() -> None:
    expected = {
        PointTransactionType.GIVE_FREE: _rule(RESERVATION, True, True, {EMISSION}, {PARTY}),
        PointTransactionType.EXCHANGE: _rule(RESERVATION, True, False, {EMISSION}, {PARTY}),
        PointTransactionType.WISHLIST_MATCH: _rule(RESERVATION, True, False, {EMISSION}, {PARTY}),
        PointTransactionType.ATTENDANCE: _rule(
            PointSourceType.TERM_ATTENDANCE, False, False, {EMISSION}, {PARTY}
        ),
        PointTransactionType.HOLD: _rule(RESERVATION, False, False, {PARTY}, {HELD}),
        PointTransactionType.SALE: _rule(RESERVATION, True, False, {HELD, EMISSION}, {BURN, PARTY}),
        PointTransactionType.RELEASE: _rule(RESERVATION, False, False, {HELD}, {PARTY}),
    }
    assert expected == TRANSACTION_RULES
    assert set(TRANSACTION_RULES) == set(PointTransactionType)


async def test_lockAccounts_partyAndHeld_createsOneAccountPerType(
    db_session: AsyncSession,
) -> None:
    low, high = sorted(await _persons(db_session, 2))
    assert await lock_accounts(db_session, []) == {}

    accounts = await lock_accounts(
        db_session, [(high, HELD), (low, PARTY), (high, PARTY), (low, PARTY)]
    )

    assert list(accounts) == [(low, PARTY), (high, HELD), (high, PARTY)]
    assert len(set(accounts.values())) == 3
    assert await lock_accounts(db_session, [(high, PARTY), (high, HELD)]) == {
        (high, HELD): accounts[(high, HELD)],
        (high, PARTY): accounts[(high, PARTY)],
    }
    (low_held,) = (await lock_accounts(db_session, [(low, HELD)])).values()
    assert low_held not in accounts.values()
    stored = (
        (
            await db_session.execute(
                select(PointAccount.party_id, PointAccount.account_type, PointAccount.id).where(
                    PointAccount.party_id.in_([low, high])
                )
            )
        )
        .tuples()
        .all()
    )
    assert {(party, account_type): id_ for party, account_type, id_ in stored} == {
        **accounts,
        (low, HELD): low_held,
    }
    assert len(stored) == 4


async def test_systemAccountIdAndHoldAmounts_seededAccountsAndPostedHolds_returnThem(
    db_session: AsyncSession,
) -> None:
    emission = await system_account_id(db_session, EMISSION)
    burn = await system_account_id(db_session, BURN)
    assert emission != burn
    with pytest.raises(LedgerInvariantError):
        await system_account_id(db_session, PARTY)
    # An empty input answers without touching the session.
    assert await hold_amounts(cast(AsyncSession, object()), []) == {}

    buyer, seller = await _persons(db_session, 2)
    accounts = await lock_accounts(db_session, [(buyer, PARTY), (buyer, HELD)])
    await _post_gift(db_session, accounts[(buyer, PARTY)], buyer, seller, 60)
    first, second, unknown = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    for reservation_id, price in ((first, 20), (second, 30)):
        await _post(
            db_session,
            PointTransactionType.HOLD,
            buyer,
            seller,
            [
                PointLine(accounts[(buyer, PARTY)], -price),
                PointLine(accounts[(buyer, HELD)], price),
            ],
            source_id=reservation_id,
        )

    assert await hold_amounts(db_session, [first, second, unknown]) == {first: 20, second: 30}


async def test_postPoints_holdSaleAndRelease_writesRowsAndBalanceEqualsSum(
    db_session: AsyncSession,
) -> None:
    buyer, seller, other = await _persons(db_session, 3)
    accounts = await lock_accounts(
        db_session, [(buyer, PARTY), (buyer, HELD), (seller, PARTY), (other, PARTY)]
    )
    buyer_party, buyer_held = accounts[(buyer, PARTY)], accounts[(buyer, HELD)]
    seller_party = accounts[(seller, PARTY)]
    emission = await system_account_id(db_session, EMISSION)
    burn = await system_account_id(db_session, BURN)
    burnt_before = await account_balance(db_session, burn)
    await _post_gift(db_session, buyer_party, buyer, other, 100)
    sold, released = uuid.uuid4(), uuid.uuid4()

    for reservation_id in (sold, released):
        await _post(
            db_session,
            PointTransactionType.HOLD,
            buyer,
            seller,
            [PointLine(buyer_party, -40), PointLine(buyer_held, 40)],
            source_id=reservation_id,
        )
    sale = await _post(
        db_session,
        PointTransactionType.SALE,
        seller,
        buyer,
        [
            PointLine(buyer_held, -40),
            PointLine(burn, 40),
            PointLine(emission, -40),
            PointLine(seller_party, 40),
        ],
        source_id=sold,
    )
    await _post(
        db_session,
        PointTransactionType.RELEASE,
        buyer,
        seller,
        [PointLine(buyer_held, -40), PointLine(buyer_party, 40)],
        source_id=released,
    )

    assert sale.source_type == RESERVATION
    await assert_point_transactions_balanced(db_session)
    assert await account_balance(db_session, buyer_party) == 60
    assert await account_balance(db_session, buyer_held) == 0
    assert await account_balance(db_session, seller_party) == 40
    assert await account_reputation(db_session, seller_party) == 0
    assert await account_balance(db_session, burn) == burnt_before + 40


async def test_postPoints_balancedGiftAndExchange_writesRowsAndBalanceEqualsSum(
    db_session: AsyncSession,
) -> None:
    low, high = sorted(await _persons(db_session, 2))
    accounts = await lock_accounts(db_session, [(high, PARTY), (low, PARTY), (high, PARTY)])
    assert list(accounts) == [(low, PARTY), (high, PARTY)]
    assert await lock_accounts(db_session, [(low, PARTY), (high, PARTY)]) == accounts
    low_account, high_account = accounts[(low, PARTY)], accounts[(high, PARTY)]
    emission = await system_account_id(db_session, EMISSION)

    gift = await _post_gift(db_session, low_account, low, high, 40, description="R" * 600)
    await _post(
        db_session,
        PointTransactionType.EXCHANGE,
        low,
        high,
        [PointLine(emission, -20), PointLine(low_account, 10), PointLine(high_account, 10)],
        description="Kask ↔ Rowerek",
    )
    await _post(
        db_session,
        PointTransactionType.ATTENDANCE,
        high,
        None,
        [PointLine(emission, -20), PointLine(high_account, 20)],
        description="Krąg",
    )

    assert gift.source_type == RESERVATION
    assert len(gift.description) == 500 and gift.description.endswith("…")
    await assert_point_transactions_balanced(db_session)
    assert len(await transactions_for_party(db_session, low)) == 2
    assert await account_balance(db_session, low_account) == 50
    assert await account_reputation(db_session, low_account) == 40
    assert await account_balance(db_session, high_account) == 30
    assert await account_reputation(db_session, high_account) == 0
    stored = (
        (
            await db_session.execute(
                select(PointAccount.account_type).where(PointAccount.id.in_(accounts.values()))
            )
        )
        .scalars()
        .all()
    )
    assert set(stored) == {PARTY}


@pytest.mark.parametrize(
    "amounts",
    [(-40, 40, 0), (-40, 30), (0, 0), ()],
    ids=["zero_amount", "unbalanced", "all_zero", "no_entries"],
)
async def test_postPoints_zeroOrUnbalancedEntries_raisesBeforeFlush(
    db_session: AsyncSession, amounts: tuple[int, ...]
) -> None:
    giver, recipient = await _persons(db_session, 2)
    accounts = await lock_accounts(db_session, [(giver, PARTY)])
    emission = await system_account_id(db_session, EMISSION)
    accounts_by_position = [emission, accounts[(giver, PARTY)], accounts[(giver, PARTY)]]
    before = await point_row_counts(db_session)

    with pytest.raises(LedgerInvariantError):
        await _post(
            db_session,
            PointTransactionType.GIVE_FREE,
            giver,
            recipient,
            [
                PointLine(account, amount)
                for account, amount in zip(accounts_by_position, amounts, strict=False)
            ],
        )

    assert await point_row_counts(db_session) == before


async def test_postPoints_debitBeyondLockedBalance_raisesLedgerInvariantError(
    db_session: AsyncSession,
) -> None:
    buyer, seller = await _persons(db_session, 2)
    accounts = await lock_accounts(db_session, [(buyer, PARTY), (buyer, HELD), (seller, PARTY)])
    buyer_party, buyer_held = accounts[(buyer, PARTY)], accounts[(buyer, HELD)]
    emission = await system_account_id(db_session, EMISSION)
    burn = await system_account_id(db_session, BURN)
    await _post_gift(db_session, buyer_party, buyer, seller, 40)
    before = await point_row_counts(db_session)

    attempts: list[tuple[PointTransactionType, list[PointLine]]] = [
        (PointTransactionType.HOLD, [PointLine(buyer_party, -41), PointLine(buyer_held, 41)]),
        # Two debits of one account count together.
        (
            PointTransactionType.HOLD,
            [PointLine(buyer_party, -30), PointLine(buyer_party, -30), PointLine(buyer_held, 60)],
        ),
        (PointTransactionType.RELEASE, [PointLine(buyer_held, -1), PointLine(buyer_party, 1)]),
        (
            PointTransactionType.SALE,
            [
                PointLine(buyer_held, -10),
                PointLine(burn, 10),
                PointLine(emission, -10),
                PointLine(accounts[(seller, PARTY)], 10),
            ],
        ),
    ]
    for transaction_type, entries in attempts:
        with pytest.raises(LedgerInvariantError, match="exceeds the balance"):
            await _post(db_session, transaction_type, buyer, seller, entries)
        assert await point_row_counts(db_session) == before

    await _post(
        db_session,
        PointTransactionType.HOLD,
        buyer,
        seller,
        [PointLine(buyer_party, -40), PointLine(buyer_held, 40)],
    )
    assert await account_balance(db_session, buyer_party) == 0
    assert await account_balance(db_session, buyer_held) == 40


async def test_postPoints_entryOnUndeclaredAccountType_raises(
    db_session: AsyncSession,
) -> None:
    giver, recipient = await _persons(db_session, 2)
    accounts = await lock_accounts(db_session, [(giver, PARTY), (giver, HELD), (recipient, PARTY)])
    giver_party, giver_held = accounts[(giver, PARTY)], accounts[(giver, HELD)]
    emission = await system_account_id(db_session, EMISSION)
    burn = await system_account_id(db_session, BURN)
    await _post_gift(db_session, giver_party, giver, recipient, 100)
    await _post(
        db_session,
        PointTransactionType.HOLD,
        giver,
        recipient,
        [PointLine(giver_party, -50), PointLine(giver_held, 50)],
    )
    before = await point_row_counts(db_session)

    attempts: list[tuple[PointTransactionType, list[PointLine]]] = [
        # An award never debits a PARTY account (the former stage-1 guard).
        (
            PointTransactionType.GIVE_FREE,
            [PointLine(giver_party, -40), PointLine(accounts[(recipient, PARTY)], 40)],
        ),
        (PointTransactionType.GIVE_FREE, [PointLine(emission, -40), PointLine(giver_held, 40)]),
        (PointTransactionType.ATTENDANCE, [PointLine(burn, -40), PointLine(giver_party, 40)]),
        (PointTransactionType.HOLD, [PointLine(giver_party, -40), PointLine(burn, 40)]),
        (PointTransactionType.HOLD, [PointLine(emission, -40), PointLine(giver_held, 40)]),
        (PointTransactionType.SALE, [PointLine(emission, -40), PointLine(emission, 40)]),
        (PointTransactionType.RELEASE, [PointLine(giver_party, -40), PointLine(giver_held, 40)]),
    ]
    for transaction_type, entries in attempts:
        attendance = transaction_type == PointTransactionType.ATTENDANCE
        with pytest.raises(LedgerInvariantError, match="expected one of"):
            await _post(
                db_session, transaction_type, giver, None if attendance else recipient, entries
            )
        assert await point_row_counts(db_session) == before

    with pytest.raises(LedgerInvariantError, match="Unknown"):
        await _post(
            db_session,
            PointTransactionType.GIVE_FREE,
            giver,
            recipient,
            [PointLine(emission, -40), PointLine(uuid.uuid4(), 40)],
        )
    assert await point_row_counts(db_session) == before


async def test_postPoints_duplicateSourceKey_raisesIntegrityErrorMappedTo409(
    db_session: AsyncSession,
) -> None:
    giver, recipient = await _persons(db_session, 2)
    giver_account = (await lock_accounts(db_session, [(giver, PARTY)]))[(giver, PARTY)]
    source_id = uuid.uuid4()
    assert not await source_key_exists(
        db_session, PointTransactionType.GIVE_FREE, RESERVATION, source_id
    )

    await _post_gift(db_session, giver_account, giver, recipient, 40, source_id=source_id)

    assert await source_key_exists(
        db_session, PointTransactionType.GIVE_FREE, RESERVATION, source_id
    )
    assert not await source_key_exists(
        db_session, PointTransactionType.WISHLIST_MATCH, RESERVATION, source_id
    )
    with pytest.raises(IntegrityError) as raised:
        async with db_session.begin_nested():
            await _post_gift(db_session, giver_account, giver, recipient, 40, source_id=source_id)
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/x",
            "scheme": "http",
            "server": ("test", 80),
            "headers": [],
            "query_string": b"",
        }
    )
    response = await integrity_error_handler(request, raised.value)
    assert response.status_code == 409


def test_pointLedgerRows_constructedOutsideLedger_none() -> None:
    offenders = []
    for path in sorted(_APP_ROOT.rglob("*.py")):
        if path == _LEDGER:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", None)
            if name in ("PointEntry", "PointTransaction"):
                offenders.append(f"{path.relative_to(_APP_ROOT).as_posix()}:{node.lineno}")

    assert offenders == []
    assert "PointTransaction(" in _LEDGER.read_text(encoding="utf-8")


class _FakeSession:
    def __init__(self) -> None:
        self.rollbacks = 0

    async def rollback(self) -> None:
        self.rollbacks += 1


@pytest.mark.parametrize(
    ("error", "expected", "rollbacks"),
    [
        (pg_error("40P01"), StaleDataError, 1),
        (pg_error("40001"), StaleDataError, 1),
        (pg_error("57014"), DBAPIError, 0),
        (RuntimeError("boom"), RuntimeError, 0),
    ],
    ids=["deadlock", "serialization", "statement_timeout", "other"],
)
async def test_mappedTransactionConflicts_errorInBlock_mapsOnlyConflicts(
    error: Exception, expected: type[Exception], rollbacks: int
) -> None:
    session = _FakeSession()

    with pytest.raises(expected) as raised:
        async with mapped_transaction_conflicts(session):  # type: ignore[arg-type]
            raise error

    assert session.rollbacks == rollbacks
    if expected is not StaleDataError:
        assert raised.value is error


async def test_loadConfig_seededRow_returnsDefaults(db_session: AsyncSession) -> None:
    config = await load_config(db_session)

    assert (config.base_small, config.base_medium, config.base_large) == (20, 40, 60)
    assert config.attendance_levels == [0, 10, 20]
