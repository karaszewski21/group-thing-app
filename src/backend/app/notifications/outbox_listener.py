"""Registers this vertical's outbox event handlers against
`app.outbox.registry`. Called once from `app.main`'s composition root (and
directly by tests that need the handlers wired without a full app lifespan).
Idempotent — a second call is a no-op.

Consumes `app.groups`' pledge-claim events by their `event_type` string
(`"groups.pledge_claimed"`/`"groups.pledge_withdrawn"`, defined at
`app.groups.domain.pledge_events`) — deliberately a wire-string agreement,
not a shared import: `app.notifications` never imports `app.groups`, keeping
the outbox/registry boundary the only thing producer and consumer share. The
Polish message template now lives entirely here, the module that already
owns `Notification.message`'s "fully pre-rendered string" contract —
`app.groups` only reports what happened (actor, product, link), never
notification text or `NotificationKind`."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.outbox import registry

from . import service
from .models import NotificationKind

_PLEDGE_CLAIMED = "groups.pledge_claimed"
_PLEDGE_WITHDRAWN = "groups.pledge_withdrawn"

__all__ = ["register"]


def register() -> None:
    """Idempotent against the registry's actual state (not a one-shot flag)
    so it's safe to call again after something has reset
    `app.outbox.registry` (e.g. a test fixture clearing it between tests)."""
    if _handle_pledge_claimed in registry.get_handlers(_PLEDGE_CLAIMED):
        return
    registry.register_handler(_PLEDGE_CLAIMED, _handle_pledge_claimed)
    registry.register_handler(_PLEDGE_WITHDRAWN, _handle_pledge_withdrawn)


async def _handle_pledge_claimed(db: AsyncSession, payload: dict[str, Any]) -> None:
    actor_name = payload["actor_name"]
    product_name = payload["product_name"]
    await service.create_notification(
        db,
        party_id=payload["organizer_party_id"],
        kind=NotificationKind.PLEDGE_CREATED,
        message=f'„{actor_name}" zadeklarował(a) przyniesienie: {product_name}',
        link_path=payload["link_path"],
    )


async def _handle_pledge_withdrawn(db: AsyncSession, payload: dict[str, Any]) -> None:
    actor_name = payload["actor_name"]
    product_name = payload["product_name"]
    await service.create_notification(
        db,
        party_id=payload["organizer_party_id"],
        kind=NotificationKind.PLEDGE_WITHDRAWN,
        message=f'„{actor_name}" zrezygnował(a) z przyniesienia: {product_name}',
        link_path=payload["link_path"],
    )
