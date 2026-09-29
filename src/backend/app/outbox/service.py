"""Producer-facing API for `app.outbox`."""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .models import OutboxEntry, OutboxStatus

__all__ = ["append"]


def _json_default(value: object) -> str:
    if isinstance(value, uuid.UUID):
        return str(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


async def append(db: AsyncSession, *, event_type: str, payload: dict[str, Any]) -> None:
    """Stage an outbox row — no commit/flush. Mirrors
    `app.notifications.service.create_notification`: the caller's own
    trailing `db.commit()` persists this atomically with the aggregate write
    that produced the event.

    The payload is normalized to its JSON wire form here (UUIDs become
    strings), so producers may pass ids as-is and consumers always see
    exactly what the JSONB column round-trips."""
    db.add(
        OutboxEntry(
            event_type=event_type,
            payload=json.loads(json.dumps(payload, default=_json_default)),
            status=OutboxStatus.PENDING,
            attempts=0,
        )
    )
