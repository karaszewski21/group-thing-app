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

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.outbox import registry

from . import service
from .models import NotificationKind

_PLEDGE_CLAIMED = "groups.pledge_claimed"
_PLEDGE_WITHDRAWN = "groups.pledge_withdrawn"
# Wire strings agreed with `app.groups.domain.swap_events` — same
# deliberate string-only contract as the pledge events above, not a shared
# import: `app.notifications` never imports `app.groups`.
_TERM_ENDED_GIVEAWAY = "groups.term_ended_giveaway"
_TERM_ENDED_SWAP = "groups.term_ended_swap"

__all__ = ["register"]


def register() -> None:
    """Idempotent against the registry's actual state (not a one-shot flag)
    so it's safe to call again after something has reset
    `app.outbox.registry` (e.g. a test fixture clearing it between tests)."""
    if _handle_pledge_claimed in registry.get_handlers(_PLEDGE_CLAIMED):
        return
    registry.register_handler(_PLEDGE_CLAIMED, _handle_pledge_claimed)
    registry.register_handler(_PLEDGE_WITHDRAWN, _handle_pledge_withdrawn)
    registry.register_handler(_TERM_ENDED_GIVEAWAY, _handle_term_ended_giveaway)
    registry.register_handler(_TERM_ENDED_SWAP, _handle_term_ended_swap)


async def _handle_pledge_claimed(db: AsyncSession, payload: dict[str, Any]) -> None:
    actor_name = payload["actor_name"]
    product_name = payload["product_name"]
    await service.create_notification(
        db,
        party_id=uuid.UUID(payload["organizer_party_id"]),
        kind=NotificationKind.PLEDGE_CREATED,
        message=f'„{actor_name}" zadeklarował(a) przyniesienie: {product_name}',
        link_path=payload["link_path"],
    )


async def _handle_pledge_withdrawn(db: AsyncSession, payload: dict[str, Any]) -> None:
    actor_name = payload["actor_name"]
    product_name = payload["product_name"]
    await service.create_notification(
        db,
        party_id=uuid.UUID(payload["organizer_party_id"]),
        kind=NotificationKind.PLEDGE_WITHDRAWN,
        message=f'„{actor_name}" zrezygnował(a) z przyniesienia: {product_name}',
        link_path=payload["link_path"],
    )


def _term_suffix(payload: dict[str, Any]) -> str | None:
    """`(śr 15.10, Grupa)`, or `None` for an event staged before the payload
    carried the Term details."""
    occurs_on = payload.get("occurs_on")
    group_name = payload.get("group_name")
    if not occurs_on or not group_name:
        return None
    day = clock.format_term_day(datetime.fromisoformat(occurs_on))
    return f"({day}, {group_name})"


async def _handle_term_ended_giveaway(db: AsyncSession, payload: dict[str, Any]) -> None:
    """One `Notification` for the taker of a GIFT `Reservation` whose Term
    just ended — same payload-driven, fully pre-rendered message shape as
    `_handle_pledge_claimed`. Only the taker is prompted, since only they
    may confirm a gift (the giver cancels from `Moje rzeczy` if needed); it
    carries `reservation_id` so the client can confirm it directly."""
    link_path = payload["link_path"]
    reservation_id = uuid.UUID(payload["reservation_id"])
    item_name = payload.get("item_name")
    suffix = _term_suffix(payload)
    if item_name and suffix:
        message = f"Czy przekazanie „{item_name}” doszło do skutku? {suffix}"
    else:
        message = "Czy przekazanie rzeczy doszło do skutku?"
    await service.create_notification(
        db,
        party_id=uuid.UUID(payload["taker_party_id"]),
        kind=NotificationKind.TERM_CONFIRMATION_NEEDED,
        message=clock.fit_notification_message(message),
        link_path=link_path,
        reservation_id=reservation_id,
    )


async def _handle_term_ended_swap(db: AsyncSession, payload: dict[str, Any]) -> None:
    """One `Notification` per party (the proposer and the listing owner) of
    an `ACCEPTED` `SwapProposal` whose Term just ended. Both carry
    `proposal_id`, which tells the client a swap prompt from a giveaway one."""
    link_path = payload["link_path"]
    proposal_id = uuid.UUID(payload["proposal_id"])
    listing_item_name = payload.get("listing_item_name")
    offered_item_name = payload.get("offered_item_name")
    suffix = _term_suffix(payload)
    if listing_item_name and offered_item_name and suffix:
        message = (
            f"Czy zamiana „{listing_item_name}” ↔ „{offered_item_name}” "
            f"doszła do skutku? {suffix}"
        )
    else:
        message = "Czy zamiana doszła do skutku?"
    for party_id in (payload["proposer_party_id"], payload["owner_party_id"]):
        await service.create_notification(
            db,
            party_id=uuid.UUID(party_id),
            kind=NotificationKind.TERM_CONFIRMATION_NEEDED,
            message=clock.fit_notification_message(message),
            link_path=link_path,
            proposal_id=proposal_id,
        )
