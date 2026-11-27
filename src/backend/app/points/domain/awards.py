"""Which awards a confirmed exchange earns, before anything is posted.

A GIFT earns GIVE_FREE (the item's value) for the giver, then the „Szukam”
WISHLIST_MATCH bonus when the recipient wanted the item. A SWAP earns one
EXCHANGE (the swap award for each side), then the bonus per leg in
reservation-id order. Every one of these uses a pair slot: awards stop once
the pair has used `pair_reward_limit` slots in the window. A zero-value
award is dropped and uses no slot.

A closed, rewarded term earns each present eligible person ATTENDANCE equal
to the term's level, clipped to what is left of the monthly cap in the
Warsaw calendar month of the close; a clipped-to-zero award is dropped.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime

GIVE_FREE = "GIVE_FREE"
EXCHANGE = "EXCHANGE"
WISHLIST_MATCH = "WISHLIST_MATCH"
SWAP = "SWAP"
POINTS = "POINTS"


@dataclass(frozen=True)
class AwardLeg:
    """One reservation of the exchange, with parties already resolved."""

    reservation_id: uuid.UUID
    reservation_type: str
    giver_party_id: uuid.UUID
    recipient_party_id: uuid.UUID
    points_value: int | None


@dataclass(frozen=True)
class ExchangeRules:
    swap_award: int
    wants_bonus: int
    pair_reward_limit: int


@dataclass(frozen=True)
class PlannedAward:
    """`credits` are `(party_id, amount)` pairs; `subject_reservation_ids`
    name the legs whose items describe the award, in order."""

    transaction_type: str
    source_id: uuid.UUID
    party_id: uuid.UUID
    counterparty_party_id: uuid.UUID
    credits: tuple[tuple[uuid.UUID, int], ...]
    subject_reservation_ids: tuple[uuid.UUID, ...]

    @property
    def total(self) -> int:
        return sum(amount for _party, amount in self.credits)


def plan_exchange_awards(
    legs: Sequence[AwardLeg],
    used_pair_slots: int,
    rules: ExchangeRules,
    wants_hits: Collection[uuid.UUID],
) -> list[PlannedAward]:
    """`wants_hits` holds the reservation ids whose recipient wanted the
    leg's item when the reservation was made."""
    ordered = sorted(legs, key=lambda leg: leg.reservation_id)
    candidates: list[PlannedAward] = []
    if ordered[0].reservation_type == SWAP:
        lower, higher = sorted({ordered[0].giver_party_id, ordered[0].recipient_party_id})
        candidates.append(
            PlannedAward(
                transaction_type=EXCHANGE,
                source_id=ordered[0].reservation_id,
                party_id=lower,
                counterparty_party_id=higher,
                credits=((lower, rules.swap_award), (higher, rules.swap_award)),
                subject_reservation_ids=tuple(leg.reservation_id for leg in ordered),
            )
        )
    else:
        gift = ordered[0]
        candidates.append(_to_giver(GIVE_FREE, gift, gift.points_value or 0))
    candidates.extend(
        _to_giver(WISHLIST_MATCH, leg, rules.wants_bonus)
        for leg in ordered
        if leg.reservation_id in wants_hits
    )

    planned: list[PlannedAward] = []
    used = used_pair_slots
    for award in candidates:
        if award.total == 0:
            continue
        if used >= rules.pair_reward_limit:
            break
        planned.append(award)
        used += 1
    return planned


def _to_giver(transaction_type: str, leg: AwardLeg, amount: int) -> PlannedAward:
    return PlannedAward(
        transaction_type=transaction_type,
        source_id=leg.reservation_id,
        party_id=leg.giver_party_id,
        counterparty_party_id=leg.recipient_party_id,
        credits=((leg.giver_party_id, amount),),
        subject_reservation_ids=(leg.reservation_id,),
    )


@dataclass(frozen=True)
class AttendanceAward:
    attendance_id: uuid.UUID
    party_id: uuid.UUID
    amount: int


def attendance_cap_month(closed_at: datetime) -> date:
    """The first day of the month of the naive Warsaw `closed_at`: the cap
    counts closes, so past-dated terms closed together share one cap."""
    return closed_at.date().replace(day=1)


def plan_attendance_awards(
    attendees: Sequence[tuple[uuid.UUID, uuid.UUID]],
    level: int,
    monthly_cap: int,
    used_in_cap_month: Mapping[uuid.UUID, int],
) -> list[AttendanceAward]:
    """`attendees` are `(attendance_id, party_id)`; `used_in_cap_month` maps
    a party to the ATTENDANCE points it already has in the cap month."""
    used = dict(used_in_cap_month)
    planned: list[AttendanceAward] = []
    for attendance_id, party_id in attendees:
        amount = max(0, min(level, monthly_cap - used.get(party_id, 0)))
        if amount == 0:
            continue
        planned.append(AttendanceAward(attendance_id, party_id, amount))
        used[party_id] = used.get(party_id, 0) + amount
    return planned
