"""Wypożyczalnia (item circulation) + points-accounting ORM models.

This vertical implements the **given, unchanged** contract described in
`docs/system-wypozyczalni-inventory-accounting.md` — an Accounting-archetype
(Fowler) points ledger rewarding circulation of items between users.
`InventoryItem.product_id` points at `app.product.models.Product` — the
single, shared product catalog (the standalone `CirculationProduct` catalog
this vertical used to keep separately was removed; see the product-catalog
unification plan).

Cross-module references (`users.id`, `products.id`) are plain FK-id
columns, never a `relationship()` crossing the module boundary, per
`standards/backend/models.md`. `app.party` never appears here — the only
link back is the loose `Pledge.resolved_reservation_id` id column on the
*party* side (see `app/party/models.py`).
"""

from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Enum, ForeignKey, Numeric, String
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
    USER_BALANCE = "USER_BALANCE"
    SYSTEM_EMISSION = "SYSTEM_EMISSION"


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


class EntrySide(enum.StrEnum):
    DEBIT = "DEBIT"
    CREDIT = "CREDIT"


class Account(BaseEntity):
    """A points ledger account — either a per-user balance (`100-100` per
    the reference doc) or the single system emission account (`900-100`,
    `owner_user_id IS NULL`)."""

    __tablename__ = "accounts"
    __sequence_name__ = "account_seq"

    code: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[AccountType] = mapped_column(_enum_column(AccountType, 20), nullable=False)
    owner_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", name="fk_accounts_owner_user_id_users"), nullable=True
    )

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `code` — the account code is this
        entity's real-world identifier, never the surrogate id."""
        if not isinstance(other, Account):
            return NotImplemented
        return self.code == other.code

    def __hash__(self) -> int:
        return hash(self.code)


class Inventory(BaseEntity):
    """A user's warehouse. `location` is a single free-text label, not a
    normalized Address — no evidence anywhere in the source docs of a
    structured address shape beyond display text."""

    __tablename__ = "inventories"
    __sequence_name__ = "inventory_seq"

    owner_user_id: Mapped[int] = mapped_column(
        BigInteger,
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
    __sequence_name__ = "inventory_item_seq"

    inventory_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("inventories.id", name="fk_inventory_items_inventory_id_inventories"),
        nullable=False,
    )
    product_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("products.id", name="fk_inventory_items_product_id_products"),
        nullable=False,
    )
    condition: Mapped[ItemCondition] = mapped_column(
        _enum_column(ItemCondition, 20), nullable=False
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


class InventoryBalance(BaseEntity):
    """Availability/status Value Object for an `InventoryItem` — kept as its
    own 1:1 table (not columns merged onto `InventoryItem`) since the
    reference doc treats it as a distinct, explicitly-named concept."""

    __tablename__ = "inventory_balances"
    __sequence_name__ = "inventory_balance_seq"

    item_id: Mapped[int] = mapped_column(
        BigInteger,
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
    __sequence_name__ = "reservation_seq"

    item_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("inventory_items.id", name="fk_reservations_item_id_inventory_items"),
        nullable=False,
    )
    reservation_type: Mapped[ReservationType] = mapped_column(
        _enum_column(ReservationType, 20), nullable=False
    )
    reserved_by_user_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("users.id", name="fk_reservations_reserved_by_user_id_users"),
        nullable=False,
    )
    # Self-referential — only populated for `SWAP`, pointing at the other
    # item's Reservation in the same exchange.
    paired_reservation_id: Mapped[int | None] = mapped_column(
        BigInteger,
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
    """A posted points-ledger transaction, created only when a `Reservation`
    reaches `fulfilled` — never at `pending`/`confirmed`."""

    __tablename__ = "circulation_transactions"
    __sequence_name__ = "circulation_transaction_seq"

    transaction_number: Mapped[str] = mapped_column(String(50), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date(), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    is_posted: Mapped[bool] = mapped_column(Boolean, nullable=False)

    entries: Mapped[list[CirculationEntry]] = relationship(
        "CirculationEntry", back_populates="transaction", lazy="raise"
    )

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `transaction_number`."""
        if not isinstance(other, CirculationTransaction):
            return NotImplemented
        return self.transaction_number == other.transaction_number

    def __hash__(self) -> int:
        return hash(self.transaction_number)


class CirculationEntry(BaseEntity):
    """One debit or credit line of a `CirculationTransaction`. Amounts use
    `Numeric`, never `Float`, per `standards/backend/models.md`."""

    __tablename__ = "circulation_entries"
    __sequence_name__ = "circulation_entry_seq"

    transaction_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "circulation_transactions.id",
            name="fk_circulation_entries_transaction_id_circulation_transactions",
        ),
        nullable=False,
    )
    account_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("accounts.id", name="fk_circulation_entries_account_id_accounts"),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(precision=12, scale=2), nullable=False)
    entry_side: Mapped[EntrySide] = mapped_column(_enum_column(EntrySide, 10), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    entry_date: Mapped[date] = mapped_column(Date(), nullable=False)

    transaction: Mapped[CirculationTransaction] = relationship(
        CirculationTransaction, back_populates="entries", lazy="raise"
    )
    account: Mapped[Account] = relationship(Account, lazy="raise")
