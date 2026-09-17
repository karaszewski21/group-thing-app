"""Read-side queries for `app.circulation`: every `select()` / `db.get()`
for `Inventory` / `InventoryItem` / `InventoryBalance` / `Account` /
`CirculationEntry` / `CirculationTransaction` / `Reservation`, relocated
verbatim into named functions. Eager-loading options are preserved exactly
per `standards/backend/models.md`'s `lazy="raise"` contract. Never commits
or flushes; `EntityNotFoundException` raising stays in the `application/`
getter wrappers."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.circulation.models import (
    Account,
    CirculationEntry,
    CirculationTransaction,
    Inventory,
    InventoryBalance,
    InventoryItem,
    InventoryType,
    Reservation,
)
from app.product.models import Product


async def get_inventory(db: AsyncSession, inventory_id: int) -> Inventory | None:
    return await db.get(Inventory, inventory_id)


async def list_inventories(db: AsyncSession, owner_user_id: int | None) -> list[Inventory]:
    stmt = select(Inventory).order_by(Inventory.created_at.desc())
    if owner_user_id is not None:
        stmt = stmt.where(Inventory.owner_user_id == owner_user_id)
    return list((await db.execute(stmt)).scalars().all())


async def find_personal_inventory(db: AsyncSession, owner_user_id: int) -> Inventory | None:
    result = await db.execute(
        select(Inventory).where(
            Inventory.owner_user_id == owner_user_id,
            Inventory.inventory_type == InventoryType.PERSONAL,
        )
    )
    return result.scalars().first()


async def find_virtual_inventory(db: AsyncSession, owner_user_id: int) -> Inventory | None:
    result = await db.execute(
        select(Inventory).where(
            Inventory.owner_user_id == owner_user_id,
            Inventory.inventory_type == InventoryType.VIRTUAL,
        )
    )
    return result.scalars().first()


async def get_item(db: AsyncSession, item_id: int) -> InventoryItem | None:
    return await db.get(InventoryItem, item_id)


async def list_items_for_inventory(db: AsyncSession, inventory_id: int) -> list[InventoryItem]:
    result = await db.execute(
        select(InventoryItem).where(
            InventoryItem.inventory_id == inventory_id,
            InventoryItem.deleted_at.is_(None),
        )
    )
    return list(result.scalars().all())


async def list_items_for_inventory_with_product_name(
    db: AsyncSession, inventory_id: int
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


async def get_item_with_product_name(
    db: AsyncSession, item_id: int
) -> tuple[InventoryItem, str] | None:
    result = await db.execute(
        select(InventoryItem, Product.name)
        .join(Product, Product.id == InventoryItem.product_id)
        .where(InventoryItem.id == item_id)
    )
    row = result.first()
    return (row[0], row[1]) if row is not None else None


async def find_item_balance(db: AsyncSession, item_id: int) -> InventoryBalance | None:
    result = await db.execute(select(InventoryBalance).where(InventoryBalance.item_id == item_id))
    return result.scalar_one_or_none()


async def find_account_by_code(db: AsyncSession, code: str) -> Account | None:
    result = await db.execute(select(Account).where(Account.code == code))
    return result.scalar_one_or_none()


async def list_entries_for_account(db: AsyncSession, account_id: int) -> list[CirculationEntry]:
    result = await db.execute(
        select(CirculationEntry).where(CirculationEntry.account_id == account_id)
    )
    return list(result.scalars().all())


async def find_transaction_with_entries(
    db: AsyncSession, transaction_id: int
) -> CirculationTransaction | None:
    result = await db.execute(
        select(CirculationTransaction)
        .options(selectinload(CirculationTransaction.entries).joinedload(CirculationEntry.account))
        .where(CirculationTransaction.id == transaction_id)
    )
    return result.scalar_one_or_none()


async def list_transactions_for_account(
    db: AsyncSession, account_id: int
) -> list[CirculationTransaction]:
    result = await db.execute(
        select(CirculationTransaction)
        .join(CirculationEntry, CirculationEntry.transaction_id == CirculationTransaction.id)
        .options(selectinload(CirculationTransaction.entries).joinedload(CirculationEntry.account))
        .where(CirculationEntry.account_id == account_id)
        .order_by(CirculationTransaction.transaction_date.desc())
        .distinct()
    )
    return list(result.scalars().all())


async def get_reservation(db: AsyncSession, reservation_id: int) -> Reservation | None:
    return await db.get(Reservation, reservation_id)


async def list_reservations_for_item(db: AsyncSession, item_id: int) -> list[Reservation]:
    result = await db.execute(select(Reservation).where(Reservation.item_id == item_id))
    return list(result.scalars().all())
