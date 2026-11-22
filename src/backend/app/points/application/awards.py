"""Posting the awards of a confirmed exchange (spec R2) and of a closed
term's attendance (spec R6), flush-only, inside the caller's commit."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.points.application.config import load_config
from app.points.domain.awards import (
    AwardLeg,
    ExchangeRules,
    attendance_cap_month,
    plan_attendance_awards,
    plan_exchange_awards,
)
from app.points.infrastructure import families_acl, inventory_acl, users_acl, wants_acl
from app.points.infrastructure.ledger import (
    TRANSACTION_RULES,
    PointLine,
    emission_account_id,
    existing_source_ids,
    lock_accounts,
    post_points,
    source_key_exists,
)
from app.points.models import (
    PointEntry,
    PointSourceType,
    PointTransaction,
    PointTransactionType,
)


@dataclass(frozen=True)
class ExchangeLeg:
    """One reservation of a confirmed GIFT (one leg) or SWAP (two legs);
    `recipient_user_id` is the user who reserved the item."""

    reservation_id: uuid.UUID
    created_at: datetime
    reservation_type: str
    item_id: uuid.UUID
    giver_user_id: uuid.UUID
    recipient_user_id: uuid.UUID


async def award_exchange(db: AsyncSession, legs: Sequence[ExchangeLeg]) -> None:
    """Posts what the exchange earns; nothing when either side is not an
    eligible person, both sides are the same party, or they share a family.
    The two accounts are locked in party-id order before the pair slots are
    counted, ahead of any item row lock taken by the caller."""
    parties = await users_acl.eligible_party_ids(
        db, {user for leg in legs for user in (leg.giver_user_id, leg.recipient_user_id)}
    )
    if any(
        leg.giver_user_id not in parties or leg.recipient_user_id not in parties for leg in legs
    ):
        return
    pair = sorted(set(parties.values()))
    if len(pair) != 2 or await families_acl.share_active_family(db, *pair):
        return

    accounts = await lock_accounts(db, pair)
    config = await load_config(db)
    now = datetime.utcnow()
    used = await _used_pair_slots(
        db, pair[0], pair[1], since=now - timedelta(days=config.pair_window_days)
    )
    items = await inventory_acl.exchanged_items(db, [leg.item_id for leg in legs])
    award_legs = [
        AwardLeg(
            reservation_id=leg.reservation_id,
            reservation_type=leg.reservation_type,
            giver_party_id=parties[leg.giver_user_id],
            recipient_party_id=parties[leg.recipient_user_id],
            points_value=items[leg.item_id].points_value,
        )
        for leg in legs
    ]
    wants_hits = {
        leg.reservation_id
        for leg in legs
        if await wants_acl.wanted_at_reservation(
            db, parties[leg.recipient_user_id], leg.item_id, leg.created_at
        )
    }
    planned = plan_exchange_awards(
        award_legs,
        used,
        ExchangeRules(
            swap_award=config.swap_award,
            wants_bonus=config.wants_bonus,
            pair_reward_limit=config.pair_reward_limit,
        ),
        wants_hits,
    )

    item_of = {leg.reservation_id: leg.item_id for leg in legs}
    emission = await emission_account_id(db)
    for award in planned:
        transaction_type = PointTransactionType(award.transaction_type)
        if await source_key_exists(
            db, transaction_type, PointSourceType.RESERVATION, award.source_id
        ):
            continue
        await post_points(
            db,
            transaction_type=transaction_type,
            source_id=award.source_id,
            party_id=award.party_id,
            counterparty_party_id=award.counterparty_party_id,
            cap_month=None,
            description=" ↔ ".join(
                items[item_of[reservation_id]].product_name
                for reservation_id in award.subject_reservation_ids
            ),
            occurred_at=now,
            entries=[
                PointLine(emission, -award.total),
                *(PointLine(accounts[party], amount) for party, amount in award.credits),
            ],
        )


async def _used_pair_slots(db: AsyncSession, a: uuid.UUID, b: uuid.UUID, *, since: datetime) -> int:
    """The pair's rewarded transactions, in either direction, since `since`."""
    pair_limited = [t for t, rule in TRANSACTION_RULES.items() if rule.pair_limited]
    return int(
        await db.scalar(
            select(func.count())
            .select_from(PointTransaction)
            .where(
                PointTransaction.transaction_type.in_(pair_limited),
                or_(
                    and_(
                        PointTransaction.party_id == a, PointTransaction.counterparty_party_id == b
                    ),
                    and_(
                        PointTransaction.party_id == b, PointTransaction.counterparty_party_id == a
                    ),
                ),
                PointTransaction.occurred_at >= since,
            )
        )
        or 0
    )


async def award_attendance(
    db: AsyncSession,
    group_name: str,
    level: int,
    attendees: Sequence[tuple[uuid.UUID, uuid.UUID]],
) -> int:
    """Posts ATTENDANCE for the present `(attendance_id, party_id)` rows of a
    rewarded close and returns how many were posted. Only eligible persons
    earn; their accounts are locked in party-id order (the caller already
    holds the term lock), then each award is clipped to the person's
    remaining monthly cap for the Warsaw month of the close."""
    eligible = await users_acl.eligible_persons(db, {party for _, party in attendees})
    posted = await existing_source_ids(
        db,
        PointTransactionType.ATTENDANCE,
        PointSourceType.TERM_ATTENDANCE,
        [attendance_id for attendance_id, _ in attendees],
    )
    pending = [
        (attendance_id, party)
        for attendance_id, party in attendees
        if party in eligible and attendance_id not in posted
    ]
    if not pending or level <= 0:
        return 0

    accounts = await lock_accounts(db, {party for _, party in pending})
    config = await load_config(db)
    cap_month = attendance_cap_month(clock.local_now())
    used = await _attendance_in_cap_month(db, accounts, cap_month)
    planned = plan_attendance_awards(pending, level, config.attendance_monthly_cap, used)

    emission = await emission_account_id(db)
    now = datetime.utcnow()
    for award in planned:
        await post_points(
            db,
            transaction_type=PointTransactionType.ATTENDANCE,
            source_id=award.attendance_id,
            party_id=award.party_id,
            counterparty_party_id=None,
            cap_month=cap_month,
            description=group_name,
            occurred_at=now,
            entries=[
                PointLine(emission, -award.amount),
                PointLine(accounts[award.party_id], award.amount),
            ],
        )
    return len(planned)


async def _attendance_in_cap_month(
    db: AsyncSession, accounts: dict[uuid.UUID, uuid.UUID], cap_month: date
) -> dict[uuid.UUID, int]:
    """`{party_id: ATTENDANCE points credited in cap_month}`, one query."""
    party_of = {account_id: party_id for party_id, account_id in accounts.items()}
    rows = await db.execute(
        select(PointEntry.account_id, func.sum(PointEntry.amount))
        .join(PointTransaction, PointTransaction.id == PointEntry.transaction_id)
        .where(
            PointEntry.account_id.in_(party_of),
            PointTransaction.transaction_type == PointTransactionType.ATTENDANCE,
            PointTransaction.cap_month == cap_month,
        )
        .group_by(PointEntry.account_id)
    )
    return {party_of[account_id]: int(total) for account_id, total in rows.tuples()}
