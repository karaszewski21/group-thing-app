"""FastAPI application entrypoint.

Instantiates the app, wires CORS, registers every exception handler, and
includes every router from Groups 4-9 plus this group's own
`system.router` — in that order, since `system.router`'s SPA-fallback
catch-all (`/{full_path:path}`) must be registered LAST: FastAPI's router
matches in registration order, so every more-specific route needs to be
tried first.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.category.router import router as category_router
from app.circulation.router import router as circulation_router
from app.config import settings
from app.core.auth_deps import register_auth_exception_handlers
from app.core.errors import register_exception_handlers
from app.db import async_session_factory
from app.families.router import router as families_router
from app.groups.application.term_end_scan import scan_for_term_ended
from app.groups.router import router as groups_router
from app.notifications import outbox_listener as notifications_outbox_listener
from app.notifications.router import router as notifications_router
from app.oauth2.metadata_router import router as oauth2_metadata_router
from app.oauth2.router import router as oauth2_router
from app.organizations.router import router as organizations_router
from app.outbox import scheduler as outbox_scheduler
from app.plugin.router import router as plugin_router
from app.product.router import router as product_router
from app.system.router import router as system_router
from app.users.router import router as users_router

_outbox_task: asyncio.Task[None] | None = None
_term_end_scheduler: AsyncIOScheduler | None = None

# How often the term-end scan job runs — a plain constant, not a
# configurable-interval settings system, per
# `standards/global/minimal-implementation.md`.
_TERM_END_SCAN_INTERVAL_MINUTES = 5


async def _run_term_end_scan() -> None:
    async with async_session_factory() as db:
        await scan_for_term_ended(db)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Starts the 30s outbox poller as a background task alongside the app
    process, after wiring every vertical's outbox event handlers. Also
    starts the term-end scan job on an `AsyncIOScheduler` (APScheduler,
    interval-based) — the same "started on startup, cancelled/shut down on
    shutdown" lifecycle shape as the outbox poller, using APScheduler's own
    `start`/`shutdown(wait=False)` API rather than a second sleep loop."""
    global _outbox_task, _term_end_scheduler
    notifications_outbox_listener.register()
    _outbox_task = asyncio.create_task(outbox_scheduler.run_forever())

    _term_end_scheduler = AsyncIOScheduler()
    _term_end_scheduler.add_job(
        _run_term_end_scan, "interval", minutes=_TERM_END_SCAN_INTERVAL_MINUTES
    )
    _term_end_scheduler.start()

    yield

    _outbox_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await _outbox_task
    _term_end_scheduler.shutdown(wait=False)


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins_list,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    allow_credentials=True,
)

# Legacy flat-envelope handlers — global (Groups 3 and 4).
register_exception_handlers(app)
register_auth_exception_handlers(app)

# Routers — specific paths before the SPA catch-all (system_router last).
app.include_router(auth_router)
app.include_router(oauth2_router)
app.include_router(oauth2_metadata_router)
app.include_router(product_router)
app.include_router(category_router)
app.include_router(plugin_router)
app.include_router(users_router)
app.include_router(groups_router)
app.include_router(organizations_router)
app.include_router(families_router)
app.include_router(circulation_router)
app.include_router(notifications_router)
app.include_router(system_router)
