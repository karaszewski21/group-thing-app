"""Points ledger ORM models (migration 0103) and the tunable `PointsConfig`.

`PointAccount` / `PointTransaction` / `PointEntry` form an append-only
ledger: every PARTY account belongs to one person's party, the single
EMISSION account is where awarded points come from, and each award is one
balanced transaction whose entries sum to 0. A balance is the SUM of an
account's entries; nothing is stored per account.

Cross-module references (`parties.id`) are plain FK-id columns, never a
`relationship()` crossing the module boundary, per
`standards/backend/models.md`.
"""

from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.base_model import BaseEntity


def _enum_column(enum_cls: type[enum.StrEnum], length: int) -> Enum:
    """See `app/party/models.py`'s identical helper for the full rationale."""
    return Enum(
        enum_cls,
        native_enum=False,
        length=length,
        values_callable=lambda cls: [member.value for member in cls],
    )


class PointAccountType(enum.StrEnum):
    PARTY = "PARTY"
    HELD = "HELD"
    EMISSION = "EMISSION"
    BURN = "BURN"


class PointTransactionType(enum.StrEnum):
    GIVE_FREE = "GIVE_FREE"
    EXCHANGE = "EXCHANGE"
    WISHLIST_MATCH = "WISHLIST_MATCH"
    ATTENDANCE = "ATTENDANCE"
    HOLD = "HOLD"
    SALE = "SALE"
    RELEASE = "RELEASE"


class PointSourceType(enum.StrEnum):
    RESERVATION = "RESERVATION"
    TERM_ATTENDANCE = "TERM_ATTENDANCE"


class PointAccount(BaseEntity):
    """A person's PARTY (available) or HELD (blocked by open POINTS
    reservations) account, one per `(party_id, account_type)`, created
    lazily; or one of the two system accounts (`party_id IS NULL`): the
    single EMISSION account seeded by 0105 and the single BURN account
    seeded by 0109."""

    __tablename__ = "point_accounts"
    __table_args__ = (
        UniqueConstraint(
            "party_id", "account_type", name="uq_point_accounts_party_id_account_type"
        ),
        CheckConstraint(
            "(account_type IN ('PARTY', 'HELD') AND party_id IS NOT NULL) "
            "OR (account_type IN ('EMISSION', 'BURN') AND party_id IS NULL)",
            name="ck_point_accounts_party_id_account_type",
        ),
        Index(
            "uq_point_accounts_account_type_emission",
            "account_type",
            unique=True,
            postgresql_where=text("account_type = 'EMISSION'"),
        ),
        Index(
            "uq_point_accounts_account_type_burn",
            "account_type",
            unique=True,
            postgresql_where=text("account_type = 'BURN'"),
        ),
    )

    account_type: Mapped[PointAccountType] = mapped_column(
        _enum_column(PointAccountType, 20), nullable=False
    )
    party_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_point_accounts_party_id_parties"),
        nullable=True,
    )

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on `(account_type, party_id)`."""
        if not isinstance(other, PointAccount):
            return NotImplemented
        return (self.account_type, self.party_id) == (other.account_type, other.party_id)

    def __hash__(self) -> int:
        return hash((self.account_type, self.party_id))


class PointTransaction(BaseEntity):
    """One award. `party_id` is the beneficiary (for EXCHANGE the lower of
    the two party ids); `counterparty_party_id` and `cap_month` are set
    exactly for the non-ATTENDANCE and the ATTENDANCE types respectively.
    `description` is the subject text frozen at posting."""

    __tablename__ = "point_transactions"
    __table_args__ = (
        UniqueConstraint(
            "transaction_type",
            "source_type",
            "source_id",
            name="uq_point_transactions_type_source",
        ),
        Index(
            "ix_point_transactions_party_counterparty_occurred_at",
            "party_id",
            "counterparty_party_id",
            "occurred_at",
        ),
        CheckConstraint(
            "(transaction_type = 'ATTENDANCE') = (counterparty_party_id IS NULL)",
            name="ck_point_transactions_counterparty",
        ),
        CheckConstraint(
            "(transaction_type = 'ATTENDANCE') = (cap_month IS NOT NULL)",
            name="ck_point_transactions_cap_month",
        ),
    )

    transaction_type: Mapped[PointTransactionType] = mapped_column(
        _enum_column(PointTransactionType, 20), nullable=False
    )
    source_type: Mapped[PointSourceType] = mapped_column(
        _enum_column(PointSourceType, 20), nullable=False
    )
    # Polymorphic source (a reservation or a term attendance), hence no FK.
    source_id: Mapped[uuid.UUID] = mapped_column(postgresql.UUID(as_uuid=True), nullable=False)
    party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_point_transactions_party_id_parties"),
        nullable=False,
    )
    counterparty_party_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_point_transactions_counterparty_party_id_parties"),
        nullable=True,
    )
    cap_month: Mapped[date | None] = mapped_column(Date(), nullable=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)

    entries: Mapped[list[PointEntry]] = relationship(
        "PointEntry", back_populates="transaction", order_by="PointEntry.id", lazy="raise"
    )

    def __eq__(self, other: Any) -> bool:
        """Business-key equality on the source key."""
        if not isinstance(other, PointTransaction):
            return NotImplemented
        return (self.transaction_type, self.source_type, self.source_id) == (
            other.transaction_type,
            other.source_type,
            other.source_id,
        )

    def __hash__(self) -> int:
        return hash((self.transaction_type, self.source_type, self.source_id))


class PointEntry(BaseEntity):
    """One line of an award: a non-zero `amount` on `account_id`."""

    __tablename__ = "point_entries"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="ck_point_entries_amount_nonzero"),
        Index("ix_point_entries_account_id_transaction_id", "account_id", "transaction_id"),
    )

    transaction_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey(
            "point_transactions.id", name="fk_point_entries_transaction_id_point_transactions"
        ),
        nullable=False,
    )
    account_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("point_accounts.id", name="fk_point_entries_account_id_point_accounts"),
        nullable=False,
    )
    amount: Mapped[int] = mapped_column(Integer, nullable=False)

    transaction: Mapped[PointTransaction] = relationship(
        PointTransaction, back_populates="entries", lazy="raise"
    )
    account: Mapped[PointAccount] = relationship(PointAccount, lazy="raise")


class PointsConfig(BaseEntity):
    """The single row of admin-tunable thresholds (`uq_points_config_singleton`
    on `((true))`), read at award, close and job time. `updated_at` doubles
    as the compare token of the admin PUT. `price_min_ratio` /
    `price_max_ratio`, `price_cap` and `price_step` bound an owner-set POINTS
    price; `max_points_offers` caps an owner's POINTS listings."""

    __tablename__ = "points_config"
    __table_args__ = (Index("uq_points_config_singleton", text("(true)"), unique=True),)

    base_small: Mapped[int] = mapped_column(Integer, nullable=False)
    base_medium: Mapped[int] = mapped_column(Integer, nullable=False)
    base_large: Mapped[int] = mapped_column(Integer, nullable=False)
    multiplier_new: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    multiplier_like_new: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    multiplier_good: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    multiplier_fair: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    multiplier_poor: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    swap_award: Mapped[int] = mapped_column(Integer, nullable=False)
    wants_bonus: Mapped[int] = mapped_column(Integer, nullable=False)
    # Ascending, 1–5 distinct values.
    attendance_levels: Mapped[list[int]] = mapped_column(postgresql.ARRAY(Integer), nullable=False)
    attendance_monthly_cap: Mapped[int] = mapped_column(Integer, nullable=False)
    attendance_min_present: Mapped[int] = mapped_column(Integer, nullable=False)
    attendance_auto_close_days: Mapped[int] = mapped_column(Integer, nullable=False)
    pair_reward_limit: Mapped[int] = mapped_column(Integer, nullable=False)
    pair_window_days: Mapped[int] = mapped_column(Integer, nullable=False)
    max_points_offers: Mapped[int] = mapped_column(Integer, nullable=False)
    price_min_ratio: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    price_max_ratio: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False)
    price_cap: Mapped[int] = mapped_column(Integer, nullable=False)
    price_step: Mapped[int] = mapped_column(Integer, nullable=False)
