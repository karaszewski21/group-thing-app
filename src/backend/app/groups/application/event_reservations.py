"""What deleting an Event does to its exchanges: every open reservation is
cancelled (both swap legs included), every PROPOSED or ACCEPTED proposal
becomes REJECTED and both parties of each are told with
`RESERVATION_CANCELLED`. Nothing here commits — `app.events.service.delete_event`
commits once, so the cancellations land atomically with the delete. Reached
from events only through `app.events.infrastructure.groups_acl`."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.users.models import UserProfile

from ..infrastructure import circulation_bridge, notifications_bridge
from ..infrastructure.notifications_bridge import NotificationKind
from ..models import SwapProposal, SwapProposalStatus
from .item_links import item_path

_LIVE_PROPOSAL_STATUSES = (SwapProposalStatus.PROPOSED, SwapProposalStatus.ACCEPTED)


@dataclass(frozen=True)
class OpenEventReservationCounts:
    """`total` counts open gift reservations plus open swaps; `swaps` counts
    only the swaps — exactly what `cancel_open_event_reservations` cancels."""

    total: int
    swaps: int


@dataclass(frozen=True)
class _OpenExchanges:
    reservations: list[circulation_bridge.Reservation]
    live_proposals: list[SwapProposal]
    standalone: list[circulation_bridge.Reservation]


async def _collect_open_exchanges(
    db: AsyncSession, event_id: uuid.UUID, *, for_update: bool
) -> tuple[_OpenExchanges, list[SwapProposal]]:
    """The event's open reservations, its PROPOSED/ACCEPTED proposals, the
    live ones among them (proposer leg still open) and the open reservations
    no live proposal covers. Two statements."""
    reservations = await circulation_bridge.list_open_reservations_for_event(db, event_id)
    statement = select(SwapProposal).where(
        SwapProposal.status.in_(_LIVE_PROPOSAL_STATUSES),
        SwapProposal.proposer_reservation_id.in_(
            circulation_bridge.reservation_ids_for_event_select(event_id)
        ),
    )
    if for_update:
        statement = statement.order_by(SwapProposal.id).with_for_update()
    proposals = list((await db.scalars(statement)).all())

    by_id = {cast(uuid.UUID, r.id): r for r in reservations}
    live = [p for p in proposals if p.proposer_reservation_id in by_id]
    covered: set[uuid.UUID] = set()
    for proposal in live:
        covered.add(proposal.proposer_reservation_id)
        paired = by_id[proposal.proposer_reservation_id].paired_reservation_id
        if paired is not None:
            covered.add(paired)
    standalone = [r for r in reservations if r.id not in covered]
    return _OpenExchanges(reservations, live, standalone), proposals


async def count_open_event_reservations(
    db: AsyncSession, event_id: uuid.UUID
) -> OpenEventReservationCounts:
    exchanges, _ = await _collect_open_exchanges(db, event_id, for_update=False)
    swaps = len(exchanges.live_proposals)
    return OpenEventReservationCounts(total=len(exchanges.standalone) + swaps, swaps=swaps)


async def _party_ids_by_user_id(
    db: AsyncSession, user_ids: set[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    if not user_ids:
        return {}
    rows = await db.execute(
        select(UserProfile.account_user_id, UserProfile.party_id).where(
            UserProfile.account_user_id.in_(user_ids)
        )
    )
    return {cast(uuid.UUID, user_id): party_id for user_id, party_id in rows.all()}


async def cancel_open_event_reservations(
    db: AsyncSession, event_id: uuid.UUID, event_name: str, starts_at: datetime
) -> OpenEventReservationCounts:
    """Cancels the event's open reservations, rejects its PROPOSED/ACCEPTED
    proposals and stages one `RESERVATION_CANCELLED` per party of each gift
    or swap. Flush only — the caller commits."""
    exchanges, proposals = await _collect_open_exchanges(db, event_id, for_update=True)
    cancelled = await circulation_bridge.cancel_reservations_without_commit(
        db, [cast(uuid.UUID, r.id) for r in exchanges.reservations]
    )
    cancelled_ids = {cast(uuid.UUID, r.id) for r in cancelled}
    for proposal in proposals:
        proposal.status = SwapProposalStatus.REJECTED

    reservations_by_id = {cast(uuid.UUID, r.id): r for r in exchanges.reservations}
    party_ids = await _party_ids_by_user_id(
        db,
        {r.giver_user_id for r in exchanges.reservations}
        | {r.reserved_by_user_id for r in exchanges.reservations},
    )
    names = await circulation_bridge.list_product_names_for_items(
        db,
        {r.item_id for r in exchanges.reservations}
        | {p.listing_item_id for p in exchanges.live_proposals},
    )
    suffix = f" — wydarzenie {event_name} ({clock.format_term_when(starts_at)}) zostało usunięte"

    async def notify(recipients: set[uuid.UUID | None], message: str, item_id: uuid.UUID) -> None:
        link_path = await item_path(db, item_id)
        for party_id in recipients:
            if party_id is None:
                continue
            await notifications_bridge.create_notification(
                db,
                party_id=party_id,
                kind=NotificationKind.RESERVATION_CANCELLED,
                message=clock.fit_notification_message(message + suffix),
                link_path=link_path,
            )

    for reservation in exchanges.standalone:
        if reservation.id not in cancelled_ids:
            continue
        await notify(
            {
                party_ids.get(reservation.giver_user_id),
                party_ids.get(reservation.reserved_by_user_id),
            },
            f"Rezerwacja „{names.get(reservation.item_id, 'rzeczy')}” została anulowana",
            reservation.item_id,
        )
    for proposal in exchanges.live_proposals:
        if proposal.proposer_reservation_id not in cancelled_ids:
            continue
        proposer_leg = reservations_by_id[proposal.proposer_reservation_id]
        await notify(
            {proposal.proposer_party_id, party_ids.get(proposer_leg.reserved_by_user_id)},
            f"Zamiana „{names.get(proposal.listing_item_id, 'rzeczy')}”"
            f" za „{names.get(proposal.offered_item_id, 'rzeczy')}” została anulowana",
            proposal.listing_item_id,
        )

    swaps = len(exchanges.live_proposals)
    return OpenEventReservationCounts(total=len(exchanges.standalone) + swaps, swaps=swaps)
