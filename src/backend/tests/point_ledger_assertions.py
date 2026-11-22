"""Shared read helpers for asserting on the points ledger
(`point_accounts` / `point_transactions` / `point_entries`) from tests."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.points.models import PointAccount, PointEntry, PointTransaction


async def point_row_counts(db: AsyncSession) -> tuple[int, int]:
    """`(point_transactions, point_entries)` row counts."""
    transactions = (
        await db.execute(select(func.count()).select_from(PointTransaction))
    ).scalar_one()
    entries = (await db.execute(select(func.count()).select_from(PointEntry))).scalar_one()
    return transactions, entries


async def transactions_for_party(db: AsyncSession, party_id: uuid.UUID) -> list[PointTransaction]:
    """Every transaction with an entry on the party's account, oldest first
    by `(occurred_at, id)`, with `entries` loaded."""
    result = await db.execute(
        select(PointTransaction)
        .where(
            PointTransaction.id.in_(
                select(PointEntry.transaction_id)
                .join(PointAccount, PointAccount.id == PointEntry.account_id)
                .where(PointAccount.party_id == party_id)
            )
        )
        .options(selectinload(PointTransaction.entries))
        .order_by(PointTransaction.occurred_at, PointTransaction.id)
    )
    return list(result.scalars().all())


async def assert_point_transactions_balanced(db: AsyncSession) -> None:
    """Every transaction's entries sum to 0."""
    unbalanced = (
        (
            await db.execute(
                select(PointEntry.transaction_id)
                .group_by(PointEntry.transaction_id)
                .having(func.sum(PointEntry.amount) != 0)
            )
        )
        .scalars()
        .all()
    )
    assert not unbalanced, f"point transactions not summing to 0: {unbalanced}"
