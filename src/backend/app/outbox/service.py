"""Producer-facing API for `app.outbox`."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .models import OutboxEntry, OutboxStatus

__all__ = ["append"]


async def append(db: AsyncSession, *, event_type: str, payload: dict[str, Any]) -> None:
    """Stage an outbox row — no commit/flush. Mirrors
    `app.notifications.service.create_notification`: the caller's own
    trailing `db.commit()` persists this atomically with the aggregate write
    that produced the event."""
    db.add(
        OutboxEntry(
            event_type=event_type,
            payload=payload,
            status=OutboxStatus.PENDING,
            attempts=0,
        )
    )
