"""`Pledge` use cases, with the pledging-party ownership gate co-located
with the mutations it guards (per `standards/backend/security.md`).

A needed item can be claimed by at most one active pledge — enforced here
(fail-fast 409) and by the `uq_pledges_active_needed_item` partial unique
index. Every state change emits an outbox event through the `outbox_bridge`
ACL (a missing organizer degrades to no event, never a 500); `app.notifications`
consumes those events asynchronously (see `app.notifications.outbox_listener`)
to build the Term organizer's notification — groups no longer knows
`NotificationKind` or builds notification text itself."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.users.service import get_profile_by_principal

from ..domain import pledge_events
from ..infrastructure import outbox_bridge, product_bridge, repository
from ..infrastructure.slug_resolver import resolve_organizer_slug
from ..models import Pledge, PledgeStatus
from .circles import _group_role_party_id, get_current_leadership
from .terms import get_needed_item


async def _emit_pledge_event(
    db: AsyncSession, needed_item_id: int, actor_name: str, event_type: str
) -> None:
    """Best-effort organizer-notification event for a pledge state change.
    Every lookup that could be absent (soft-deleted need, term gone, circle
    with no active organizer) short-circuits to no event — a pledge action
    must never 500 because a notification could not be addressed."""
    needed_item = await repository.get_needed_item(db, needed_item_id)
    if needed_item is None:
        return
    term = await repository.get_term(db, needed_item.term_id)
    if term is None:
        return
    leadership = await get_current_leadership(db, term.circle_group_id)
    if leadership is None:
        return
    organizer_party_id = await _group_role_party_id(db, leadership.from_role_id)
    product = await product_bridge.get_product(db, needed_item.product_id)
    slug = await resolve_organizer_slug(db, term.circle_group_id)
    await outbox_bridge.append_event(
        db,
        event_type=event_type,
        payload={
            "organizer_party_id": organizer_party_id,
            "actor_name": actor_name,
            "product_name": product.name,
            "link_path": f"/{slug}/grupa/{term.circle_group_id}/term/{term.id}",
        },
    )


async def create_pledge(db: AsyncSession, principal: Principal, needed_item_id: int) -> Pledge:
    profile = await get_profile_by_principal(db, principal)
    await get_needed_item(db, needed_item_id)

    existing = await repository.list_pledges_for_needed_item(db, needed_item_id)
    if any(pledge.status != PledgeStatus.WITHDRAWN for pledge in existing):
        raise BusinessConflictException("Ktoś już zadeklarował przyniesienie tej rzeczy")

    pledge = Pledge(
        needed_item_id=needed_item_id,
        pledged_by_party_id=profile.party_id,
        status=PledgeStatus.CLAIMED,
    )
    db.add(pledge)
    await _emit_pledge_event(
        db,
        needed_item_id,
        profile.display_name,
        pledge_events.PLEDGE_CLAIMED,
    )
    await db.commit()
    await db.refresh(pledge)
    return pledge


async def get_pledge(db: AsyncSession, pledge_id: int) -> Pledge:
    pledge = await repository.get_pledge(db, pledge_id)
    if pledge is None:
        raise EntityNotFoundException("Pledge", pledge_id)
    return pledge


async def list_pledges(db: AsyncSession, needed_item_id: int) -> list[Pledge]:
    await get_needed_item(db, needed_item_id)
    return await repository.list_pledges_for_needed_item(db, needed_item_id)


def _require_pledging_party(pledge: Pledge, party_id: int) -> None:
    if pledge.pledged_by_party_id != party_id:
        raise AccessDeniedException


async def withdraw_pledge(db: AsyncSession, principal: Principal, pledge_id: int) -> Pledge:
    pledge = await get_pledge(db, pledge_id)
    profile = await get_profile_by_principal(db, principal)
    _require_pledging_party(pledge, profile.party_id)

    already_withdrawn = pledge.status == PledgeStatus.WITHDRAWN
    pledge.status = PledgeStatus.WITHDRAWN
    if not already_withdrawn:
        await _emit_pledge_event(
            db,
            pledge.needed_item_id,
            profile.display_name,
            pledge_events.PLEDGE_WITHDRAWN,
        )
    await db.commit()
    await db.refresh(pledge)
    return pledge
