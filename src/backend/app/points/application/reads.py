"""The owner's points reads behind `GET /api/points/me` and `/me/history`.
They read only the caller's own PARTY account and never create one: a
caller without an account, or whose party is not a person, has 0 and 0 and
an empty history."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.pagination import Page, PageParams
from app.points.infrastructure import users_acl
from app.points.infrastructure.ledger import (
    TRANSACTION_RULES,
    account_balance,
    account_reputation,
)
from app.points.models import PointAccount, PointEntry, PointTransaction
from app.points.schemas import PointHistoryEntryResponse, PointsSummaryResponse


async def _account_id(db: AsyncSession, party_id: uuid.UUID) -> uuid.UUID | None:
    return (
        await db.execute(select(PointAccount.id).where(PointAccount.party_id == party_id))
    ).scalar_one_or_none()


async def my_summary(db: AsyncSession, principal: Principal) -> PointsSummaryResponse:
    party_id = await users_acl.caller_party_id(db, principal)
    account_id = None if party_id is None else await _account_id(db, party_id)
    if account_id is None:
        return PointsSummaryResponse(balance=0, reputation=0)
    return PointsSummaryResponse(
        balance=await account_balance(db, account_id),
        reputation=await account_reputation(db, account_id),
    )


async def my_history(
    db: AsyncSession, principal: Principal, page: PageParams
) -> Page[PointHistoryEntryResponse]:
    """Newest first by `(occurred_at, id)`; one statement for the page, one
    count and one batched name lookup, whatever the page holds. Offset paging
    may repeat an entry when an award lands between two pages (accepted)."""
    party_id = await users_acl.caller_party_id(db, principal)
    if party_id is None:
        return Page(items=[], total=0, page=page.page, size=page.size)
    own_account = (PointAccount.id == PointEntry.account_id) & (PointAccount.party_id == party_id)
    rows = (
        await db.execute(
            select(
                PointTransaction.id,
                PointTransaction.transaction_type,
                PointEntry.amount,
                PointTransaction.description,
                PointTransaction.party_id,
                PointTransaction.counterparty_party_id,
                PointTransaction.occurred_at,
            )
            .join_from(PointEntry, PointAccount, own_account)
            .join(PointTransaction, PointTransaction.id == PointEntry.transaction_id)
            .order_by(PointTransaction.occurred_at.desc(), PointTransaction.id.desc())
            .offset(page.offset)
            .limit(page.size)
        )
    ).all()
    total = (
        await db.execute(select(func.count()).join_from(PointEntry, PointAccount, own_account))
    ).scalar_one()

    def other_party(beneficiary: uuid.UUID, counterparty: uuid.UUID | None) -> uuid.UUID | None:
        # EXCHANGE names the lower party as beneficiary, so either side may view it.
        if counterparty is None:
            return None
        return counterparty if beneficiary == party_id else beneficiary

    others = [other_party(row.party_id, row.counterparty_party_id) for row in rows]
    names = await users_acl.display_names(db, {other for other in others if other is not None})
    items = [
        PointHistoryEntryResponse(
            id=row.id,
            type=row.transaction_type,
            amount=row.amount,
            reputation=row.amount
            if TRANSACTION_RULES[row.transaction_type].counts_reputation
            else 0,
            description=row.description,
            counterparty_name=None if other is None else names.get(other),
            occurred_at=row.occurred_at,
        )
        for row, other in zip(rows, others, strict=True)
    ]
    return Page(items=items, total=total, page=page.page, size=page.size)
