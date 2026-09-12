"""The actual 30s outbox poll loop. Production-only — started as a background
`asyncio.Task` from `app.main`'s lifespan, not exercised by tests (tests call
`app.outbox.dispatcher.dispatch_pending` directly against their own session).
"""

from __future__ import annotations

import asyncio

from app.db import async_session_factory

from .dispatcher import dispatch_pending

DEFAULT_INTERVAL_SECONDS = 60

__all__ = ["run_forever", "DEFAULT_INTERVAL_SECONDS"]


async def run_forever(*, interval_seconds: int = DEFAULT_INTERVAL_SECONDS) -> None:
    while True:
        async with async_session_factory() as db:
            await dispatch_pending(db)
        await asyncio.sleep(interval_seconds)
