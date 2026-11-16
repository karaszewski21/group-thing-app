"""The periodic scan of wants, one transaction per run: the sweep (expire,
remind, purge), then the match of the listings created since the previous
run, their bell rows, and the marker of how far the run has read.

Each window reaches `SCAN_OVERLAP` behind the previous one, for a listing
whose transaction committed after the run that should have seen it; the
unique key of a pair makes the repeat harmless. Every set-based update of
`wants` sets `updated_at`, the version column, so a seeker's write that
loaded the want before the run fails with a conflict instead of overwriting
it. The marker is written through the ORM for the same check: of two runs
racing for it one fails as a whole (`StaleDataError`, or `IntegrityError`
on `MARKER_UNIQUE_CONSTRAINT` when both are the first run), which the job
wrapper in `app.main` treats as a skipped run."""

from __future__ import annotations

import logging
import time
from datetime import datetime

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..domain.limits import REMINDER_LEAD, RETENTION, SCAN_INTERVAL, SCAN_OVERLAP
from ..domain.status import WantStatus
from ..infrastructure import groups_acl
from ..models import Want, WantScanMarker
from . import matcher
from .match_notifications import ExpiringWant, write_bell_rows

SCAN_NAME = "wants"
MARKER_UNIQUE_CONSTRAINT = "uq_want_scan_markers_scan_name"

__all__ = ["MARKER_UNIQUE_CONSTRAINT", "SCAN_NAME", "scan_wants"]

logger = logging.getLogger(__name__)

# The session of a run holds no want, so there is nothing to synchronise.
_SET_BASED = {"synchronize_session": False}


async def _expire(db: AsyncSession, now: datetime) -> int:
    result = await db.execute(
        update(Want)
        .where(Want.status == WantStatus.ACTIVE, Want.expires_at <= now)
        .values(status=WantStatus.EXPIRED, closed_at=Want.expires_at, updated_at=now)
        .returning(Want.id)
        .execution_options(**_SET_BASED)
    )
    return len(result.all())


async def _remind(db: AsyncSession, now: datetime) -> list[ExpiringWant]:
    """Once per validity period, whatever the want's notification switch."""
    result = await db.execute(
        update(Want)
        .where(
            Want.status == WantStatus.ACTIVE,
            Want.expires_at <= now + REMINDER_LEAD,
            Want.reminded_at.is_(None),
        )
        .values(reminded_at=now, updated_at=now)
        .returning(Want.id, Want.seeker_party_id, Want.name)
        .execution_options(**_SET_BASED)
    )
    return [ExpiringWant(row.id, row.seeker_party_id, row.name) for row in result]


async def _purge(db: AsyncSession, now: datetime) -> int:
    """Closed wants past the retention; their matches go with them, their
    bell rows stay."""
    result = await db.execute(
        delete(Want)
        .where(Want.status != WantStatus.ACTIVE, Want.closed_at <= now - RETENTION)
        .returning(Want.id)
        .execution_options(**_SET_BASED)
    )
    return len(result.all())


async def _window_sizes(
    db: AsyncSession, window_start: datetime, now: datetime
) -> tuple[int, int]:
    """Listings created in the window and matchable wants, for the log line."""
    preference = groups_acl.ItemListingPreference
    listings = (
        select(func.count())
        .select_from(preference)
        .where(preference.created_at > window_start, preference.created_at <= now)
        .scalar_subquery()
    )
    active_wants = (
        select(func.count())
        .select_from(Want)
        .where(Want.status == WantStatus.ACTIVE, Want.expires_at > now)
        .scalar_subquery()
    )
    row = (await db.execute(select(listings, active_wants))).one()
    return row[0], row[1]


async def scan_wants(db: AsyncSession, *, now: datetime | None = None) -> None:
    """One run, committed once. `now` (naive UTC) is the run's only clock.
    Raises `StaleDataError` or the marker's `IntegrityError` when another
    run moved the marker first; nothing of this run is then stored."""
    started = time.monotonic()
    now = now or datetime.utcnow()

    expired = await _expire(db, now)
    expiring = await _remind(db, now)
    purged = await _purge(db, now)

    marker = await db.scalar(select(WantScanMarker).where(WantScanMarker.scan_name == SCAN_NAME))
    if marker is None:
        window_start = now - SCAN_INTERVAL - SCAN_OVERLAP
    else:
        window_start = marker.scanned_through - SCAN_OVERLAP
    pairs = await matcher.match_new_listings(db, listed_after=window_start, now=now)
    notifications = await write_bell_rows(db, pairs=pairs, expiring=expiring, now=now)
    listings, active_wants = await _window_sizes(db, window_start, now)

    if marker is None:
        db.add(WantScanMarker(scan_name=SCAN_NAME, scanned_through=now))
    else:
        marker.scanned_through = now
    await db.commit()

    did_work = bool(pairs or notifications or expired or purged)
    logger.log(
        logging.INFO if did_work else logging.DEBUG,
        "want scan: window_start=%s window_end=%s listings=%d active_wants=%d pairs=%d "
        "notifications=%d expired=%d reminded=%d purged=%d duration_ms=%d",
        window_start.isoformat(),
        now.isoformat(),
        listings,
        active_wants,
        len(pairs),
        notifications,
        expired,
        len(expiring),
        purged,
        round((time.monotonic() - started) * 1000),
    )
