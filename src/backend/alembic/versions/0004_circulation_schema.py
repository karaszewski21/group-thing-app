"""circulation schema

Adds the Wypożyczalnia + points-accounting tables — `app/circulation/models.py`.
Implements the given, unchanged contract in
`docs/system-wypozyczalni-inventory-accounting.md`. One logical change (this
vertical's schema); the `900-100` emission-account seed row is a separate
data-only revision (0005).

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-04
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_ACCOUNT_SEQ = "account_seq"
_CIRCULATION_PRODUCT_SEQ = "circulation_product_seq"
_INVENTORY_SEQ = "inventory_seq"
_INVENTORY_ITEM_SEQ = "inventory_item_seq"
_INVENTORY_BALANCE_SEQ = "inventory_balance_seq"
_RESERVATION_SEQ = "reservation_seq"
_CIRCULATION_TRANSACTION_SEQ = "circulation_transaction_seq"
_CIRCULATION_ENTRY_SEQ = "circulation_entry_seq"


def _sequenced_id(sequence_name: str) -> sa.Column[Any]:
    return sa.Column(
        "id",
        sa.BigInteger(),
        server_default=sa.text(f"nextval('{sequence_name}')"),
        nullable=False,
    )


def _create_sequence(name: str) -> None:
    op.execute(f"CREATE SEQUENCE {name}")


def _own_sequence(sequence_name: str, table_name: str) -> None:
    op.execute(f"ALTER SEQUENCE {sequence_name} OWNED BY {table_name}.id")


def upgrade() -> None:
    # --- accounts -----------------------------------------------------
    _create_sequence(_ACCOUNT_SEQ)
    op.create_table(
        "accounts",
        _sequenced_id(_ACCOUNT_SEQ),
        sa.Column("code", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("account_type", sa.String(length=20), nullable=False),
        sa.Column("owner_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_accounts"),
        sa.UniqueConstraint("code", name="uq_accounts_code"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], name="fk_accounts_owner_user_id_users"),
    )
    _own_sequence(_ACCOUNT_SEQ, "accounts")
    op.create_index("ix_accounts_owner_user_id", "accounts", ["owner_user_id"], unique=False)

    # --- circulation_products -----------------------------------------
    _create_sequence(_CIRCULATION_PRODUCT_SEQ)
    op.create_table(
        "circulation_products",
        _sequenced_id(_CIRCULATION_PRODUCT_SEQ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("manufacturer", sa.String(length=255), nullable=True),
        sa.Column("item_type", sa.String(length=50), nullable=False),
        sa.Column("value", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_circulation_products"),
    )
    _own_sequence(_CIRCULATION_PRODUCT_SEQ, "circulation_products")

    # --- inventories --------------------------------------------------
    _create_sequence(_INVENTORY_SEQ)
    op.create_table(
        "inventories",
        _sequenced_id(_INVENTORY_SEQ),
        sa.Column("owner_user_id", sa.BigInteger(), nullable=False),
        sa.Column("inventory_type", sa.String(length=20), nullable=False),
        sa.Column("location", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_inventories"),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"], name="fk_inventories_owner_user_id_users"),
    )
    _own_sequence(_INVENTORY_SEQ, "inventories")
    op.create_index("ix_inventories_owner_user_id", "inventories", ["owner_user_id"], unique=False)

    # --- inventory_items ------------------------------------------------
    _create_sequence(_INVENTORY_ITEM_SEQ)
    op.create_table(
        "inventory_items",
        _sequenced_id(_INVENTORY_ITEM_SEQ),
        sa.Column("inventory_id", sa.BigInteger(), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("condition", sa.String(length=20), nullable=False),
        sa.Column("added_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_inventory_items"),
        sa.ForeignKeyConstraint(
            ["inventory_id"], ["inventories.id"], name="fk_inventory_items_inventory_id_inventories"
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["circulation_products.id"],
            name="fk_inventory_items_product_id_circulation_products",
        ),
    )
    _own_sequence(_INVENTORY_ITEM_SEQ, "inventory_items")
    op.create_index("ix_inventory_items_inventory_id", "inventory_items", ["inventory_id"], unique=False)
    op.create_index("ix_inventory_items_product_id", "inventory_items", ["product_id"], unique=False)

    # --- inventory_balances -----------------------------------------------
    _create_sequence(_INVENTORY_BALANCE_SEQ)
    op.create_table(
        "inventory_balances",
        _sequenced_id(_INVENTORY_BALANCE_SEQ),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("reserved_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("lent_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("returned_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("due_date", sa.TIMESTAMP(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_inventory_balances"),
        sa.UniqueConstraint("item_id", name="uq_inventory_balances_item_id"),
        sa.ForeignKeyConstraint(
            ["item_id"], ["inventory_items.id"], name="fk_inventory_balances_item_id_inventory_items"
        ),
    )
    _own_sequence(_INVENTORY_BALANCE_SEQ, "inventory_balances")

    # --- reservations -------------------------------------------------
    _create_sequence(_RESERVATION_SEQ)
    op.create_table(
        "reservations",
        _sequenced_id(_RESERVATION_SEQ),
        sa.Column("item_id", sa.BigInteger(), nullable=False),
        sa.Column("reservation_type", sa.String(length=20), nullable=False),
        sa.Column("reserved_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column("paired_reservation_id", sa.BigInteger(), nullable=True),
        sa.Column("reserved_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("notes", sa.String(length=1000), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_reservations"),
        sa.ForeignKeyConstraint(
            ["item_id"], ["inventory_items.id"], name="fk_reservations_item_id_inventory_items"
        ),
        sa.ForeignKeyConstraint(
            ["reserved_by_user_id"], ["users.id"], name="fk_reservations_reserved_by_user_id_users"
        ),
        sa.ForeignKeyConstraint(
            ["paired_reservation_id"],
            ["reservations.id"],
            name="fk_reservations_paired_reservation_id_reservations",
        ),
    )
    _own_sequence(_RESERVATION_SEQ, "reservations")
    op.create_index("ix_reservations_item_id", "reservations", ["item_id"], unique=False)
    op.create_index("ix_reservations_reserved_by_user_id", "reservations", ["reserved_by_user_id"], unique=False)

    # --- circulation_transactions -----------------------------------------
    _create_sequence(_CIRCULATION_TRANSACTION_SEQ)
    op.create_table(
        "circulation_transactions",
        _sequenced_id(_CIRCULATION_TRANSACTION_SEQ),
        sa.Column("transaction_number", sa.String(length=50), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("is_posted", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_circulation_transactions"),
        sa.UniqueConstraint("transaction_number", name="uq_circulation_transactions_transaction_number"),
    )
    _own_sequence(_CIRCULATION_TRANSACTION_SEQ, "circulation_transactions")

    # --- circulation_entries -----------------------------------------------
    _create_sequence(_CIRCULATION_ENTRY_SEQ)
    op.create_table(
        "circulation_entries",
        _sequenced_id(_CIRCULATION_ENTRY_SEQ),
        sa.Column("transaction_id", sa.BigInteger(), nullable=False),
        sa.Column("account_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("entry_side", sa.String(length=10), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_circulation_entries"),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["circulation_transactions.id"],
            name="fk_circulation_entries_transaction_id_circulation_transactions",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"], ["accounts.id"], name="fk_circulation_entries_account_id_accounts"
        ),
    )
    _own_sequence(_CIRCULATION_ENTRY_SEQ, "circulation_entries")
    op.create_index("ix_circulation_entries_transaction_id", "circulation_entries", ["transaction_id"], unique=False)
    op.create_index("ix_circulation_entries_account_id", "circulation_entries", ["account_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_circulation_entries_account_id", table_name="circulation_entries")
    op.drop_index("ix_circulation_entries_transaction_id", table_name="circulation_entries")
    op.drop_table("circulation_entries")
    op.execute(f"DROP SEQUENCE IF EXISTS {_CIRCULATION_ENTRY_SEQ}")

    op.drop_table("circulation_transactions")
    op.execute(f"DROP SEQUENCE IF EXISTS {_CIRCULATION_TRANSACTION_SEQ}")

    op.drop_index("ix_reservations_reserved_by_user_id", table_name="reservations")
    op.drop_index("ix_reservations_item_id", table_name="reservations")
    op.drop_table("reservations")
    op.execute(f"DROP SEQUENCE IF EXISTS {_RESERVATION_SEQ}")

    op.drop_table("inventory_balances")
    op.execute(f"DROP SEQUENCE IF EXISTS {_INVENTORY_BALANCE_SEQ}")

    op.drop_index("ix_inventory_items_product_id", table_name="inventory_items")
    op.drop_index("ix_inventory_items_inventory_id", table_name="inventory_items")
    op.drop_table("inventory_items")
    op.execute(f"DROP SEQUENCE IF EXISTS {_INVENTORY_ITEM_SEQ}")

    op.drop_index("ix_inventories_owner_user_id", table_name="inventories")
    op.drop_table("inventories")
    op.execute(f"DROP SEQUENCE IF EXISTS {_INVENTORY_SEQ}")

    op.drop_table("circulation_products")
    op.execute(f"DROP SEQUENCE IF EXISTS {_CIRCULATION_PRODUCT_SEQ}")

    op.drop_index("ix_accounts_owner_user_id", table_name="accounts")
    op.drop_table("accounts")
    op.execute(f"DROP SEQUENCE IF EXISTS {_ACCOUNT_SEQ}")
