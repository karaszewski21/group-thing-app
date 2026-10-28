"""Periodic background scan for `Term`s whose `occurs_on` has just passed,
emitting an idempotent outbox event for each still-open GIFT
`Reservation` and each `ACCEPTED` `SwapProposal` it affects — the trigger
`app.notifications.outbox_listener` listens for to prompt the parties
allowed to call `confirm_transaction` (a GIFT's taker, both SWAP parties).

Reads circulation state ONLY through `circulation_bridge` — this module
never imports `app.circulation` directly. GIFT candidates come from
`Reservation.term_id` (statuses `PENDING`/`CONFIRMED`; SWAP excluded), so
they are covered regardless of listing preferences. SWAP candidates are
still derived from the standing `ItemListingPreference` of every party
eligible for the Term (active attendee, or its organizer) — see
`term_item_listings._list_eligible_lister_party_ids`.

The outbox-append and the idempotency marker (`GiveawayTermEndMarker` row,
or `SwapProposal.term_ended_notified_at`) are staged in the SAME
transaction and committed together at the end of `scan_for_term_ended`, so
a second scan over an already-processed window can never race a separate
commit into re-emitting the same event."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import EntityNotFoundException
from app.outbox import service as outbox_service
from app.users.service import get_profile_by_account_user_id

from ..domain import swap_events
from ..infrastructure import circulation_bridge, repository
from ..infrastructure.slug_resolver import resolve_organizer_slug
from ..models import (
    GiveawayTermEndMarker,
    ItemListingPreference,
    SwapProposal,
    SwapProposalStatus,
    Term,
)
from .term_item_listings import _list_eligible_lister_party_ids

# Per `standards/global/minimal-implementation.md`: a plain module constant,
# not a configurable-interval settings system — mirrors
# `app.outbox.scheduler.DEFAULT_INTERVAL_SECONDS`'s precedent. How far back
# from "now" the scan still considers a Term "just ended" (bounds the batch
# query below rather than scanning every Term ever created).
DEFAULT_WINDOW = timedelta(hours=24)
# A Term is only "ended" this long after `occurs_on`: the hand-over happens
# during the meeting, so prompting right at its start would be premature.
TERM_END_GRACE = timedelta(hours=2)

__all__ = ["scan_for_term_ended", "DEFAULT_WINDOW", "TERM_END_GRACE"]

logger = logging.getLogger(__name__)


async def _find_terms_just_ended(db: AsyncSession, *, window: timedelta) -> list[Term]:
    """One bounded query — `occurs_on` in `[ended_by - window, ended_by]`,
    where `ended_by` is now minus `TERM_END_GRACE` — never a per-Term or
    unbounded scan, per `standards/backend/queries.md`."""
    # `Term.occurs_on` is a naive Europe/Warsaw wall-clock value, so "now"
    # comes from `clock.local_now()`, never the host clock or UTC.
    ended_by = clock.local_now() - TERM_END_GRACE
    result = await db.execute(
        select(Term).where(Term.occurs_on >= ended_by - window, Term.occurs_on <= ended_by)
    )
    return list(result.scalars().all())


async def _scan_hand_over_reservations(
    db: AsyncSession,
    link_paths: dict[uuid.UUID, str],
    details_by_term: dict[uuid.UUID, dict[str, object]],
) -> int:
    """One bridge query for every just-ended Term's still-open GIFT
    reservations, minus those already carrying a `GiveawayTermEndMarker`.
    Deliberately independent of eligibility and `ItemListingPreference` — the
    giver may have cleared the listing after the take. Returns how many
    events it emitted."""
    candidates = await circulation_bridge.list_active_hand_over_reservations_for_terms(
        db, list(link_paths)
    )
    if not candidates:
        return 0

    reservation_ids = [cast(uuid.UUID, r.id) for r in candidates]
    already_marked = set(
        (
            await db.execute(
                select(GiveawayTermEndMarker.reservation_id).where(
                    GiveawayTermEndMarker.reservation_id.in_(reservation_ids)
                )
            )
        )
        .scalars()
        .all()
    )

    pending = [r for r in candidates if r.id not in already_marked]
    item_names = await circulation_bridge.list_product_names_for_items(
        db, {r.item_id for r in pending}
    )

    emitted = 0
    for reservation in pending:
        reservation_id = cast(uuid.UUID, reservation.id)
        # Skipped (not raised): the scan commits once, so one party without a
        # profile would otherwise roll back every other Term's events, every run.
        try:
            owner_profile = await get_profile_by_account_user_id(db, reservation.giver_user_id)
            taker_profile = await get_profile_by_account_user_id(
                db, reservation.reserved_by_user_id
            )
        except EntityNotFoundException:
            logger.warning(
                "Term-end scan skipped reservation %s: a party has no user profile",
                reservation_id,
            )
            continue
        await outbox_service.append(
            db,
            event_type=swap_events.TERM_ENDED_GIVEAWAY,
            payload={
                "owner_party_id": owner_profile.party_id,
                "taker_party_id": taker_profile.party_id,
                "reservation_id": reservation_id,
                "link_path": link_paths[reservation.term_id],
                "item_name": item_names.get(reservation.item_id),
                **details_by_term[reservation.term_id],
            },
        )
        db.add(GiveawayTermEndMarker(reservation_id=reservation_id, notified_at=datetime.utcnow()))
        emitted += 1
    return emitted


async def _scan_swaps(
    db: AsyncSession,
    preferences: list[ItemListingPreference],
    term: Term,
    link_path: str,
    details: dict[str, object],
) -> int:
    """Emits each ACCEPTED, not-yet-notified proposal whose proposer
    reservation belongs to `term` — a swap agreed for a later Term of the
    same circle waits for that Term to end. The Term scoping is part of the
    query, so a proposal that can never match this Term is not re-read."""
    swap_item_ids = [
        pref.item_id
        for pref in preferences
        if pref.mode == circulation_bridge.ReservationType.SWAP.value
    ]
    if not swap_item_ids:
        return 0

    result = await db.execute(
        select(SwapProposal).where(
            SwapProposal.listing_item_id.in_(swap_item_ids),
            SwapProposal.status == SwapProposalStatus.ACCEPTED,
            SwapProposal.term_ended_notified_at.is_(None),
            SwapProposal.proposer_reservation_id.in_(
                circulation_bridge.reservation_ids_for_term_select(cast(uuid.UUID, term.id))
            ),
        )
    )
    proposals = list(result.scalars().all())
    if not proposals:
        return 0
    item_names = await circulation_bridge.list_product_names_for_items(
        db, {p.listing_item_id for p in proposals} | {p.offered_item_id for p in proposals}
    )

    preferences_by_item = {pref.item_id: pref for pref in preferences}
    for proposal in proposals:
        await outbox_service.append(
            db,
            event_type=swap_events.TERM_ENDED_SWAP,
            payload={
                "proposer_party_id": proposal.proposer_party_id,
                "owner_party_id": preferences_by_item[proposal.listing_item_id].owner_party_id,
                "proposal_id": proposal.id,
                "link_path": link_path,
                "listing_item_name": item_names.get(proposal.listing_item_id),
                "offered_item_name": item_names.get(proposal.offered_item_id),
                **details,
            },
        )
        proposal.term_ended_notified_at = datetime.utcnow()
    return len(proposals)


async def scan_for_term_ended(db: AsyncSession, *, window: timedelta = DEFAULT_WINDOW) -> None:
    """Entry point for both the APScheduler job (`term_end_worker`) and
    tests. Commits once at the end — the outbox-append and idempotency
    marker for every affected row across every just-ended Term land in one
    atomic transaction."""
    terms = await _find_terms_just_ended(db, window=window)
    link_paths: dict[uuid.UUID, str] = {}
    details_by_term: dict[uuid.UUID, dict[str, object]] = {}
    group_names = await repository.list_group_names(db, {t.circle_group_id for t in terms})
    for term in terms:
        term_id = cast(uuid.UUID, term.id)
        slug = await resolve_organizer_slug(db, term.circle_group_id)
        link_paths[term_id] = f"/{slug}/grupa/{term.circle_group_id}/term/{term.id}"
        # JSON-safe for the outbox: `occurs_on` travels as an ISO string.
        details_by_term[term_id] = {
            "occurs_on": term.occurs_on.isoformat(),
            "group_name": group_names.get(term.circle_group_id),
        }
    hand_over_events = (
        await _scan_hand_over_reservations(db, link_paths, details_by_term) if link_paths else 0
    )
    swap_events_emitted = 0

    for term in terms:
        eligible_party_ids = await _list_eligible_lister_party_ids(db, term)
        if not eligible_party_ids:
            continue
        preferences = await repository.list_item_listing_preferences_for_parties(
            db, eligible_party_ids
        )
        if not preferences:
            continue
        term_id = cast(uuid.UUID, term.id)
        swap_events_emitted += await _scan_swaps(
            db, preferences, term, link_paths[term_id], details_by_term[term_id]
        )
    await db.commit()

    # The job runs every minute; INFO only when it actually emitted something.
    level = logging.INFO if hand_over_events or swap_events_emitted else logging.DEBUG
    logger.log(
        level,
        "Term-end scan: %d terms, %d hand-over events, %d swap events",
        len(terms),
        hand_over_events,
        swap_events_emitted,
    )
