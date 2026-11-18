"""The `wants.bells_due` outbox handler. The matcher service stages one row
per at most 1000 stored MATCH pairs, the reminded wants in the first row:

    {"pairs": [["<want_id>", "<item_id>"], ...], "expiring": ["<want_id>", ...]}

Between the matcher's run and this handler a pair may have been deleted by
an edit, and its item may have left the seeker's sight, so a pair gets a
bell only while it is still stored as MATCH and passes `visible_matches`;
a reminder only while its want is ACTIVE. Everything runs in a savepoint:
the dispatcher commits after a failing handler too, and its retry must
start clean."""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from ..domain.status import WantStatus
from ..infrastructure import inventory_acl, outbox_acl
from ..models import Want, WantMatch, WantMatchTier
from .match_notifications import ExpiringWant, MatchedPair, write_bell_rows
from .reads import visible_matches

EVENT_TYPE = "wants.bells_due"

__all__ = ["EVENT_TYPE", "handle_bells_due", "register"]


def register() -> None:
    """Idempotent against the registry's actual state, as
    `app.notifications.outbox_listener.register`."""
    if handle_bells_due not in outbox_acl.get_handlers(EVENT_TYPE):
        outbox_acl.register_handler(EVENT_TYPE, handle_bells_due)


async def _visible_pairs(db: AsyncSession, pairs: list[MatchedPair]) -> list[MatchedPair]:
    """The pairs still stored as MATCH and visible to their want's seeker:
    one statement for the seekers, then one per distinct seeker."""
    if not pairs:
        return []
    seeker_rows = await db.execute(
        select(Want.id, Want.seeker_party_id).where(Want.id.in_({want_id for want_id, _ in pairs}))
    )
    seekers = dict(seeker_rows.tuples().all())
    by_seeker: defaultdict[uuid.UUID, list[MatchedPair]] = defaultdict(list)
    for pair in pairs:
        seeker = seekers.get(pair[0])
        if seeker is not None:
            by_seeker[seeker].append(pair)

    listed = inventory_acl.listed_items_with_product_select().subquery("listed")
    visible: list[MatchedPair] = []
    for seeker, seeker_pairs in by_seeker.items():
        rows = await db.execute(
            visible_matches(seeker, listed, WantMatch.want_id, WantMatch.item_id)
            .where(
                WantMatch.tier == WantMatchTier.MATCH,
                tuple_(WantMatch.want_id, WantMatch.item_id).in_(seeker_pairs),
            )
            .order_by(WantMatch.want_id, WantMatch.item_id)
        )
        visible.extend(rows.tuples())
    return visible


async def _expiring_wants(db: AsyncSession, want_ids: list[uuid.UUID]) -> list[ExpiringWant]:
    if not want_ids:
        return []
    rows = await db.execute(
        select(Want.id, Want.seeker_party_id, Want.name)
        .where(Want.id.in_(want_ids), Want.status == WantStatus.ACTIVE)
        .order_by(Want.id)
    )
    return [ExpiringWant(row.id, row.seeker_party_id, row.name) for row in rows]


async def handle_bells_due(db: AsyncSession, payload: dict[str, Any]) -> None:
    pairs = [(uuid.UUID(want_id), uuid.UUID(item_id)) for want_id, item_id in payload["pairs"]]
    expiring_ids = [uuid.UUID(want_id) for want_id in payload["expiring"]]
    async with db.begin_nested():
        await write_bell_rows(
            db,
            pairs=await _visible_pairs(db, pairs),
            expiring=await _expiring_wants(db, expiring_ids),
            now=datetime.utcnow(),
        )
