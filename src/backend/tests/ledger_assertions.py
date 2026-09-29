"""Shared read helpers for asserting on the item-movement ledger
(`accounts` / `circulation_transactions` / `circulation_entries`) from tests.

`assert_ledger_matches_projection` checks the ledger invariant only for the
given items, because some tests deliberately force a legacy item state that
the ledger never recorded."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.circulation.models import (
    Account,
    AccountType,
    CirculationEntry,
    CirculationTransaction,
    InventoryItem,
)


async def movements_for_item(db: AsyncSession, item_id: uuid.UUID) -> list[CirculationTransaction]:
    """Every transaction with an entry for `item_id`, oldest first by
    `(occurred_at, id)`, with `entries` and each entry's `account` loaded."""
    result = await db.execute(
        select(CirculationTransaction)
        .where(
            CirculationTransaction.id.in_(
                select(CirculationEntry.transaction_id).where(CirculationEntry.item_id == item_id)
            )
        )
        .options(
            selectinload(CirculationTransaction.entries).joinedload(CirculationEntry.account)
        )
        .order_by(CirculationTransaction.occurred_at, CirculationTransaction.id)
    )
    return list(result.scalars().all())


async def assert_ledger_matches_projection(db: AsyncSession, item_ids: Iterable[uuid.UUID]) -> None:
    """Double-entry invariant per item. Among INVENTORY accounts a live item
    has +1 only on the account of `item.inventory_id` and a soft-deleted
    item has no nonzero balance; the EXTERNAL account holds -1 of a live
    item (its REGISTER) and 0 of a deleted one (REGISTER -1, REMOVE +1).
    Every transaction sums to 0 per item."""
    ids = list(item_ids)
    items = (
        await db.execute(
            select(InventoryItem)
            .where(InventoryItem.id.in_(ids))
            .execution_options(populate_existing=True)
        )
    ).scalars().all()
    assert {item.id for item in items} == set(ids), "unknown item id passed to the assertion"

    external_account_id = (
        await db.execute(select(Account.id).where(Account.account_type == AccountType.EXTERNAL))
    ).scalar_one()
    inventory_account_ids = dict(
        (
            await db.execute(
                select(Account.inventory_id, Account.id).where(
                    Account.inventory_id.in_({item.inventory_id for item in items})
                )
            )
        ).tuples().all()
    )

    balance_rows = (
        await db.execute(
            select(
                CirculationEntry.item_id,
                CirculationEntry.account_id,
                func.sum(CirculationEntry.quantity),
            )
            .where(CirculationEntry.item_id.in_(ids))
            .group_by(CirculationEntry.item_id, CirculationEntry.account_id)
        )
    ).tuples().all()
    balances: dict[uuid.UUID, dict[uuid.UUID, int]] = {item_id: {} for item_id in ids}
    for item_id, account_id, total in balance_rows:
        if total != 0:
            balances[item_id][account_id] = int(total)

    for item in items:
        item_balance = balances[cast(uuid.UUID, item.id)]
        expected = (
            {}
            if item.deleted_at is not None
            else {inventory_account_ids[item.inventory_id]: 1, external_account_id: -1}
        )
        assert item_balance == expected, (
            f"ledger balance of item {item.id} is {item_balance}, expected {expected}"
        )

    unbalanced = (
        await db.execute(
            select(CirculationEntry.transaction_id, CirculationEntry.item_id)
            .where(CirculationEntry.item_id.in_(ids))
            .group_by(CirculationEntry.transaction_id, CirculationEntry.item_id)
            .having(func.sum(CirculationEntry.quantity) != 0)
        )
    ).tuples().all()
    assert not unbalanced, f"transactions not summing to 0 per item: {unbalanced}"
