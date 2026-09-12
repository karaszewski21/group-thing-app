"""Claims and dispatches PENDING outbox entries. Takes a plain `AsyncSession`
(not a session factory) so tests can call `dispatch_pending` directly against
their own fixture session — see `app.outbox.scheduler` for the production
loop that owns its own session per poll."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import registry
from .models import OutboxEntry, OutboxStatus

MAX_ATTEMPTS = 5

__all__ = ["dispatch_pending", "MAX_ATTEMPTS"]


async def _claim_batch(db: AsyncSession, batch_size: int) -> list[OutboxEntry]:
    stmt = (
        select(OutboxEntry)
        .where(OutboxEntry.status == OutboxStatus.PENDING)
        .order_by(OutboxEntry.id)
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    )
    return list((await db.execute(stmt)).scalars().all())


async def dispatch_pending(db: AsyncSession, *, batch_size: int = 50) -> int:
    """Claim up to `batch_size` PENDING entries and process each exactly
    once, committing after each so one failing entry doesn't roll back
    entries already processed in this call. `SELECT ... FOR UPDATE SKIP
    LOCKED` means a second concurrent poller never double-processes a row.

    An event type with no registered handler is still marked PROCESSED —
    nothing wanted it, which isn't a failure. A handler raising increments
    `attempts`/`last_error` and leaves the entry PENDING for a later poll,
    until `MAX_ATTEMPTS` is reached and it's marked FAILED (never re-raises
    into the caller — the poll loop must keep running)."""
    entries = await _claim_batch(db, batch_size)
    for entry in entries:
        try:
            for handler in registry.get_handlers(entry.event_type):
                await handler(db, entry.payload)
        except Exception as exc:  # isolate one bad entry from the poll loop
            entry.attempts += 1
            entry.last_error = str(exc)[:1000]
            if entry.attempts >= MAX_ATTEMPTS:
                entry.status = OutboxStatus.FAILED
        else:
            entry.status = OutboxStatus.PROCESSED
            entry.processed_at = datetime.utcnow()
        await db.commit()
    return len(entries)
