"""Wypożyczalnia business logic: `Inventory`/`InventoryItem` CRUD (against
the shared `app.product.Product` catalog), the `InventoryBalance` state
machine driven by `Reservation.status` transitions, and the points-ledger
posting logic.

This module is a flat re-export facade over the `domain/`, `application/`
and `infrastructure/` layers; `app.circulation.router` and
`app.groups.service` import every symbol they need from here. The
points-ledger accounting rules (the "credit the current holder" posting
rule, the flat `Decimal("1")` amount) are documented on
`app.circulation.infrastructure.ledger`.
"""

from __future__ import annotations

from app.circulation.application.accounts import (
    get_account_balance,
    get_transaction,
    list_transactions_for_account,
)
from app.circulation.application.identity import get_user_id_by_principal
from app.circulation.application.inventory import (
    create_inventory,
    get_inventory,
    get_or_create_personal_inventory,
    list_inventories,
)
from app.circulation.application.inventory_items import (
    get_item,
    get_item_balance,
    list_items,
    register_item,
    soft_delete_item,
    update_item,
)
from app.circulation.application.reservation_transitions import (
    cancel_reservation,
    confirm_reservation,
    fulfill_reservation,
)
from app.circulation.application.reservations import (
    create_lend_reservation,
    create_reservation,
    create_swap,
    get_reservation,
    list_reservations,
)

__all__ = [
    "cancel_reservation",
    "confirm_reservation",
    "create_inventory",
    "create_lend_reservation",
    "create_reservation",
    "create_swap",
    "fulfill_reservation",
    "get_account_balance",
    "get_inventory",
    "get_item",
    "get_item_balance",
    "get_or_create_personal_inventory",
    "get_reservation",
    "get_transaction",
    "get_user_id_by_principal",
    "list_inventories",
    "list_items",
    "list_reservations",
    "list_transactions_for_account",
    "register_item",
    "soft_delete_item",
    "update_item",
]
