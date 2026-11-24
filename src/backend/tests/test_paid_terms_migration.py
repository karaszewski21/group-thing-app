"""Migration `0106_paid_terms`. The round trip moves the shared session
database down and always upgrades it back to head, so later tests see the
full schema."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.test_personal_pickup_migration import _alembic

_COLUMNS = {
    "groups": {"default_price", "default_payment_url", "default_payment_method"},
    "terms": {"price", "payment_url", "payment_method"},
    "term_attendances": {"payment_status", "paid_marked_at"},
}
_CHECKS = {
    "groups": {
        "ck_groups_default_price_positive",
        "ck_groups_default_payment_url_requires_price",
        "ck_groups_default_payment_method_url",
        "ck_groups_default_payment_url_https",
    },
    "terms": {
        "ck_terms_price_positive",
        "ck_terms_payment_url_requires_price",
        "ck_terms_payment_method_url",
        "ck_terms_payment_url_https",
    },
    "term_attendances": {"ck_term_attendances_paid_marked"},
}


def _schema(sync_conn: Connection) -> dict[str, tuple[set[str], set[str]]]:
    inspector = inspect(sync_conn)
    return {
        table: (
            {col["name"] for col in inspector.get_columns(table)},
            {str(check["name"]) for check in inspector.get_check_constraints(table)},
        )
        for table in _COLUMNS
    }


async def _read_schema(engine: AsyncEngine) -> dict[str, Any]:
    async with engine.connect() as conn:
        schema: dict[str, Any] = await conn.run_sync(_schema)
    await engine.dispose()
    return schema


async def test_migration0106_downgradeTo0105AndUpgradeHead_roundTrips(
    engine: AsyncEngine, database_url: str
) -> None:
    try:
        result = _alembic(database_url, "downgrade", "0105")
        assert result.returncode == 0, result.stderr
        await engine.dispose()
        below = await _read_schema(engine)

        for table, (columns, checks) in below.items():
            assert not _COLUMNS[table] & columns, table
            assert not _CHECKS[table] & checks, table
    finally:
        result = _alembic(database_url, "upgrade", "head")
        await engine.dispose()
    assert result.returncode == 0, result.stderr

    head = await _read_schema(engine)
    for table, (columns, checks) in head.items():
        assert columns >= _COLUMNS[table], table
        assert checks >= _CHECKS[table], table


@pytest.mark.parametrize(
    ("update", "constraint"),
    [
        pytest.param(
            "UPDATE terms SET price = NULL, payment_url = 'https://pay.example/x', "
            "payment_method = 'EXTERNAL_LINK' WHERE id = :term",
            "ck_terms_payment_url_requires_price",
            id="term-link-without-price",
        ),
        pytest.param(
            "UPDATE terms SET payment_url = 'http://pay.example/x', "
            "payment_method = 'EXTERNAL_LINK' WHERE id = :term",
            "ck_terms_payment_url_https",
            id="term-http-link",
        ),
        pytest.param(
            "UPDATE groups SET default_price = 10, default_payment_url = 'http://pay.example/x', "
            "default_payment_method = 'EXTERNAL_LINK' WHERE id = :group",
            "ck_groups_default_payment_url_https",
            id="circle-http-default-link",
        ),
    ],
)
async def test_paymentLinkCheckViolation_raisesIntegrityError(
    engine: AsyncEngine, update: str, constraint: str
) -> None:
    ids = {"party": uuid.uuid4(), "group": uuid.uuid4(), "term": uuid.uuid4()}
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
                "VALUES (:party, 'PERSON', true, now(), now())"
            ),
            ids,
        )
        await conn.execute(
            text(
                "INSERT INTO groups (id, party_id, name, created_at, updated_at) "
                "VALUES (:group, :party, 'm0106', now(), now())"
            ),
            ids,
        )
        await conn.execute(
            text(
                "INSERT INTO terms (id, circle_group_id, occurs_on, price, created_at, "
                "updated_at) VALUES (:term, :group, now(), :price, now(), now())"
            ),
            {**ids, "price": Decimal("25.50")},
        )
    try:
        with pytest.raises(IntegrityError, match=constraint):
            async with engine.begin() as conn:
                await conn.execute(text(update), ids)
    finally:
        async with engine.begin() as conn:
            await conn.execute(text("DELETE FROM terms WHERE id = :term"), ids)
            await conn.execute(text("DELETE FROM groups WHERE id = :group"), ids)
            await conn.execute(text("DELETE FROM parties WHERE id = :party"), ids)
        await engine.dispose()
