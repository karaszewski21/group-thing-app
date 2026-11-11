"""rename inventory ledger tables

Schema only. Renames the item-movement ledger tables to the module that owns
them: `circulation_transactions` → `inventory_transactions` and
`circulation_entries` → `inventory_entries`, with their primary keys, the
unique transaction number, the four foreign keys of the entries and the
three entry indexes. Postgres 18 also names each NOT NULL constraint
`<table>_<column>_not_null`; those are renamed when present. No row changes,
so the downgrade is the exact reverse.

Revision ID: 0084
Revises: 0083
Create Date: 2026-11-11
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0084"
down_revision: str | None = "0083"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_TABLES = (
    ("circulation_transactions", "inventory_transactions"),
    ("circulation_entries", "inventory_entries"),
)
_CONSTRAINTS = (
    ("inventory_transactions", "pk_circulation_transactions", "pk_inventory_transactions"),
    (
        "inventory_transactions",
        "uq_circulation_transactions_transaction_number",
        "uq_inventory_transactions_transaction_number",
    ),
    ("inventory_entries", "pk_circulation_entries", "pk_inventory_entries"),
    (
        "inventory_entries",
        "fk_circulation_entries_transaction_id_circulation_transactions",
        "fk_inventory_entries_transaction_id_inventory_transactions",
    ),
    (
        "inventory_entries",
        "fk_circulation_entries_account_id_accounts",
        "fk_inventory_entries_account_id_accounts",
    ),
    (
        "inventory_entries",
        "fk_circulation_entries_item_id_inventory_items",
        "fk_inventory_entries_item_id_inventory_items",
    ),
    (
        "inventory_entries",
        "fk_circulation_entries_reservation_id_reservations",
        "fk_inventory_entries_reservation_id_reservations",
    ),
)
_INDEXES = (
    ("ix_circulation_entries_account_id", "ix_inventory_entries_account_id"),
    (
        "ix_circulation_entries_item_id_transaction_id",
        "ix_inventory_entries_item_id_transaction_id",
    ),
    ("ix_circulation_entries_transaction_id", "ix_inventory_entries_transaction_id"),
)


def _rename_not_null(table: str, old_prefix: str, new_prefix: str) -> None:
    op.execute(
        f"""
        DO $$
        DECLARE c record;
        BEGIN
            FOR c IN
                SELECT conname FROM pg_constraint
                WHERE conrelid = '{table}'::regclass AND contype = 'n'
                  AND conname LIKE '{old_prefix}\\_%\\_not\\_null'
            LOOP
                EXECUTE format(
                    'ALTER TABLE {table} RENAME CONSTRAINT %I TO %I',
                    c.conname,
                    '{new_prefix}' || substr(c.conname, length('{old_prefix}') + 1)
                );
            END LOOP;
        END $$;
        """
    )


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    for old, new in _TABLES:
        op.rename_table(old, new)
        _rename_not_null(new, old, new)
    for table, old, new in _CONSTRAINTS:
        op.execute(f"ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new}")
    for old, new in _INDEXES:
        op.execute(f"ALTER INDEX {old} RENAME TO {new}")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    for new, old in reversed(_INDEXES):
        op.execute(f"ALTER INDEX {old} RENAME TO {new}")
    for table, new, old in reversed(_CONSTRAINTS):
        op.execute(f"ALTER TABLE {table} RENAME CONSTRAINT {old} TO {new}")
    for new, old in reversed(_TABLES):
        _rename_not_null(old, old, new)
        op.rename_table(old, new)
