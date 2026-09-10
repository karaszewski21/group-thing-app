"""The Pledge->Reservation bridge into `app.circulation` (one-directional
dependency only, routed through `infrastructure/circulation_bridge`).
Each use case keeps its single trailing commit (D1); the mid-saga
commits inside `register_item` / `create_reservation` live in circulation."""

from __future__ import annotations

from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.users.service import get_profile_by_party, get_profile_by_principal

from ..infrastructure import circulation_bridge
from ..models import Pledge, PledgeStatus
from ..schemas import FulfillPledgeRequest
from .circles import _group_role_party_id, get_current_leadership
from .pledges import _require_pledging_party, get_pledge
from .terms import get_needed_item, get_term


async def fulfill_pledge(
    db: AsyncSession, principal: Principal, pledge_id: int, data: FulfillPledgeRequest
) -> Pledge:
    """Registers the concrete item the pledging guardian brings and opens
    the bridging `Reservation`: `reservedBy` = the Term's currently active
    Organizer (they physically receive the item at the class)."""
    pledge = await get_pledge(db, pledge_id)
    profile = await get_profile_by_principal(db, principal)
    _require_pledging_party(pledge, profile.party_id)

    needed_item = await get_needed_item(db, pledge.needed_item_id)
    term = await get_term(db, needed_item.term_id)
    leadership = await get_current_leadership(db, term.circle_group_id)
    if leadership is None:
        raise EntityNotFoundException("Leadership", term.circle_group_id)
    organizer_party_id = await _group_role_party_id(db, leadership.from_role_id)
    organizer_profile = await get_profile_by_party(db, organizer_party_id)

    inventory = await circulation_bridge.get_or_create_personal_inventory(
        db, profile.account_user_id
    )
    item = await circulation_bridge.register_item(
        db, cast(int, inventory.id), data.product_id, data.condition.value
    )
    reservation = await circulation_bridge.create_lend_reservation(
        db, item_id=cast(int, item.id), reserved_by_user_id=organizer_profile.account_user_id
    )

    pledge.resolved_reservation_id = reservation.id
    await db.commit()
    await db.refresh(pledge)
    return pledge


async def sync_pledge_fulfillment(db: AsyncSession, pledge_id: int) -> Pledge:
    pledge = await get_pledge(db, pledge_id)
    if pledge.resolved_reservation_id is None:
        raise AccessDeniedException
    reservation = await circulation_bridge.get_reservation(db, pledge.resolved_reservation_id)
    if reservation.status == circulation_bridge.ReservationStatus.FULFILLED:
        pledge.status = PledgeStatus.FULFILLED
        await db.commit()
        await db.refresh(pledge)
    return pledge
