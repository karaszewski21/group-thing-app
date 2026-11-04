"""Wypożyczalnia business logic: `Inventory`/`InventoryItem` CRUD (against
the shared `app.product.Product` catalog), the `InventoryBalance` state
machine driven by `Reservation.status` transitions, and reads of the
item-movement ledger.

This module is a flat re-export facade over the `domain/`, `application/`
and `infrastructure/` layers; `app.circulation.router` and
`app.groups.service` import every symbol they need from here. The ledger
posting rules are documented on `app.circulation.infrastructure.ledger`.
The only logic of its own is the party-only check on the public reservation
reads (`list_reservations_for_caller`, `get_reservation_for_caller`) and the
owner-only inventory item list (`list_own_items_with_product_name`).
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.identity import (
    find_user_id_by_principal,
    get_user_id_by_principal,
)
from app.circulation.application.inventory import (
    create_inventory,
    get_inventory,
    get_or_create_personal_inventory,
    list_inventories,
)
from app.circulation.application.inventory_items import (
    find_item_including_deleted,
    get_active_reservation_id_for_item,
    get_item,
    get_item_balance,
    get_item_for_update,
    get_item_with_product_name,
    list_available_items_with_product,
    list_items,
    list_items_with_product_name,
    list_product_names_for_items,
    register_item,
    resolve_owning_inventory,
    set_item_listing_status,
    soft_delete_item,
    update_item,
)
from app.circulation.application.item_details import get_item_details
from app.circulation.application.movements import get_item_history, get_transaction
from app.circulation.application.reservation_transitions import (
    cancel_exchange,
    cancel_reservation,
    cancel_reservations_without_commit,
    confirm_reservation,
    fulfill_exchange,
)
from app.circulation.application.reservations import (
    create_reservation,
    find_reservation_context_occurs_on,
    get_reservation,
    list_active_hand_over_reservations_for_events,
    list_active_hand_over_reservations_for_terms,
    list_active_reservations_for_taker,
    list_open_reservations_for_event,
    list_reservations,
)
from app.circulation.infrastructure.repository import (
    AvailableItemView,
    find_item_live_location_id,
    list_item_refs,
    listed_items_with_product_select,
    reservation_ids_for_event_select,
    reservation_ids_for_term_select,
)
from app.circulation.models import InventoryItem, Reservation
from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException

__all__ = [
    "AvailableItemView",
    "cancel_exchange",
    "cancel_reservation",
    "cancel_reservations_without_commit",
    "confirm_reservation",
    "create_inventory",
    "create_reservation",
    "fulfill_exchange",
    "find_item_including_deleted",
    "find_item_live_location_id",
    "find_reservation_context_occurs_on",
    "find_user_id_by_principal",
    "get_active_reservation_id_for_item",
    "get_inventory",
    "get_item",
    "get_item_balance",
    "get_item_details",
    "get_item_for_update",
    "get_item_history",
    "get_item_with_product_name",
    "get_or_create_personal_inventory",
    "get_reservation",
    "get_reservation_for_caller",
    "get_transaction",
    "get_user_id_by_principal",
    "list_active_hand_over_reservations_for_events",
    "list_active_hand_over_reservations_for_terms",
    "list_active_reservations_for_taker",
    "list_available_items_with_product",
    "list_inventories",
    "list_item_refs",
    "listed_items_with_product_select",
    "list_items",
    "list_items_with_product_name",
    "list_own_items_with_product_name",
    "list_open_reservations_for_event",
    "list_product_names_for_items",
    "list_reservations",
    "list_reservations_for_caller",
    "register_item",
    "reservation_ids_for_event_select",
    "reservation_ids_for_term_select",
    "resolve_owning_inventory",
    "set_item_listing_status",
    "soft_delete_item",
    "update_item",
]


def _is_party(reservation: Reservation, user_id: uuid.UUID | None) -> bool:
    return user_id is not None and user_id in (
        reservation.reserved_by_user_id,
        reservation.giver_user_id,
    )


async def list_reservations_for_caller(
    db: AsyncSession, principal: Principal, item_id: uuid.UUID
) -> list[Reservation]:
    """`item_id`'s reservations the caller is a party to (receiver or
    giver); `[]` for anyone else."""
    user_id = await find_user_id_by_principal(db, principal)
    return [r for r in await list_reservations(db, item_id) if _is_party(r, user_id)]


async def list_own_items_with_product_name(
    db: AsyncSession, principal: Principal, inventory_id: uuid.UUID
) -> list[tuple[InventoryItem, str]]:
    """`inventory_id`'s items for its owner, PRIVATE listings included: 404
    for an unknown inventory, then 403 for someone else's."""
    inventory = await get_inventory(db, inventory_id)
    if inventory.owner_user_id != await find_user_id_by_principal(db, principal):
        raise AccessDeniedException
    return await list_items_with_product_name(db, inventory_id)


async def get_reservation_for_caller(
    db: AsyncSession, principal: Principal, reservation_id: uuid.UUID
) -> Reservation:
    """The reservation for one of its parties; a 404 for anyone else, so
    others cannot learn it exists."""
    reservation = await get_reservation(db, reservation_id)
    if not _is_party(reservation, await find_user_id_by_principal(db, principal)):
        raise EntityNotFoundException("Reservation", reservation_id)
    return reservation
