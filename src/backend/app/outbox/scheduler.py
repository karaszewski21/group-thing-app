"""The outbox poll loop. Production-only — started as a background
`asyncio.Task` from `app.main`'s lifespan (and by the moderation worker),
not exercised by tests (tests call `app.outbox.dispatcher.dispatch_pending`
directly against their own session).
"""

from __future__ import annotations

import asyncio
from collections.abc import Collection

from app.db import async_session_factory

from .dispatcher import dispatch_pending

DEFAULT_INTERVAL_SECONDS = 60

__all__ = ["run_forever", "DEFAULT_INTERVAL_SECONDS"]


async def run_forever(
    *,
    interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
    batch_size: int = 50,
    event_types: Collection[str] | None = None,
    exclude_event_types: Collection[str] | None = None,
) -> None:
    while True:
        async with async_session_factory() as db:
            await dispatch_pending(
                db,
                batch_size=batch_size,
                event_types=event_types,
                exclude_event_types=exclude_event_types,
            )
        await asyncio.sleep(interval_seconds)
