"""`InventoryItem` use cases for `app.circulation`, plus the ownership
gate guarding the edit/delete surface (co-located with the mutations it
guards, per `standards/backend/security.md`)."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Collection
from datetime import datetime

from sqlalchemy import column, func, select, table
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation.application.identity import get_user_id_by_principal
from app.circulation.application.inventory import get_inventory
from app.circulation.infrastructure import repository
from app.circulation.infrastructure.ledger import MovementLeg, post_movement
from app.circulation.infrastructure.repository import AvailableItemView
from app.circulation.models import (
    BalanceStatus,
    Inventory,
    InventoryBalance,
    InventoryItem,
    ItemCondition,
    MovementType,
)
from app.circulation.schemas import UpdateInventoryItemRequest
from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.product import service as product_service


async def register_item(
    db: AsyncSession,
    inventory_id: uuid.UUID,
    product_id: uuid.UUID,
    condition: str,
    *,
    owner_user_id: uuid.UUID | None = None,
) -> InventoryItem:
    """Registers a new item in `inventory_id` and posts its REGISTER
    movement from EXTERNAL in the same commit."""
    inventory = await get_inventory(db, inventory_id)
    if owner_user_id is not None and inventory.owner_user_id != owner_user_id:
        raise AccessDeniedException
    product = await product_service.get_product(db, product_id)

    item = InventoryItem(
        inventory_id=inventory_id,
        product_id=product_id,
        condition=ItemCondition(condition),
        added_at=datetime.utcnow(),
    )
    db.add(item)
    await db.flush()

    balance = InventoryBalance(item_id=item.id, status=BalanceStatus.AVAILABLE)
    db.add(balance)
    await post_movement(
        db,
        movement_type=MovementType.REGISTER,
        legs=[MovementLeg(item, None, inventory_id, None)],
        description=f"{MovementType.REGISTER}: {product.name}",
        occurred_at=item.added_at,
    )
    await db.commit()
    await db.refresh(item)
    return item


async def get_item(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem:
    item = await repository.get_item(db, item_id)
    if item is None:
        raise EntityNotFoundException("InventoryItem", item_id)
    if item.deleted_at is not None:
        raise EntityNotFoundException("InventoryItem", item_id)
    return item


async def get_item_for_share(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem:
    """`get_item` under a FOR SHARE lock on the item row: serializes with a
    concurrent re-point (`update_item`), so the caller reads the committed
    `product_id`."""
    item = await repository.get_item_for_share(db, item_id)
    if item is None or item.deleted_at is not None:
        raise EntityNotFoundException("InventoryItem", item_id)
    return item


async def find_item_including_deleted(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem | None:
    """The item even when soft-deleted; `None` only for an unknown id."""
    return await repository.get_item(db, item_id)


async def list_items(db: AsyncSession, inventory_id: uuid.UUID) -> list[InventoryItem]:
    return await repository.list_items_for_inventory(db, inventory_id)


async def list_items_with_product_name(
    db: AsyncSession, inventory_id: uuid.UUID
) -> list[tuple[InventoryItem, str]]:
    """Joined read backing `GET /api/inventory-items`'s response — the
    product name is resolved via one SQL join instead of the caller having
    to separately fetch the whole product catalog to label each item."""
    return await repository.list_items_for_inventory_with_product_name(db, inventory_id)


async def list_lent_out_items_with_product_name(
    db: AsyncSession, home_inventory_id: uuid.UUID
) -> list[tuple[InventoryItem, str]]:
    """Joined read backing `GET /api/inventory-items/mine/lent-out`."""
    return await repository.list_lent_out_items_with_product_name(db, home_inventory_id)


async def list_available_items_with_product(
    db: AsyncSession, item_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, AvailableItemView]:
    """Batched read backing the organizer page and the term page thumbnails."""
    return await repository.list_available_items_with_product(db, item_ids)


async def get_item_with_product_name(db: AsyncSession, item_id: uuid.UUID) -> tuple[InventoryItem, str]:
    """Joined read backing `GET /api/inventory-items/{id}`'s response."""
    row = await repository.get_item_with_product_name(db, item_id)
    if row is None or row[0].deleted_at is not None:
        raise EntityNotFoundException("InventoryItem", item_id)
    return row


async def get_item_balance(db: AsyncSession, item_id: uuid.UUID) -> InventoryBalance:
    balance = await repository.find_item_balance(db, item_id)
    if balance is None:
        raise EntityNotFoundException("InventoryBalance", item_id)
    return balance


async def get_active_reservation_id_for_item(
    db: AsyncSession, item_id: uuid.UUID, status: BalanceStatus
) -> uuid.UUID | None:
    """Resolves the item's in-flight `Reservation.id` for
    `InventoryBalanceResponse.reservation_id` (bug #4c) — `None` without
    querying unless `status` is `RESERVED`/`IN_TRANSIT` (the only statuses
    where a `PENDING`/`CONFIRMED` reservation can exist for the item), so
    the common `AVAILABLE`/`LENT`/`RETURNED` case costs nothing extra.
    Reuses `repository.list_active_reservations_for_item`'s query shape
    (same as `list_active_reservations_for_taker`, scoped by item) — no new
    query pattern. At most one active reservation exists per item at a time
    (the balance lock invariant), so the single match (if any) is it."""
    if status not in (BalanceStatus.RESERVED, BalanceStatus.IN_TRANSIT):
        return None
    reservations = await repository.list_active_reservations_for_item(db, item_id)
    if not reservations:
        return None
    return max(reservations, key=lambda r: r.reserved_at).id


async def resolve_owning_inventory(db: AsyncSession, item: InventoryItem) -> Inventory:
    """The item's *permanent* owning inventory — `home_inventory_id` when
    set (the item is currently lent out and `inventory_id` points at the
    borrower's VIRTUAL inventory instead), else `inventory_id` itself. Use
    this for ownership/permission decisions (edit/delete, listing
    preferences) — never the raw `inventory_id`, which reflects current
    *physical* location, not legal ownership, during a loan."""
    permanent_id = item.home_inventory_id if item.home_inventory_id is not None else item.inventory_id
    return await get_inventory(db, permanent_id)


# Ad-hoc Core reference to `app.groups`' `item_listing_preferences` table —
# never `app.groups.models.ItemListingPreference`, per `standards/backend/
# models.md`'s cross-module rule (mirrors `app.category.service`'s identical
# `_products` reference into `app.product`). `item_id` is the only column
# `_has_standing_listing` needs.
_item_listing_preferences = table("item_listing_preferences", column("item_id"))


class ItemHasStandingListingException(BusinessConflictException):
    """Raised when deleting an item that still has a standing `app.groups.
    ItemListingPreference` (an active "zamienię"/"pożyczę"/"oddam" mode,
    possibly with pending `SwapProposal`s against it) — deleting it out from
    under that listing would orphan the preference row and leave any
    proposer's locked counter-offer item stuck with no way to resolve."""

    def __init__(self, item_id: uuid.UUID) -> None:
        super().__init__(
            f"Nie można usunąć rzeczy {item_id} — jest wystawiona jako dostępna do "
            "wymiany. Wyłącz tryb wypożyczę/oddam/zamienię dla tej rzeczy, zanim ją usuniesz."
        )


async def _has_standing_listing(db: AsyncSession, item_id: uuid.UUID) -> bool:
    result = await db.execute(
        select(func.count())
        .select_from(_item_listing_preferences)
        .where(_item_listing_preferences.c.item_id == item_id)
    )
    return int(result.scalar_one()) > 0


async def _require_item_owner(
    db: AsyncSession, item_id: uuid.UUID, principal: Principal
) -> InventoryItem:
    """Ownership gate for the edit/delete surface: only the owner of the
    inventory holding an item may mutate it. Circulation deals in raw
    `users.id` (see `get_user_id_by_principal`), never `party_id`."""
    acting_user_id = await get_user_id_by_principal(db, principal)
    item = await get_item(db, item_id)
    inventory = await resolve_owning_inventory(db, item)
    if inventory.owner_user_id != acting_user_id:
        raise AccessDeniedException
    return item


async def update_item(
    db: AsyncSession,
    item_id: uuid.UUID,
    principal: Principal,
    data: UpdateInventoryItemRequest,
    on_product_changed: Callable[[AsyncSession, uuid.UUID, uuid.UUID], Awaitable[None]]
    | None = None,
) -> InventoryItem:
    """PATCH an item's `condition` and/or re-point it to another `product_id`.
    Allowed regardless of the item's `InventoryBalance` status — a reserved or
    lent item can still be corrected. When `product_id` actually changes, the
    flushed re-point is handed to `on_product_changed` (the router injects
    `app.groups`' listing withdraw — circulation never imports groups) before
    the single commit, so a failing hook leaves the re-point uncommitted too."""
    item = await _require_item_owner(db, item_id, principal)
    if data.product_id is not None and data.product_id != item.product_id:
        await product_service.get_product(db, data.product_id)
        item.product_id = data.product_id
        if on_product_changed is not None:
            await db.flush()
            await on_product_changed(db, item_id, data.product_id)
    if data.condition is not None:
        item.condition = data.condition
    await db.commit()
    await db.refresh(item)
    return item


async def soft_delete_item(db: AsyncSession, item_id: uuid.UUID, principal: Principal) -> None:
    """Soft-deletes an item by posting its REMOVE movement to EXTERNAL,
    which sets `deleted_at`. Blocked with a 409 when the item's balance is
    not `AVAILABLE` (a reserved/in-transit/lent item can't be withdrawn from
    circulation), when it still has a standing `app.groups.
    ItemListingPreference` (see `ItemHasStandingListingException`), and, by
    `post_movement`, when the item is away from its home inventory. The 1:1
    `InventoryBalance` row is left in place."""
    item = await _require_item_owner(db, item_id, principal)
    if await _has_standing_listing(db, item_id):
        raise ItemHasStandingListingException(item_id)
    balance = await get_item_balance(db, item_id)
    if balance.status != BalanceStatus.AVAILABLE:
        raise BusinessConflictException(
            "Nie można usunąć — rzecz jest zarezerwowana lub wypożyczona"
        )
    product = await product_service.get_product(db, item.product_id)
    await post_movement(
        db,
        movement_type=MovementType.REMOVE,
        legs=[MovementLeg(item, item.inventory_id, None, None)],
        description=f"{MovementType.REMOVE}: {product.name}",
        occurred_at=datetime.utcnow(),
    )
    await db.commit()
