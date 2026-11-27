"""The owner's points reads behind `GET /api/points/me` and `/me/history`.
They read only the caller's own PARTY and HELD accounts and never create
one: a caller without an account, or whose party is not a person, has 0
everywhere and an empty history."""

from __future__ import annotations

import uuid

from sqlalchemy import ColumnElement, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.pagination import Page, PageParams
from app.points.infrastructure import users_acl
from app.points.infrastructure.ledger import (
    TRANSACTION_RULES,
    account_balance,
    account_reputation,
)
from app.points.models import PointAccount, PointAccountType, PointEntry, PointTransaction
from app.points.schemas import PointHistoryEntryResponse, PointsSummaryResponse

_OWN_TYPES = (PointAccountType.PARTY, PointAccountType.HELD)


async def _account_id(
    db: AsyncSession, party_id: uuid.UUID, account_type: PointAccountType
) -> uuid.UUID | None:
    return (
        await db.execute(
            select(PointAccount.id).where(
                PointAccount.party_id == party_id, PointAccount.account_type == account_type
            )
        )
    ).scalar_one_or_none()


async def my_summary(db: AsyncSession, principal: Principal) -> PointsSummaryResponse:
    """`balance` (available) and `reputation` from the PARTY account, `held`
    from the HELD account."""
    party_id = await users_acl.caller_party_id(db, principal)
    if party_id is None:
        return PointsSummaryResponse(balance=0, held=0, reputation=0)
    party_account = await _account_id(db, party_id, PointAccountType.PARTY)
    held_account = await _account_id(db, party_id, PointAccountType.HELD)
    return PointsSummaryResponse(
        balance=0 if party_account is None else await account_balance(db, party_account),
        held=0 if held_account is None else await account_balance(db, held_account),
        reputation=0 if party_account is None else await account_reputation(db, party_account),
    )


async def my_history(
    db: AsyncSession, principal: Principal, page: PageParams
) -> Page[PointHistoryEntryResponse]:
    """One row per transaction touching the caller's PARTY or HELD account,
    newest first by `(occurred_at, id)`: `amount` sums the PARTY entries,
    `held_amount` the HELD ones (0 when none). One statement for the page,
    one count and one batched name lookup, whatever the page holds. Offset
    paging may repeat a row when a posting lands between two pages
    (accepted)."""
    party_id = await users_acl.caller_party_id(db, principal)
    if party_id is None:
        return Page(items=[], total=0, page=page.page, size=page.size)
    own_account = (
        (PointAccount.id == PointEntry.account_id)
        & (PointAccount.party_id == party_id)
        & PointAccount.account_type.in_(_OWN_TYPES)
    )

    def type_sum(account_type: PointAccountType) -> ColumnElement[int]:
        return func.coalesce(
            func.sum(case((PointAccount.account_type == account_type, PointEntry.amount))), 0
        )

    rows = (
        await db.execute(
            select(
                PointTransaction.id,
                PointTransaction.transaction_type,
                type_sum(PointAccountType.PARTY).label("amount"),
                type_sum(PointAccountType.HELD).label("held_amount"),
                PointTransaction.description,
                PointTransaction.party_id,
                PointTransaction.counterparty_party_id,
                PointTransaction.occurred_at,
            )
            .join_from(PointEntry, PointAccount, own_account)
            .join(PointTransaction, PointTransaction.id == PointEntry.transaction_id)
            .group_by(PointTransaction.id)
            .order_by(PointTransaction.occurred_at.desc(), PointTransaction.id.desc())
            .offset(page.offset)
            .limit(page.size)
        )
    ).all()
    total = (
        await db.execute(
            select(func.count(func.distinct(PointEntry.transaction_id))).join_from(
                PointEntry, PointAccount, own_account
            )
        )
    ).scalar_one()

    def other_party(beneficiary: uuid.UUID, counterparty: uuid.UUID | None) -> uuid.UUID | None:
        # EXCHANGE names the lower party as beneficiary and SALE the seller,
        # so either side may view the row.
        if counterparty is None:
            return None
        return counterparty if beneficiary == party_id else beneficiary

    others = [other_party(row.party_id, row.counterparty_party_id) for row in rows]
    names = await users_acl.display_names(db, {other for other in others if other is not None})
    items = [
        PointHistoryEntryResponse(
            id=row.id,
            type=row.transaction_type,
            amount=int(row.amount),
            held_amount=int(row.held_amount),
            reputation=int(row.amount)
            if TRANSACTION_RULES[row.transaction_type].counts_reputation
            else 0,
            description=row.description,
            counterparty_name=None if other is None else names.get(other),
            occurred_at=row.occurred_at,
        )
        for row, other in zip(rows, others, strict=True)
    ]
    return Page(items=items, total=total, page=page.page, size=page.size)
