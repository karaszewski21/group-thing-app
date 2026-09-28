"""Periodic background scan for `Term`s whose `occurs_on` has just passed,
emitting an idempotent outbox event for each still-open GIFT or LEND
`Reservation` and each `ACCEPTED` `SwapProposal` it affects — the trigger
`app.notifications.outbox_listener` listens for to prompt both parties to
call `confirm_transaction`.

Reads circulation state ONLY through `circulation_bridge` — this module
never imports `app.circulation` directly. GIFT/LEND candidates come from
`Reservation.term_id` (statuses `PENDING`/`CONFIRMED`; RETURN and SWAP
excluded), so Take-LEND, Pledge-LEND and GIFT are covered regardless of
listing preferences. SWAP candidates are still derived from the standing
`ItemListingPreference` of every party eligible for the Term (active
attendee, or its organizer) — see
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

__all__ = ["scan_for_term_ended", "DEFAULT_WINDOW"]

logger = logging.getLogger(__name__)


async def _find_terms_just_ended(db: AsyncSession, *, window: timedelta) -> list[Term]:
    """One bounded query — `occurs_on` in `[now - window, now]` — never a
    per-Term or unbounded scan, per `standards/backend/queries.md`."""
    # `Term.occurs_on` is a naive LOCAL wall-clock value (see
    # `TermResponse.occurs_on`'s docstring) — compared against server-local
    # `datetime.now()`, matching every other `occurs_on` comparison in
    # `term_item_listings.py`, not `datetime.utcnow()`.
    now = datetime.now()
    result = await db.execute(
        select(Term).where(Term.occurs_on >= now - window, Term.occurs_on <= now)
    )
    return list(result.scalars().all())


async def _scan_hand_over_reservations(db: AsyncSession, link_paths: dict[uuid.UUID, str]) -> int:
    """One bridge query for every just-ended Term's still-open GIFT/LEND
    reservations, minus those already carrying a `GiveawayTermEndMarker`.
    Deliberately independent of eligibility and `ItemListingPreference` — a
    Pledge-LEND has no listing preference behind it. Returns how many events
    it emitted."""
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

    emitted = 0
    for reservation in candidates:
        reservation_id = cast(uuid.UUID, reservation.id)
        if reservation_id in already_marked:
            continue
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
            },
        )
        db.add(GiveawayTermEndMarker(reservation_id=reservation_id, notified_at=datetime.utcnow()))
        emitted += 1
    return emitted


async def _scan_swaps(
    db: AsyncSession, preferences: list[ItemListingPreference], link_path: str
) -> int:
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
        )
    )
    proposals = list(result.scalars().all())
    if not proposals:
        return 0

    emitted = 0
    preferences_by_item = {pref.item_id: pref for pref in preferences}
    for proposal in proposals:
        preference = preferences_by_item.get(proposal.listing_item_id)
        if preference is None:
            continue
        await outbox_service.append(
            db,
            event_type=swap_events.TERM_ENDED_SWAP,
            payload={
                "proposer_party_id": proposal.proposer_party_id,
                "owner_party_id": preference.owner_party_id,
                "proposal_id": proposal.id,
                "link_path": link_path,
            },
        )
        proposal.term_ended_notified_at = datetime.utcnow()
        emitted += 1
    return emitted


async def scan_for_term_ended(db: AsyncSession, *, window: timedelta = DEFAULT_WINDOW) -> None:
    """Entry point for both the APScheduler job (`term_end_worker`) and
    tests. Commits once at the end — the outbox-append and idempotency
    marker for every affected row across every just-ended Term land in one
    atomic transaction."""
    terms = await _find_terms_just_ended(db, window=window)
    link_paths: dict[uuid.UUID, str] = {}
    for term in terms:
        slug = await resolve_organizer_slug(db, term.circle_group_id)
        link_paths[cast(uuid.UUID, term.id)] = f"/{slug}/grupa/{term.circle_group_id}/term/{term.id}"
    hand_over_events = await _scan_hand_over_reservations(db, link_paths) if link_paths else 0
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
        swap_events_emitted += await _scan_swaps(db, preferences, link_paths[cast(uuid.UUID, term.id)])
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
