"""FastAPI application entrypoint.

Instantiates the app, wires CORS, registers every exception handler, and
includes every router from Groups 4-9/12 plus this group's own
`system.router` — in that order, since `system.router`'s SPA-fallback
catch-all (`/{full_path:path}`) must be registered LAST: FastAPI's router
matches in registration order, so every more-specific route needs to be
tried first.

Exception handlers: `app.core.errors` (Group 3) and `app.core.auth_deps`
(Group 4) register the legacy flat-envelope handlers globally — there is no
FastAPI equivalent of Spring's `@RestControllerAdvice(basePackages=...)`
scoping, so `app.footprint.errors` (Group 12) achieves the same effect by
registering its RFC7807 handlers against the 5 concrete footprint exception
*types* rather than by router/package. Those types share no MRO with
anything `app.core.errors`/`app.core.auth_deps` register, so registration
order between the two groups doesn't matter — but both must be registered
before the app can be considered fully wired.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.circulation.router import router as circulation_router
from app.config import settings
from app.core.auth_deps import register_auth_exception_handlers
from app.core.errors import register_exception_handlers
from app.families.router import router as families_router
from app.footprint.errors import register_footprint_exception_handlers
from app.footprint.router import router as footprint_router
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


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Starts the 30s outbox poller as a background task alongside the app
    process, after wiring every vertical's outbox event handlers. Cancels it
    cleanly on shutdown rather than leaving a dangling task."""
    global _outbox_task
    notifications_outbox_listener.register()
    _outbox_task = asyncio.create_task(outbox_scheduler.run_forever())
    yield
    _outbox_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await _outbox_task


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
# RFC7807 handlers — scoped to the 5 concrete footprint exception types
# only (Group 12); never shadows the legacy handlers above, even for
# ValueError/EntityNotFoundException raised from within the footprint
# module (the PER_100G bug and the export 404 both deliberately fall
# through to the legacy handlers, unchanged).
register_footprint_exception_handlers(app)

# Routers — specific paths before the SPA catch-all (system_router last).
app.include_router(auth_router)
app.include_router(oauth2_router)
app.include_router(oauth2_metadata_router)
app.include_router(product_router)
app.include_router(plugin_router)
app.include_router(footprint_router)
app.include_router(users_router)
app.include_router(groups_router)
app.include_router(organizations_router)
app.include_router(families_router)
app.include_router(circulation_router)
app.include_router(notifications_router)
app.include_router(system_router)
