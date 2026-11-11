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
from typing import Any, cast

from sqlalchemy import (
    ColumnElement,
    Date,
    DateTime,
    ScalarSelect,
    Select,
    String,
    and_,
    case,
    column,
    func,
    or_,
    select,
    table,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.circulation.domain.item_privacy import ReservationEvent, ReservationTerm
from app.circulation.models import (
    Account,
    AccountType,
    BalanceStatus,
    CirculationEntry,
    CirculationTransaction,
    Inventory,
    InventoryBalance,
    InventoryItem,
    InventoryType,
    ItemCondition,
    MovementType,
    Reservation,
    ReservationStatus,
    ReservationType,
)
from app.groups.domain.organizer_slug import derive_party_slug
from app.product.models import Product

# Ad-hoc, typed Core references to other modules' tables — never their ORM
# models (`app.category`, `app.users`, `app.groups`), per
# `standards/backend/models.md`'s cross-module rule (precedent:
# `application/inventory_items.py`'s `_item_listing_preferences`). Only the
# columns the item page reads are declared. Events are reached the same way,
# never through `app.events`, so that module can keep importing circulation.
_categories = table(
    "categories",
    column("id", postgresql.UUID(as_uuid=True)),
    column("name", String),
)
_user_profiles = table(
    "user_profiles",
    column("account_user_id", postgresql.UUID(as_uuid=True)),
    column("party_id", postgresql.UUID(as_uuid=True)),
    column("display_name", String),
)
_terms = table(
    "terms",
    column("id", postgresql.UUID(as_uuid=True)),
    column("occurs_on", DateTime),
    column("circle_group_id", postgresql.UUID(as_uuid=True)),
)
_groups = table(
    "groups",
    column("id", postgresql.UUID(as_uuid=True)),
    column("name", String),
)
_events = table(
    "events",
    column("id", postgresql.UUID(as_uuid=True)),
    column("author_party_id", postgresql.UUID(as_uuid=True)),
    column("name", String),
    column("starts_at", DateTime),
)
# Only for the live-pickup-place check; responses still go through
# `infrastructure/locations_acl.py`.
_locations = table(
    "locations",
    column("id", postgresql.UUID(as_uuid=True)),
    column("deleted_at", DateTime),
)
_organizations = table(
    "organizations",
    column("id", postgresql.UUID(as_uuid=True)),
    column("slug", String),
)
# An Organization's owner is the party of its active OWNER membership, as in
# `app.organizations.service.get_own_organization`.
_organization_roles = table(
    "organization_roles",
    column("id", postgresql.UUID(as_uuid=True)),
    column("party_id", postgresql.UUID(as_uuid=True)),
    column("role_type", String),
)
_organization_memberships = table(
    "organization_memberships",
    column("from_role_id", postgresql.UUID(as_uuid=True)),
    column("to_organization_id", postgresql.UUID(as_uuid=True)),
    column("valid_to", Date),
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


async def find_party_id_by_user_id(db: AsyncSession, user_id: uuid.UUID) -> uuid.UUID | None:
    """The `parties.id` behind a `users.id`, read through the Core
    `_user_profiles` ref so circulation never imports `app.users`."""
    result = await db.execute(
        select(_user_profiles.c.party_id).where(_user_profiles.c.account_user_id == user_id)
    )
    return result.scalar_one_or_none()


async def find_item_live_location_id(db: AsyncSession, item_id: uuid.UUID) -> uuid.UUID | None:
    """The item's pickup place in one statement; `None` without a place or
    when the place is soft-deleted."""
    result = await db.execute(
        select(InventoryItem.location_id)
        .join(_locations, _locations.c.id == InventoryItem.location_id)
        .where(InventoryItem.id == item_id, _locations.c.deleted_at.is_(None))
    )
    return result.scalar_one_or_none()


async def get_item(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem | None:
    return await db.get(InventoryItem, item_id)


async def get_item_for_update(db: AsyncSession, item_id: uuid.UUID) -> InventoryItem | None:
    """The item under a FOR UPDATE row lock, re-read from the database even
    when already in the session, so its listing status changes one writer at
    a time."""
    result = await db.execute(
        select(InventoryItem)
        .where(InventoryItem.id == item_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


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


def inventory_items_with_product_select(inventory_id: uuid.UUID) -> Select[Any]:
    """`(id, inventory_id, home_inventory_id, product_id, product_name,
    condition, added_at, created_at, updated_at, listing_status, location_id,
    balance_status, reservation_id)` of every live item in `inventory_id`.
    `balance_status` is `None` for an item without a balance row;
    `reservation_id` is the newest PENDING/CONFIRMED reservation while the
    balance is RESERVED or IN_TRANSIT, as `GET /inventory-items/{id}/balance`
    reports it. Unexecuted, so another context can filter, count and page it
    in its own statements."""
    active_reservation = cast(
        "ScalarSelect[uuid.UUID | None]",
        (
            select(Reservation.id)
            .where(
                Reservation.item_id == InventoryItem.id,
                Reservation.status.in_((ReservationStatus.PENDING, ReservationStatus.CONFIRMED)),
            )
            .order_by(Reservation.reserved_at.desc(), Reservation.id.desc())
            .limit(1)
            .correlate(InventoryItem)
            .scalar_subquery()
        ),
    )
    return (
        select(
            InventoryItem.id.label("id"),
            InventoryItem.inventory_id.label("inventory_id"),
            InventoryItem.home_inventory_id.label("home_inventory_id"),
            InventoryItem.product_id.label("product_id"),
            Product.name.label("product_name"),
            InventoryItem.condition.label("condition"),
            InventoryItem.added_at.label("added_at"),
            InventoryItem.created_at.label("created_at"),
            InventoryItem.updated_at.label("updated_at"),
            InventoryItem.listing_status.label("listing_status"),
            InventoryItem.location_id.label("location_id"),
            InventoryBalance.status.label("balance_status"),
            case(
                (
                    InventoryBalance.status.in_(
                        (BalanceStatus.RESERVED, BalanceStatus.IN_TRANSIT)
                    ),
                    active_reservation,
                ),
                else_=None,
            ).label("reservation_id"),
        )
        .join(Product, Product.id == InventoryItem.product_id)
        .outerjoin(InventoryBalance, InventoryBalance.item_id == InventoryItem.id)
        .where(InventoryItem.inventory_id == inventory_id, InventoryItem.deleted_at.is_(None))
    )


@dataclass(frozen=True)
class AvailableItemView:
    item_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    condition: ItemCondition


_LISTABLE_BALANCE_STATUSES = (
    BalanceStatus.AVAILABLE,
    BalanceStatus.RESERVED,
    BalanceStatus.IN_TRANSIT,
)


def listed_items_with_product_select() -> Select[
    tuple[uuid.UUID, uuid.UUID, str, ItemCondition, BalanceStatus, uuid.UUID | None]
]:
    """`(item_id, product_id, product_name, condition, balance_status,
    reserved_by_user_id)` of every live (not soft-deleted) item whose balance
    is AVAILABLE, RESERVED or IN_TRANSIT. `reserved_by_user_id` is who
    receives the item under its newest active reservation, `None` while it
    is AVAILABLE. Unexecuted, so a caller can narrow it or join it as a
    subquery instead of shipping item ids back as an IN-list."""
    reserver = cast(
        "ScalarSelect[uuid.UUID | None]",
        (
            select(Reservation.reserved_by_user_id)
            .where(
                Reservation.item_id == InventoryItem.id,
                Reservation.status.in_((ReservationStatus.PENDING, ReservationStatus.CONFIRMED)),
            )
            .order_by(Reservation.created_at.desc(), Reservation.id.desc())
            .limit(1)
            .correlate(InventoryItem)
            .scalar_subquery()
        ),
    )
    return (
        select(
            InventoryBalance.item_id.label("item_id"),
            InventoryItem.product_id.label("product_id"),
            Product.name.label("product_name"),
            InventoryItem.condition.label("condition"),
            InventoryBalance.status.label("balance_status"),
            reserver.label("reserved_by_user_id"),
        )
        .join(InventoryBalance, InventoryBalance.item_id == InventoryItem.id)
        .join(Product, Product.id == InventoryItem.product_id)
        .where(
            InventoryItem.deleted_at.is_(None),
            InventoryBalance.status.in_(_LISTABLE_BALANCE_STATUSES),
        )
    )


async def list_available_items_with_product(
    db: AsyncSession, item_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, AvailableItemView]:
    """Which of `item_ids` are live and AVAILABLE, with their product, in
    one join."""
    if not item_ids:
        return {}
    result = await db.execute(
        select(
            InventoryItem.id,
            InventoryItem.product_id,
            Product.name,
            InventoryItem.condition,
        )
        .join(InventoryBalance, InventoryBalance.item_id == InventoryItem.id)
        .join(Product, Product.id == InventoryItem.product_id)
        .where(
            InventoryItem.id.in_(item_ids),
            InventoryItem.deleted_at.is_(None),
            InventoryBalance.status == BalanceStatus.AVAILABLE,
        )
        .order_by(InventoryItem.id)
    )
    return {
        item_id: AvailableItemView(item_id, product_id, product_name, condition)
        for item_id, product_id, product_name, condition in result.all()
    }


async def list_product_names_for_items(
    db: AsyncSession, item_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """Product name of each given item, soft-deleted items included, in one
    join."""
    if not item_ids:
        return {}
    result = await db.execute(
        select(InventoryItem.id, Product.name)
        .join(Product, Product.id == InventoryItem.product_id)
        .where(InventoryItem.id.in_(item_ids))
    )
    return {item_id: name for item_id, name in result.all()}


async def list_item_products(
    db: AsyncSession, item_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, tuple[uuid.UUID, str]]:
    """`{item_id: (product_id, product_name)}`, soft-deleted items included,
    in one join."""
    if not item_ids:
        return {}
    result = await db.execute(
        select(InventoryItem.id, Product.id, Product.name)
        .join(Product, Product.id == InventoryItem.product_id)
        .where(InventoryItem.id.in_(set(item_ids)))
    )
    return {item_id: (product_id, name) for item_id, product_id, name in result.all()}


async def list_item_refs(
    db: AsyncSession, item_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, datetime | None]]:
    """`{item_id: (product_name, deleted_at)}`, soft-deleted items included,
    in one join."""
    if not item_ids:
        return {}
    result = await db.execute(
        select(InventoryItem.id, Product.name, InventoryItem.deleted_at)
        .join(Product, Product.id == InventoryItem.product_id)
        .where(InventoryItem.id.in_(item_ids))
    )
    return {item_id: (name, deleted_at) for item_id, name, deleted_at in result.all()}


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


async def list_reservations_by_ids(
    db: AsyncSession, reservation_ids: Collection[uuid.UUID]
) -> list[Reservation]:
    if not reservation_ids:
        return []
    result = await db.execute(select(Reservation).where(Reservation.id.in_(set(reservation_ids))))
    return list(result.scalars().all())


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
    """Every `PENDING`/`CONFIRMED` GIFT reservation whose `term_id` is one
    of `term_ids` — the candidates of the term-end prompt. SWAP (prompted
    via `SwapProposal`) is excluded. Same query shape as
    `list_active_reservations_for_item`."""
    result = await db.execute(
        select(Reservation)
        .where(
            Reservation.term_id.in_(term_ids),
            Reservation.reservation_type == ReservationType.GIFT,
            Reservation.status.in_((ReservationStatus.PENDING, ReservationStatus.CONFIRMED)),
        )
        .order_by(Reservation.id)
    )
    return list(result.scalars().all())


def reservation_ids_for_term_select(term_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """Ids of every reservation made for `term_id`, unexecuted, for a caller
    to use as an IN-subquery."""
    return select(Reservation.id).where(Reservation.term_id == term_id)


async def list_active_hand_over_reservations_for_events(
    db: AsyncSession, event_ids: list[uuid.UUID]
) -> list[Reservation]:
    """`list_active_hand_over_reservations_for_terms` for Events."""
    result = await db.execute(
        select(Reservation)
        .where(
            Reservation.event_id.in_(event_ids),
            Reservation.reservation_type == ReservationType.GIFT,
            Reservation.status.in_((ReservationStatus.PENDING, ReservationStatus.CONFIRMED)),
        )
        .order_by(Reservation.id)
    )
    return list(result.scalars().all())


def reservation_ids_for_event_select(event_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """`reservation_ids_for_term_select` for an Event."""
    return select(Reservation.id).where(Reservation.event_id == event_id)


async def list_open_reservations_for_event(
    db: AsyncSession, event_id: uuid.UUID
) -> list[Reservation]:
    """Every `PENDING`/`CONFIRMED` reservation of `event_id`, both swap legs
    included: what deleting the Event cancels."""
    result = await db.execute(
        select(Reservation)
        .where(
            Reservation.event_id == event_id,
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
    )


@dataclass(frozen=True)
class ItemHistoryRow:
    """One ledger entry of the item with its transaction, the owner (and
    the owner's display name) of the entry's inventory — `None` for the
    EXTERNAL account — and its reservation's context date (the Term's
    `occurs_on` or the Event's `starts_at`; `None` once the Event is
    deleted)."""

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
    `user_profiles`, `terms` and `events` are read through the Core
    references."""
    result = await db.execute(
        select(
            CirculationTransaction.id,
            CirculationTransaction.occurred_at,
            CirculationTransaction.movement_type,
            CirculationEntry.quantity,
            Inventory.owner_user_id,
            _user_profiles.c.display_name,
            func.coalesce(_terms.c.occurs_on, _events.c.starts_at),
        )
        .select_from(CirculationEntry)
        .join(CirculationTransaction, CirculationTransaction.id == CirculationEntry.transaction_id)
        .outerjoin(Account, Account.id == CirculationEntry.account_id)
        .outerjoin(Inventory, Inventory.id == Account.inventory_id)
        .outerjoin(_user_profiles, _user_profiles.c.account_user_id == Inventory.owner_user_id)
        .outerjoin(Reservation, Reservation.id == CirculationEntry.reservation_id)
        .outerjoin(_terms, _terms.c.id == Reservation.term_id)
        .outerjoin(_events, _events.c.id == Reservation.event_id)
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


async def find_reservation_term(
    db: AsyncSession, term_id: uuid.UUID | None
) -> ReservationTerm | None:
    """`None` for an event or context-less reservation (`term_id` `None`)."""
    if term_id is None:
        return None
    result = await db.execute(
        select(_terms.c.occurs_on, _terms.c.circle_group_id, _groups.c.name)
        .join(_groups, _groups.c.id == _terms.c.circle_group_id)
        .where(_terms.c.id == term_id)
    )
    row = result.one_or_none()
    return ReservationTerm(*row) if row is not None else None


async def find_reservation_event(
    db: AsyncSession, event_id: uuid.UUID | None
) -> ReservationEvent | None:
    """The Event's date and name plus its author's public-URL slug (the
    author's own Organization slug, else the party hash), in one select;
    `None` for a term or context-less reservation."""
    if event_id is None:
        return None
    result = await db.execute(
        select(
            _events.c.starts_at,
            _events.c.name,
            _events.c.author_party_id,
            _organizations.c.slug,
        )
        .outerjoin(
            _organization_roles,
            and_(
                _organization_roles.c.party_id == _events.c.author_party_id,
                _organization_roles.c.role_type == "OWNER",
            ),
        )
        .outerjoin(
            _organization_memberships,
            and_(
                _organization_memberships.c.from_role_id == _organization_roles.c.id,
                _organization_memberships.c.valid_to.is_(None),
            ),
        )
        .outerjoin(
            _organizations,
            _organizations.c.id == _organization_memberships.c.to_organization_id,
        )
        .where(_events.c.id == event_id)
        .order_by(_organizations.c.slug.is_(None))
        .limit(1)
    )
    row = result.one_or_none()
    if row is None:
        return None
    starts_at, name, author_party_id, organization_slug = row
    return ReservationEvent(starts_at, name, derive_party_slug(author_party_id, organization_slug))
