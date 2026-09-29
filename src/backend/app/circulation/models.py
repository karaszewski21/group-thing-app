"""Wypożyczalnia (item circulation) ORM models and the item-movement ledger.

`Inventory` / `InventoryItem` / `InventoryBalance` / `Reservation` model
where items are and who is about to receive them. `Account` /
`CirculationTransaction` / `CirculationEntry` form an append-only ledger of
item movements between inventories: every inventory has exactly one
INVENTORY account, the single EXTERNAL account stands for the world outside
the system, and each movement is one balanced transaction of -1/+1 entries
per item. `InventoryItem.inventory_id` / `home_inventory_id` are the
projection of that ledger (see `docs/system-wypozyczalni-inventory-accounting.md`).
`InventoryItem.product_id` points at `app.product.models.Product`, the
shared product catalog.

Cross-module references (`users.id`, `products.id`, `terms.id`) are plain
FK-id columns, never a `relationship()` crossing the module boundary, per
`standards/backend/models.md`. `app.party` never appears here; the only
link back is the loose `Pledge.resolved_reservation_id` id column on the
*party* side (see `app/party/models.py`).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.base_model import BaseEntity


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """A `String`-backed column for a `StrEnum` that actually round-trips as
    the enum type on read, not a bare `str` — see `app/party/models.py`'s
    identical helper for the full rationale (`native_enum=False` keeps the
    DDL plain `VARCHAR`; `values_callable` stores/reads `.value`)."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class AccountType(enum.StrEnum):
    INVENTORY = "INVENTORY"
    EXTERNAL = "EXTERNAL"


class MovementType(enum.StrEnum):
    """LEND/RETURN/GIFT/SWAP share their values with `ReservationType`, so
    a fulfilled reservation maps to `MovementType(reservation_type.value)`."""

    REGISTER = "REGISTER"
    REMOVE = "REMOVE"
    GIFT = "GIFT"
    LEND = "LEND"
    RETURN = "RETURN"
    SWAP = "SWAP"


class InventoryType(enum.StrEnum):
    PERSONAL = "PERSONAL"
    PICKUP_POINT = "PICKUP_POINT"
    VIRTUAL = "VIRTUAL"


class ItemCondition(enum.StrEnum):
    NEW = "NEW"
    LIKE_NEW = "LIKE_NEW"
    GOOD = "GOOD"
    FAIR = "FAIR"
    POOR = "POOR"


class BalanceStatus(enum.StrEnum):
    AVAILABLE = "AVAILABLE"
    RESERVED = "RESERVED"
    IN_TRANSIT = "IN_TRANSIT"
    LENT = "LENT"
    RETURNED = "RETURNED"


class ReservationType(enum.StrEnum):
    LEND = "LEND"
    RETURN = "RETURN"
    SWAP = "SWAP"
    GIFT = "GIFT"


class ReservationStatus(enum.StrEnum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    CANCELLED = "CANCELLED"
    FULFILLED = "FULFILLED"


class Account(BaseEntity):
    """A ledger account: the INVENTORY account of exactly one `Inventory`,
    or the single EXTERNAL account (`inventory_id IS NULL`) that items come
    from on REGISTER and go to on REMOVE. The owner is derived through
    `inventory.owner_user_id`."""

    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("inventory_id", name="uq_accounts_inventory_id"),
        CheckConstraint(
            "(account_type = 'INVENTORY' AND inventory_id IS NOT NULL) "
            "OR (account_type = 'EXTERNAL' AND inventory_id IS NULL)",
            name="ck_accounts_inventory_id_account_type",
        ),
        Index(
            "uq_accounts_account_type_external",
            "account_type",
            unique=True,
            postgresql_where=text("account_type = 'EXTERNAL'"),
        ),
    )

    account_type: Mapped[AccountType] = mapped_column(_enum_column(AccountType, 20), nullable=False)
    inventory_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventories.id", name="fk_accounts_inventory_id_inventories"),
        nullable=True,
    )

    inventory: Mapped[Inventory | None] = relationship("Inventory", lazy="raise")

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `(account_type, inventory_id)`, never
        the surrogate id."""
        if not isinstance(other, Account):
            return NotImplemented
        return (self.account_type, self.inventory_id) == (other.account_type, other.inventory_id)

    def __hash__(self) -> int:
        return hash((self.account_type, self.inventory_id))


class Inventory(BaseEntity):
    """A user's warehouse. `location` is a single free-text label, not a
    normalized Address — no evidence anywhere in the source docs of a
    structured address shape beyond display text."""

    __tablename__ = "inventories"

    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_inventories_owner_user_id_users"),
        nullable=False,
    )
    inventory_type: Mapped[InventoryType] = mapped_column(
        _enum_column(InventoryType, 20), nullable=False
    )
    location: Mapped[str | None] = mapped_column(String(500), nullable=True)


class InventoryItem(BaseEntity):
    """A concrete unit of a `Product` on a shelf. Matches the reference
    doc's `InventoryItem` fields exactly (`inventoryId`, `productId`,
    `condition`, `addedAt`) — no own `name`/`description`, those live on the
    referenced `Product`."""

    __tablename__ = "inventory_items"

    inventory_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventories.id", name="fk_inventory_items_inventory_id_inventories"),
        nullable=False,
    )
    product_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("products.id", name="fk_inventory_items_product_id_products"),
        nullable=False,
    )
    condition: Mapped[ItemCondition] = mapped_column(
        _enum_column(ItemCondition, 20), nullable=False
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    # Set only while the item is temporarily elsewhere (lent out — see
    # `application/reservation_transitions.py`'s LEND/RETURN branches):
    # records the item's permanent inventory so a RETURN knows where to put
    # it back, since `inventory_id` itself points at the borrower's VIRTUAL
    # inventory for the loan's duration.
    home_inventory_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventories.id", name="fk_inventory_items_home_inventory_id_inventories"),
        nullable=True,
    )


class InventoryBalance(BaseEntity):
    """Availability/status Value Object for an `InventoryItem` — kept as its
    own 1:1 table (not columns merged onto `InventoryItem`) since the
    reference doc treats it as a distinct, explicitly-named concept."""

    __tablename__ = "inventory_balances"

    item_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventory_items.id", name="fk_inventory_balances_item_id_inventory_items"),
        nullable=False,
    )
    status: Mapped[BalanceStatus] = mapped_column(_enum_column(BalanceStatus, 20), nullable=False)
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    lent_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


class Reservation(BaseEntity):
    """The "cart" step preceding any change of possession. `reserved_by`
    always resolves to a `User`, never a `Group`/Family — see Insight 3 in
    the research synthesis."""

    __tablename__ = "reservations"

    item_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventory_items.id", name="fk_reservations_item_id_inventory_items"),
        nullable=False,
    )
    reservation_type: Mapped[ReservationType] = mapped_column(
        _enum_column(ReservationType, 20), nullable=False
    )
    reserved_by_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_reservations_reserved_by_user_id_users"),
        nullable=False,
    )
    # Who physically held the item when this reservation was created — the
    # party handing it over. Captured once here because, for GIFT/SWAP,
    # possession changes permanently at fulfillment, after which the item's
    # current holder no longer names the giving side of the transaction.
    giver_user_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("users.id", name="fk_reservations_giver_user_id_users"),
        nullable=False,
    )
    # Plain FK-id column, no ORM relationship — `Term` lives in the `groups`
    # module, and `circulation` must not take an ORM-level dependency on it,
    # per `standards/backend/models.md`'s cross-module-reference convention.
    # Required for every creation site: caller-supplied for LEND/SWAP/GIFT
    # (the creating use case has already resolved a `Term` by then), derived
    # server-side for RETURN (see `create_reservation`'s RETURN branch) since
    # a RETURN call site (e.g. `PanelDataContext.tsx::returnBorrowedItem`)
    # has no Term context of its own — a RETURN reverses a specific prior
    # LEND, so it just reuses that LEND leg's own `term_id`.
    term_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("terms.id", name="fk_reservations_term_id_terms"),
        nullable=False,
    )
    # Self-referential — only populated for `SWAP`, pointing at the other
    # item's Reservation in the same exchange.
    paired_reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("reservations.id", name="fk_reservations_paired_reservation_id_reservations"),
        nullable=True,
    )
    reserved_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    status: Mapped[ReservationStatus] = mapped_column(
        _enum_column(ReservationStatus, 20), nullable=False
    )
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)


class CirculationTransaction(BaseEntity):
    """One item movement: a balanced set of entries (per item -1 on the
    source account, +1 on the target account). Chronological order is
    `(occurred_at, id)`; `id` only breaks ties deterministically."""

    __tablename__ = "circulation_transactions"

    transaction_number: Mapped[str] = mapped_column(String(50), nullable=False)
    movement_type: Mapped[MovementType] = mapped_column(
        _enum_column(MovementType, 20), nullable=False
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)

    entries: Mapped[list[CirculationEntry]] = relationship(
        "CirculationEntry",
        back_populates="transaction",
        order_by="CirculationEntry.id",
        lazy="raise",
    )

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `transaction_number`."""
        if not isinstance(other, CirculationTransaction):
            return NotImplemented
        return self.transaction_number == other.transaction_number

    def __hash__(self) -> int:
        return hash(self.transaction_number)


class CirculationEntry(BaseEntity):
    """One line of a movement: `quantity` (-1 or +1) of `item_id` on
    `account_id`. `reservation_id` names the reservation of the movement's
    leg, NULL for REGISTER/REMOVE. No relationship to the item or the
    reservation: nothing reads them through the entry."""

    __tablename__ = "circulation_entries"
    __table_args__ = (
        Index("ix_circulation_entries_item_id_transaction_id", "item_id", "transaction_id"),
    )

    transaction_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey(
            "circulation_transactions.id",
            name="fk_circulation_entries_transaction_id_circulation_transactions",
        ),
        nullable=False,
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("accounts.id", name="fk_circulation_entries_account_id_accounts"),
        nullable=False,
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventory_items.id", name="fk_circulation_entries_item_id_inventory_items"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    reservation_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("reservations.id", name="fk_circulation_entries_reservation_id_reservations"),
        nullable=True,
    )

    transaction: Mapped[CirculationTransaction] = relationship(
        CirculationTransaction, back_populates="entries", lazy="raise"
    )
    account: Mapped[Account] = relationship(Account, lazy="raise")
