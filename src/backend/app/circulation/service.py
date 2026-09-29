"""Wypożyczalnia business logic: `Inventory`/`InventoryItem` CRUD (against
the shared `app.product.Product` catalog), the `InventoryBalance` state
machine driven by `Reservation.status` transitions, and reads of the
item-movement ledger.

This module is a flat re-export facade over the `domain/`, `application/`
and `infrastructure/` layers; `app.circulation.router` and
`app.groups.service` import every symbol they need from here. The ledger
posting rules are documented on `app.circulation.infrastructure.ledger`.
"""

from __future__ import annotations

from app.circulation.application.identity import get_user_id_by_principal
from app.circulation.application.inventory import (
    create_inventory,
    get_inventory,
    get_or_create_personal_inventory,
    list_inventories,
)
from app.circulation.application.inventory_items import (
    get_active_reservation_id_for_item,
    get_item,
    get_item_balance,
    get_item_with_product_name,
    list_items,
    list_items_with_product_name,
    list_lent_out_items_with_product_name,
    register_item,
    resolve_owning_inventory,
    soft_delete_item,
    update_item,
)
from app.circulation.application.movements import get_transaction
from app.circulation.application.reservation_transitions import (
    cancel_exchange,
    cancel_reservation,
    confirm_reservation,
    fulfill_exchange,
    fulfill_reservation,
)
from app.circulation.application.reservations import (
    create_lend_reservation,
    create_reservation,
    create_return_reservation,
    get_reservation,
    list_active_hand_over_reservations_for_terms,
    list_active_reservations_for_taker,
    list_reservations,
)
from app.circulation.domain.reservation_rules import require_raw_route_reservation_type

__all__ = [
    "cancel_exchange",
    "cancel_reservation",
    "confirm_reservation",
    "create_inventory",
    "create_lend_reservation",
    "create_reservation",
    "create_return_reservation",
    "fulfill_exchange",
    "fulfill_reservation",
    "get_active_reservation_id_for_item",
    "get_inventory",
    "get_item",
    "get_item_balance",
    "get_item_with_product_name",
    "get_or_create_personal_inventory",
    "get_reservation",
    "get_transaction",
    "get_user_id_by_principal",
    "list_active_hand_over_reservations_for_terms",
    "list_active_reservations_for_taker",
    "list_inventories",
    "list_items",
    "list_items_with_product_name",
    "list_lent_out_items_with_product_name",
    "list_reservations",
    "register_item",
    "require_raw_route_reservation_type",
    "resolve_owning_inventory",
    "soft_delete_item",
    "update_item",
]
