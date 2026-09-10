"""The Pledge->Reservation bridge into `app.circulation` (one-directional
dependency only, routed through `infrastructure/circulation_bridge`).
Each use case keeps its single trailing commit (D1); the mid-saga
commits inside `register_item` / `create_reservation` live in circulation."""

from __future__ import annotations

from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.users.service import get_profile_by_party, get_profile_by_principal

from ..infrastructure import circulation_bridge, notifications_bridge, product_bridge
from ..infrastructure.notifications_bridge import NotificationKind
from ..infrastructure.slug_resolver import resolve_organizer_slug
from ..models import Pledge, PledgeStatus
from ..schemas import FulfillPledgeRequest
from .circles import _group_role_party_id, get_current_leadership
from .pledges import _require_pledging_party, get_pledge
from .terms import get_needed_item, get_term


async def fulfill_pledge(
    db: AsyncSession, principal: Principal, pledge_id: int, data: FulfillPledgeRequest
) -> Pledge:
    """Attaches the concrete item the pledging guardian brings and opens the
    bridging `LEND` `Reservation`: `reservedBy` = the Term's currently active
    Organizer (they physically receive the item at the class).

    Two modes (`FulfillPledgeRequest` enforces exactly one):
    - `inventory_item_id` — a thing the guardian already owns (must be
      `AVAILABLE`); no new `InventoryItem` is registered.
    - `condition` (+ optional `product_id` override) — a fresh `InventoryItem`
      registered in the guardian's personal inventory, defaulting to the
      product the need names.
    """
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

    if data.inventory_item_id is not None:
        item = await circulation_bridge.get_item(db, data.inventory_item_id)
        inventory = await circulation_bridge.get_inventory(db, item.inventory_id)
        if (
            inventory.owner_user_id != profile.account_user_id
            or inventory.inventory_type != circulation_bridge.InventoryType.PERSONAL
        ):
            raise AccessDeniedException
        balance = await circulation_bridge.get_item_balance(db, cast(int, item.id))
        if balance.status != circulation_bridge.BalanceStatus.AVAILABLE:
            raise BusinessConflictException(
                "Nie można użyć tej rzeczy — jest zarezerwowana lub wypożyczona"
            )
    else:
        assert data.condition is not None  # FulfillPledgeRequest guarantees this
        inventory = await circulation_bridge.get_or_create_personal_inventory(
            db, profile.account_user_id
        )
        product_id = data.product_id if data.product_id is not None else needed_item.product_id
        item = await circulation_bridge.register_item(
            db, cast(int, inventory.id), product_id, data.condition.value
        )

    reservation = await circulation_bridge.create_lend_reservation(
        db, item_id=cast(int, item.id), reserved_by_user_id=organizer_profile.account_user_id
    )

    pledge.resolved_reservation_id = reservation.id

    product = await product_bridge.get_product(db, needed_item.product_id)
    slug = await resolve_organizer_slug(db, term.circle_group_id)
    await notifications_bridge.create_notification(
        db,
        party_id=organizer_profile.party_id,
        kind=NotificationKind.PLEDGE_ITEM_REGISTERED,
        message=(
            f'„{profile.display_name}" zarejestrował(a) przedmiot: {product.name} — czeka na odbiór'
        ),
        link_path=f"/{slug}/grupa/{term.circle_group_id}/term/{term.id}",
    )

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
