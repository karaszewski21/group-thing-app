"""Read-side queries for `app.circulation`: every `select()` / `db.get()`
for `Inventory` / `InventoryItem` / `InventoryBalance` / `Account` /
`CirculationEntry` / `CirculationTransaction` / `Reservation`, relocated
verbatim into named functions. Eager-loading options are preserved exactly
per `standards/backend/models.md`'s `lazy="raise"` contract. Never commits
or flushes; `EntityNotFoundException` raising stays in the `application/`
getter wrappers."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, DateTime, String, column, or_, select, table
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.circulation.models import (
    Account,
    AccountType,
    CirculationEntry,
    CirculationTransaction,
    Inventory,
    InventoryBalance,
    InventoryItem,
    InventoryType,
    MovementType,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.product.models import Product

# Ad-hoc, typed Core references to other modules' tables — never their ORM
# models (`app.category`, `app.users`, `app.groups`), per
# `standards/backend/models.md`'s cross-module rule (precedent:
# `application/inventory_items.py`'s `_item_listing_preferences`). Only the
# columns the item page reads are declared.
_categories = table(
    "categories",
    column("id", postgresql.UUID(as_uuid=True)),
    column("name", String),
)
_user_profiles = table(
    "user_profiles",
    column("account_user_id", postgresql.UUID(as_uuid=True)),
    column("display_name", String),
)
_terms = table(
    "terms",
    column("id", postgresql.UUID(as_uuid=True)),
    column("occurs_on", DateTime),
)


async def get_inventory(db: AsyncSession, inventory_id: uuid.UUID) -> Inventory | None:
    return await db.get(Inventory, inventory_id)


async def list_inventories(db: AsyncSession, owner_user_id: uuid.UUID | None) -> list[Inventory]:
    stmt = select(Inventory).order_by(Inventory.created_at.desc())
    if owner_user_id is not None:
        stmt = stmt.where(Inventory.owner_user_id == owner_user_id)
    return list((await db.execute(stmt)).scalars().all())


async def find_personal_inventory(db: AsyncSession, owner_user_id: uuid.UUID) -> Inventory | None:
    result = await db.execute(
        select(Inventory).where(
            Inventory.owner_user_id == owner_user_id,
            Inventory.inventory_type == InventoryType.PERSONAL,
        )
    )
    return result.scalars().first()


async def find_virtual_inventory(db: AsyncSession, owner_user_id: uuid.UUID) -> Inventory | None:
    result = await db.execute(
        select(Inventory).where(
            Inventory.owner_user_id == owner_user_id,
            Inventory.inventory_type == InventoryType.VIRTUAL,
        )
    )
    return result.scalars().first()


async def get_item(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem | None:
    return await db.get(InventoryItem, item_id)


async def list_items_for_inventory(db: AsyncSession, inventory_id: uuid.UUID) -> list[InventoryItem]:
    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.inventory_id == inventory_id,
            InventoryItem.deleted_at.is_(None),
        )
    )
    return list(result.scalars().all())


async def list_items_for_inventory_with_product_name(
    db: AsyncSession, inventory_id: uuid.UUID
) -> list[tuple[InventoryItem, str]]:
    """Joined read for the list endpoint's response, so the caller doesn't
    need a separate full-catalog fetch to resolve each item's product name
    (and doesn't pay an N+1 doing it item-by-item either) — an explicit
    query-level join into `app.product`'s table, never an ORM
    `relationship()` on `InventoryItem` itself, per
    `standards/backend/models.md`'s Cross-Module References."""
    result = await db.execute(
        select(InventoryItem, Product.name)
        .join(Product, Product.id == InventoryItem.product_id)
        .where(
            InventoryItem.inventory_id == inventory_id,
            InventoryItem.deleted_at.is_(None),
        )
    )
    return [(item, name) for item, name in result.all()]


async def list_lent_out_items_with_product_name(
    db: AsyncSession, home_inventory_id: uuid.UUID
) -> list[tuple[InventoryItem, str]]:
    """Items currently lent out of `home_inventory_id` — physically in a
    borrower's VIRTUAL inventory, with `home_inventory_id` pointing back
    home. Same explicit product join as
    `list_items_for_inventory_with_product_name`."""
    result = await db.execute(
        select(InventoryItem, Product.name)
        .join(Product, Product.id == InventoryItem.product_id)
        .where(
            InventoryItem.home_inventory_id == home_inventory_id,
            InventoryItem.deleted_at.is_(None),
        )
    )
    return [(item, name) for item, name in result.all()]


async def get_item_with_product_name(
    db: AsyncSession, item_id: uuid.UUID
) -> tuple[InventoryItem, str] | None:
    result = await db.execute(
        select(InventoryItem, Product.name)
        .join(Product, Product.id == InventoryItem.product_id)
        .where(InventoryItem.id == item_id)
    )
    row = result.first()
    return (row[0], row[1]) if row is not None else None


async def find_item_balance(db: AsyncSession, item_id: uuid.UUID) -> InventoryBalance | None:
    result = await db.execute(select(InventoryBalance).where(InventoryBalance.item_id == item_id))
    return result.scalar_one_or_none()


async def find_accounts_for_posting(
    db: AsyncSession, inventory_ids: Collection[uuid.UUID], include_external: bool
) -> list[Account]:
    """The INVENTORY accounts of `inventory_ids` (each with its `inventory`
    loaded) plus, when `include_external`, the EXTERNAL account, in one
    query."""
    condition: ColumnElement[bool] = Account.inventory_id.in_(inventory_ids)
    if include_external:
        condition = or_(condition, Account.account_type == AccountType.EXTERNAL)
    result = await db.execute(
        select(Account).options(joinedload(Account.inventory)).where(condition)
    )
    return list(result.scalars().all())


async def find_transaction_with_entries(
    db: AsyncSession, transaction_id: uuid.UUID
) -> CirculationTransaction | None:
    result = await db.execute(
        select(CirculationTransaction)
        .options(
            selectinload(CirculationTransaction.entries)
            .joinedload(CirculationEntry.account)
            .joinedload(Account.inventory)
        )
        .where(CirculationTransaction.id == transaction_id)
    )
    return result.scalar_one_or_none()


async def get_reservation(db: AsyncSession, reservation_id: uuid.UUID) -> Reservation | None:
    return await db.get(Reservation, reservation_id)


async def list_reservations_for_item(db: AsyncSession, item_id: uuid.UUID) -> list[Reservation]:
    result = await db.execute(select(Reservation).where(Reservation.item_id == item_id))
    return list(result.scalars().all())


async def list_active_reservations_for_taker(
    db: AsyncSession, account_user_id: uuid.UUID
) -> list[Reservation]:
    """Every `PENDING`/`CONFIRMED` reservation held by `account_user_id` as
    taker — sibling to `list_reservations_for_item` above, but scoped by
    taker identity instead of item. Backs the taker-side "my active
    reservations" query chain (availability-independent, unlike
    `list_browsable_term_item_listings`)."""
    result = await db.execute(
        select(Reservation).where(
            Reservation.reserved_by_user_id == account_user_id,
            Reservation.status.in_((ReservationStatus.PENDING, ReservationStatus.CONFIRMED)),
        )
    )
    return list(result.scalars().all())


async def list_active_reservations_for_item(db: AsyncSession, item_id: uuid.UUID) -> list[Reservation]:
    """Every `PENDING`/`CONFIRMED` reservation for `item_id` — same query
    shape as `list_active_reservations_for_taker`, scoped by item instead of
    taker. Backs `InventoryBalanceResponse.reservation_id` (bug #4c)."""
    result = await db.execute(
        select(Reservation).where(
            Reservation.item_id == item_id,
            Reservation.status.in_((ReservationStatus.PENDING, ReservationStatus.CONFIRMED)),
        )
    )
    return list(result.scalars().all())


async def list_active_hand_over_reservations_for_terms(
    db: AsyncSession, term_ids: list[uuid.UUID]
) -> list[Reservation]:
    """Every `PENDING`/`CONFIRMED` GIFT or LEND reservation whose `term_id`
    is one of `term_ids` — the candidates of the term-end prompt. RETURN
    (inherits its LEND's past `term_id`) and SWAP (prompted via
    `SwapProposal`) are excluded. Same query shape as
    `list_active_reservations_for_item`."""
    result = await db.execute(
        select(Reservation)
        .where(
            Reservation.term_id.in_(term_ids),
            Reservation.reservation_type.in_((ReservationType.GIFT, ReservationType.LEND)),
            Reservation.status.in_((ReservationStatus.PENDING, ReservationStatus.CONFIRMED)),
        )
        .order_by(Reservation.id)
    )
    return list(result.scalars().all())


@dataclass(frozen=True)
class ItemDetailsRow:
    item: InventoryItem
    product_name: str
    category_id: uuid.UUID
    category_name: str | None
    product_photo_url: str | None
    product_description: str | None
    plugin_data: dict[str, Any] | None
    product_text_status: str


async def get_item_details_row(db: AsyncSession, item_id: uuid.UUID) -> ItemDetailsRow | None:
    """The item with the product and category columns of its detail page,
    in one select (same shape as `get_item_with_product_name`). Deleted
    items are included; `categories` is read through the Core reference."""
    result = await db.execute(
        select(
            InventoryItem,
            Product.name,
            Product.category_id,
            _categories.c.name,
            Product.photo_url,
            Product.description,
            Product.plugin_data,
            Product.text_status,
        )
        .join(Product, Product.id == InventoryItem.product_id)
        .outerjoin(_categories, _categories.c.id == Product.category_id)
        .where(InventoryItem.id == item_id)
    )
    row = result.first()
    if row is None:
        return None
    return ItemDetailsRow(
        item=row[0],
        product_name=row[1],
        category_id=row[2],
        category_name=row[3],
        product_photo_url=row[4],
        product_description=row[5],
        plugin_data=row[6],
        product_text_status=row[7],
    )


@dataclass(frozen=True)
class ItemHistoryRow:
    """One ledger entry of the item with its transaction, the owner (and
    the owner's display name) of the entry's inventory — `None` for the
    EXTERNAL account — and its reservation's term date."""

    transaction_id: uuid.UUID
    occurred_at: datetime
    movement_type: MovementType
    quantity: int
    owner_user_id: uuid.UUID | None
    owner_display_name: str | None
    term_occurs_on: datetime | None


async def list_item_history_rows(db: AsyncSession, item_id: uuid.UUID) -> list[ItemHistoryRow]:
    """Every ledger entry of `item_id` in ONE select, newest movement first.
    `created_at` (Python-side insert time) breaks `occurred_at` ties by
    posting order; the random `id` only makes the order deterministic.
    `user_profiles` and `terms` are read through the Core references."""
    result = await db.execute(
        select(
            CirculationTransaction.id,
            CirculationTransaction.occurred_at,
            CirculationTransaction.movement_type,
            CirculationEntry.quantity,
            Inventory.owner_user_id,
            _user_profiles.c.display_name,
            _terms.c.occurs_on,
        )
        .select_from(CirculationEntry)
        .join(CirculationTransaction, CirculationTransaction.id == CirculationEntry.transaction_id)
        .outerjoin(Account, Account.id == CirculationEntry.account_id)
        .outerjoin(Inventory, Inventory.id == Account.inventory_id)
        .outerjoin(_user_profiles, _user_profiles.c.account_user_id == Inventory.owner_user_id)
        .outerjoin(Reservation, Reservation.id == CirculationEntry.reservation_id)
        .outerjoin(_terms, _terms.c.id == Reservation.term_id)
        .where(CirculationEntry.item_id == item_id)
        .order_by(
            CirculationTransaction.occurred_at.desc(),
            CirculationTransaction.created_at.desc(),
            CirculationTransaction.id.desc(),
        )
    )
    return [ItemHistoryRow(*row) for row in result.all()]


async def find_display_names(
    db: AsyncSession, user_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not user_ids:
        return {}
    result = await db.execute(
        select(_user_profiles.c.account_user_id, _user_profiles.c.display_name).where(
            _user_profiles.c.account_user_id.in_(user_ids)
        )
    )
    return {user_id: name for user_id, name in result.all()}


async def find_term_occurs_on(db: AsyncSession, term_id: uuid.UUID) -> datetime | None:
    result = await db.execute(select(_terms.c.occurs_on).where(_terms.c.id == term_id))
    occurs_on: datetime | None = result.scalar_one_or_none()
    return occurs_on
