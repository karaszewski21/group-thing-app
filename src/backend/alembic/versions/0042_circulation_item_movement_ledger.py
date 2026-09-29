"""circulation item-movement ledger

Turns `accounts` / `circulation_transactions` / `circulation_entries` from a
points ledger into a ledger of item movements between inventories: an
account is either the INVENTORY account of one `inventories` row or the
single EXTERNAL account, a transaction carries a `movement_type` and an
`occurred_at`, and an entry records `quantity` (-1/+1) of one `item_id`,
optionally for one `reservation_id`.

Deliberate deviation from "Separate Schema and Data"
(`standards/backend/migrations.md`): the data wipe, the schema change and
the account seed are one revision by user decision (pre-production app, dev
data only). The wipe has to run before the schema change, because the new
NOT NULL columns can only be added to empty tables. It clears the old
ledger, every item, reservation and pledge, and every row that points at
them (`_WIPE_STATEMENTS`, child before parent). Inventories, products,
needed items, terms and groups are kept, and each existing inventory gets
its INVENTORY account (`_SEED_ACCOUNTS_STATEMENTS`).

`downgrade()` restores the 0041 points schema on UUID types, with empty
ledger tables and without the `900-100` emission account (0041 has none).
Wiped data is not restored, as in `0007`; going below 0041 is impossible.

Revision ID: 0042
Revises: 0041
Create Date: 2026-09-28
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0042"
down_revision: str | None = "0041"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_WIPE_STATEMENTS: tuple[str, ...] = (
    "DELETE FROM circulation_entries",
    "DELETE FROM circulation_transactions",
    "DELETE FROM accounts",
    "DELETE FROM notifications WHERE reservation_id IS NOT NULL OR proposal_id IS NOT NULL "
    "OR kind IN ('PLEDGE_CREATED', 'PLEDGE_WITHDRAWN', 'PLEDGE_ITEM_REGISTERED', "
    "'TERM_ITEM_LISTING_TAKEN', 'SWAP_PROPOSED', 'SWAP_ACCEPTED', 'SWAP_REJECTED', "
    "'TERM_CONFIRMATION_NEEDED', 'TERM_ALREADY_RESOLVED')",
    "DELETE FROM outbox_entries WHERE event_type IN ('groups.term_ended_giveaway', "
    "'groups.term_ended_swap', 'groups.pledge_claimed', 'groups.pledge_withdrawn')",
    "DELETE FROM giveaway_term_end_markers",
    "DELETE FROM swap_proposals",
    "DELETE FROM item_listing_preferences",
    "DELETE FROM pledges",
    "DELETE FROM reservations",
    "DELETE FROM inventory_balances",
    "DELETE FROM inventory_items",
)

_SEED_ACCOUNTS_STATEMENTS: tuple[str, ...] = (
    "INSERT INTO accounts (id, account_type, inventory_id, created_at, updated_at) "
    "VALUES (gen_random_uuid(), 'EXTERNAL', NULL, now(), now())",
    "INSERT INTO accounts (id, account_type, inventory_id, created_at, updated_at) "
    "SELECT gen_random_uuid(), 'INVENTORY', id, now(), now() FROM inventories",
)

_LEDGER_TABLES_CHILD_FIRST: tuple[str, ...] = (
    "circulation_entries",
    "circulation_transactions",
    "accounts",
)


def upgrade() -> None:
    for statement in _WIPE_STATEMENTS:
        op.execute(statement)

    op.drop_index("ix_accounts_owner_user_id", table_name="accounts")
    op.drop_constraint("fk_accounts_owner_user_id_users", "accounts", type_="foreignkey")
    op.drop_constraint("uq_accounts_code", "accounts", type_="unique")
    op.drop_column("accounts", "code")
    op.drop_column("accounts", "name")
    op.drop_column("accounts", "owner_user_id")
    op.add_column(
        "accounts", sa.Column("inventory_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_accounts_inventory_id_inventories", "accounts", "inventories", ["inventory_id"], ["id"]
    )
    op.create_unique_constraint("uq_accounts_inventory_id", "accounts", ["inventory_id"])
    op.create_check_constraint(
        "ck_accounts_inventory_id_account_type",
        "accounts",
        "(account_type = 'INVENTORY' AND inventory_id IS NOT NULL) "
        "OR (account_type = 'EXTERNAL' AND inventory_id IS NULL)",
    )
    op.create_index(
        "uq_accounts_account_type_external",
        "accounts",
        ["account_type"],
        unique=True,
        postgresql_where=sa.text("account_type = 'EXTERNAL'"),
    )

    op.drop_column("circulation_transactions", "transaction_date")
    op.drop_column("circulation_transactions", "is_posted")
    op.add_column(
        "circulation_transactions",
        sa.Column("movement_type", sa.String(20), nullable=False),
    )
    op.add_column(
        "circulation_transactions",
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
    )

    op.drop_column("circulation_entries", "amount")
    op.drop_column("circulation_entries", "entry_side")
    op.drop_column("circulation_entries", "description")
    op.drop_column("circulation_entries", "entry_date")
    op.add_column(
        "circulation_entries",
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
    )
    op.add_column("circulation_entries", sa.Column("quantity", sa.Integer(), nullable=False))
    op.add_column(
        "circulation_entries",
        sa.Column("reservation_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_circulation_entries_item_id_inventory_items",
        "circulation_entries",
        "inventory_items",
        ["item_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_circulation_entries_reservation_id_reservations",
        "circulation_entries",
        "reservations",
        ["reservation_id"],
        ["id"],
    )
    op.create_index(
        "ix_circulation_entries_item_id_transaction_id",
        "circulation_entries",
        ["item_id", "transaction_id"],
    )

    for statement in _SEED_ACCOUNTS_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    for table in _LEDGER_TABLES_CHILD_FIRST:
        op.execute(f"DELETE FROM {table}")

    op.drop_index("ix_circulation_entries_item_id_transaction_id", table_name="circulation_entries")
    op.drop_constraint(
        "fk_circulation_entries_reservation_id_reservations",
        "circulation_entries",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_circulation_entries_item_id_inventory_items", "circulation_entries", type_="foreignkey"
    )
    op.drop_column("circulation_entries", "reservation_id")
    op.drop_column("circulation_entries", "quantity")
    op.drop_column("circulation_entries", "item_id")
    op.add_column(
        "circulation_entries",
        sa.Column("amount", sa.Numeric(precision=12, scale=2), nullable=False),
    )
    op.add_column("circulation_entries", sa.Column("entry_side", sa.String(10), nullable=False))
    op.add_column("circulation_entries", sa.Column("description", sa.String(500), nullable=False))
    op.add_column("circulation_entries", sa.Column("entry_date", sa.Date(), nullable=False))

    op.drop_column("circulation_transactions", "occurred_at")
    op.drop_column("circulation_transactions", "movement_type")
    op.add_column(
        "circulation_transactions", sa.Column("transaction_date", sa.Date(), nullable=False)
    )
    op.add_column(
        "circulation_transactions", sa.Column("is_posted", sa.Boolean(), nullable=False)
    )

    op.drop_index("uq_accounts_account_type_external", table_name="accounts")
    op.drop_constraint("ck_accounts_inventory_id_account_type", "accounts", type_="check")
    op.drop_constraint("uq_accounts_inventory_id", "accounts", type_="unique")
    op.drop_constraint("fk_accounts_inventory_id_inventories", "accounts", type_="foreignkey")
    op.drop_column("accounts", "inventory_id")
    op.add_column("accounts", sa.Column("code", sa.String(20), nullable=False))
    op.add_column("accounts", sa.Column("name", sa.String(255), nullable=False))
    op.add_column(
        "accounts", sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_unique_constraint("uq_accounts_code", "accounts", ["code"])
    op.create_foreign_key(
        "fk_accounts_owner_user_id_users", "accounts", "users", ["owner_user_id"], ["id"]
    )
    op.create_index("ix_accounts_owner_user_id", "accounts", ["owner_user_id"])
