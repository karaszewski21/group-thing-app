"""Points ledger tests for `app.points`: the declared transaction rules,
`post_points` validation and posting, the lazily created and locked
accounts, balance/reputation reads, the source-key idempotency backstop, the
single-writer guard and the shared `mapped_transaction_conflicts` helper."""

from __future__ import annotations

import ast
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, cast

import pytest
from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, IntegrityError, OperationalError
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
    emission_account_id,
    lock_accounts,
    post_points,
    source_key_exists,
)
from app.points.models import (
    PointAccount,
    PointAccountType,
    PointSourceType,
    PointTransactionType,
)
from tests.point_ledger_assertions import (
    assert_point_transactions_balanced,
    point_row_counts,
    transactions_for_party,
)

_APP_ROOT = Path(__file__).resolve().parents[1] / "app"
_LEDGER = _APP_ROOT / "points" / "infrastructure" / "ledger.py"


async def _persons(db: AsyncSession, n: int) -> list[uuid.UUID]:
    parties = [Party(party_type=PartyType.PERSON) for _ in range(n)]
    db.add_all(parties)
    await db.flush()
    return [cast(uuid.UUID, party.id) for party in parties]


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
    emission = await emission_account_id(db)
    return await post_points(
        db,
        transaction_type=PointTransactionType.GIVE_FREE,
        source_id=source_id or uuid.uuid4(),
        party_id=giver,
        counterparty_party_id=recipient,
        cap_month=None,
        description=description,
        occurred_at=datetime.utcnow(),
        entries=[PointLine(emission, -value), PointLine(giver_account_id, value)],
    )


def test_transactionRules_everyTransactionType_hasRuleDebitingEmission() -> None:
    assert set(TRANSACTION_RULES) == set(PointTransactionType)
    assert {rule.debits for rule in TRANSACTION_RULES.values()} == {PointAccountType.EMISSION}
    assert TRANSACTION_RULES[PointTransactionType.ATTENDANCE].source_type == (
        PointSourceType.TERM_ATTENDANCE
    )
    assert [t for t, rule in TRANSACTION_RULES.items() if rule.counts_reputation] == [
        PointTransactionType.GIVE_FREE
    ]


async def test_postPoints_balancedGiftAndExchange_writesRowsAndBalanceEqualsSum(
    db_session: AsyncSession,
) -> None:
    low, high = sorted(await _persons(db_session, 2))
    accounts = await lock_accounts(db_session, [high, low, high])
    assert list(accounts) == [low, high]
    assert await lock_accounts(db_session, [low, high]) == accounts
    emission = await emission_account_id(db_session)

    gift = await _post_gift(db_session, accounts[low], low, high, 40, description="R" * 600)
    await post_points(
        db_session,
        transaction_type=PointTransactionType.EXCHANGE,
        source_id=uuid.uuid4(),
        party_id=low,
        counterparty_party_id=high,
        cap_month=None,
        description="Kask ↔ Rowerek",
        occurred_at=datetime.utcnow(),
        entries=[
            PointLine(emission, -20),
            PointLine(accounts[low], 10),
            PointLine(accounts[high], 10),
        ],
    )
    await post_points(
        db_session,
        transaction_type=PointTransactionType.ATTENDANCE,
        source_id=uuid.uuid4(),
        party_id=high,
        counterparty_party_id=None,
        cap_month=date(2026, 11, 1),
        description="Krąg",
        occurred_at=datetime.utcnow(),
        entries=[PointLine(emission, -20), PointLine(accounts[high], 20)],
    )

    assert gift.source_type == PointSourceType.RESERVATION
    assert len(gift.description) == 500 and gift.description.endswith("…")
    await assert_point_transactions_balanced(db_session)
    assert len(await transactions_for_party(db_session, low)) == 2
    assert await account_balance(db_session, accounts[low]) == 50
    assert await account_reputation(db_session, accounts[low]) == 40
    assert await account_balance(db_session, accounts[high]) == 30
    assert await account_reputation(db_session, accounts[high]) == 0
    stored = (
        (
            await db_session.execute(
                select(PointAccount.account_type).where(PointAccount.id.in_(accounts.values()))
            )
        )
        .scalars()
        .all()
    )
    assert set(stored) == {PointAccountType.PARTY}


@pytest.mark.parametrize(
    "amounts",
    [(-40, 40, 0), (-40, 30), (0, 0)],
    ids=["zero_amount", "unbalanced", "all_zero"],
)
async def test_postPoints_zeroOrUnbalancedEntries_raisesBeforeFlush(
    db_session: AsyncSession, amounts: tuple[int, ...]
) -> None:
    giver, recipient = await _persons(db_session, 2)
    accounts = await lock_accounts(db_session, [giver])
    emission = await emission_account_id(db_session)
    accounts_by_position = [emission, accounts[giver], accounts[giver]]
    before = await point_row_counts(db_session)

    with pytest.raises(LedgerInvariantError):
        await post_points(
            db_session,
            transaction_type=PointTransactionType.GIVE_FREE,
            source_id=uuid.uuid4(),
            party_id=giver,
            counterparty_party_id=recipient,
            cap_month=None,
            description="Rowerek",
            occurred_at=datetime.utcnow(),
            entries=[
                PointLine(account, amount)
                for account, amount in zip(accounts_by_position, amounts, strict=False)
            ],
        )

    assert await point_row_counts(db_session) == before


async def test_postPoints_debitOnPartyAccount_raisesBeforeFlush(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    giver, recipient = await _persons(db_session, 2)
    accounts = await lock_accounts(db_session, [giver, recipient])
    before = await point_row_counts(db_session)

    with pytest.raises(LedgerInvariantError, match="PARTY"):
        await _post_gift(db_session, accounts[giver], giver, recipient, -40)

    monkeypatch.setitem(
        TRANSACTION_RULES,
        PointTransactionType.GIVE_FREE,
        TransactionRule(
            source_type=PointSourceType.RESERVATION,
            pair_limited=True,
            counts_reputation=True,
            debits=PointAccountType.PARTY,
        ),
    )
    with pytest.raises(LedgerInvariantError, match="PARTY"):
        await post_points(
            db_session,
            transaction_type=PointTransactionType.GIVE_FREE,
            source_id=uuid.uuid4(),
            party_id=giver,
            counterparty_party_id=recipient,
            cap_month=None,
            description="Rowerek",
            occurred_at=datetime.utcnow(),
            entries=[PointLine(accounts[recipient], -40), PointLine(accounts[giver], 40)],
        )

    assert await point_row_counts(db_session) == before


async def test_postPoints_duplicateSourceKey_raisesIntegrityErrorMappedTo409(
    db_session: AsyncSession,
) -> None:
    giver, recipient = await _persons(db_session, 2)
    accounts = await lock_accounts(db_session, [giver])
    source_id = uuid.uuid4()
    assert not await source_key_exists(
        db_session, PointTransactionType.GIVE_FREE, PointSourceType.RESERVATION, source_id
    )

    await _post_gift(db_session, accounts[giver], giver, recipient, 40, source_id=source_id)

    assert await source_key_exists(
        db_session, PointTransactionType.GIVE_FREE, PointSourceType.RESERVATION, source_id
    )
    assert not await source_key_exists(
        db_session, PointTransactionType.WISHLIST_MATCH, PointSourceType.RESERVATION, source_id
    )
    with pytest.raises(IntegrityError) as raised:
        async with db_session.begin_nested():
            await _post_gift(db_session, accounts[giver], giver, recipient, 40, source_id=source_id)
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


class _PgError(Exception):
    def __init__(self, sqlstate: str) -> None:
        super().__init__(sqlstate)
        self.sqlstate = sqlstate


class _FakeSession:
    def __init__(self) -> None:
        self.rollbacks = 0

    async def rollback(self) -> None:
        self.rollbacks += 1


@pytest.mark.parametrize(
    ("error", "expected", "rollbacks"),
    [
        (OperationalError("UPDATE", {}, _PgError("40P01")), StaleDataError, 1),
        (OperationalError("UPDATE", {}, _PgError("40001")), StaleDataError, 1),
        (OperationalError("UPDATE", {}, _PgError("57014")), DBAPIError, 0),
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
