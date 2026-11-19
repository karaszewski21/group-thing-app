"""item owner inventory

Schema and data. Replaces `inventory_items.home_inventory_id` (set only
while an item was lent out) with `owner_inventory_id`, the item's owning
inventory, always set: `coalesce(home_inventory_id, inventory_id)`, so
ownership reads one column. Also drops what the loan model through VIRTUAL
inventories left behind:

- VIRTUAL inventories and their ledger accounts. The upgrade refuses while
  a VIRTUAL inventory holds an item or has ledger entries (an open loan of
  the old model); return those items first.
- `inventory_balances.lent_at` / `returned_at`, never written, and the
  RETURNED status, read as AVAILABLE everywhere, so such rows become
  AVAILABLE.
- the partial unique index on `(owner_user_id, inventory_type)` covering
  PERSONAL and VIRTUAL, recreated for PERSONAL only.

The downgrade restores the columns and the index; `home_inventory_id` is
set where the owner differs from the holder. Deleted VIRTUAL inventories,
the loan timestamps (always NULL) and the RETURNED status are not restored.

Revision ID: 0102
Revises: 0101
Create Date: 2026-11-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0102"
down_revision: str | None = "0101"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_OLD_INDEX = "uq_inventories_owner_type_personal_virtual"
_NEW_INDEX = "uq_inventories_owner_user_id_personal"

_VIRTUAL_IN_USE = """
SELECT count(*) FROM inventories i
WHERE i.inventory_type = 'VIRTUAL'
  AND (
    EXISTS (
        SELECT 1 FROM inventory_items x
        WHERE x.inventory_id = i.id OR x.home_inventory_id = i.id
    )
    OR EXISTS (
        SELECT 1 FROM inventory_entries e
        JOIN accounts a ON a.id = e.account_id
        WHERE a.inventory_id = i.id
    )
  )
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    in_use = op.get_bind().execute(sa.text(_VIRTUAL_IN_USE)).scalar_one()
    if in_use:
        raise RuntimeError(
            f"Cannot upgrade 0102: {in_use} VIRTUAL inventories still hold items or ledger "
            "entries (open loans of the old model). Return those items to their owners "
            "first, then rerun the upgrade."
        )

    op.add_column(
        "inventory_items",
        sa.Column("owner_inventory_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.execute(
        "UPDATE inventory_items SET owner_inventory_id = coalesce(home_inventory_id, inventory_id)"
    )
    op.alter_column("inventory_items", "owner_inventory_id", nullable=False)
    op.create_foreign_key(
        "fk_inventory_items_owner_inventory_id_inventories",
        "inventory_items",
        "inventories",
        ["owner_inventory_id"],
        ["id"],
    )
    op.create_index(
        "ix_inventory_items_owner_inventory_id", "inventory_items", ["owner_inventory_id"]
    )
    op.drop_constraint(
        "fk_inventory_items_home_inventory_id_inventories", "inventory_items", type_="foreignkey"
    )
    op.drop_column("inventory_items", "home_inventory_id")

    op.execute(
        "DELETE FROM accounts WHERE inventory_id IN "
        "(SELECT id FROM inventories WHERE inventory_type = 'VIRTUAL')"
    )
    op.execute("DELETE FROM inventories WHERE inventory_type = 'VIRTUAL'")
    op.drop_index(_OLD_INDEX, table_name="inventories")
    op.create_index(
        _NEW_INDEX,
        "inventories",
        ["owner_user_id", "inventory_type"],
        unique=True,
        postgresql_where=sa.text("inventory_type = 'PERSONAL'"),
    )

    op.execute("UPDATE inventory_balances SET status = 'AVAILABLE' WHERE status = 'RETURNED'")
    op.drop_column("inventory_balances", "lent_at")
    op.drop_column("inventory_balances", "returned_at")


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column("inventory_balances", sa.Column("returned_at", sa.TIMESTAMP(), nullable=True))
    op.add_column("inventory_balances", sa.Column("lent_at", sa.TIMESTAMP(), nullable=True))

    op.drop_index(_NEW_INDEX, table_name="inventories")
    op.create_index(
        _OLD_INDEX,
        "inventories",
        ["owner_user_id", "inventory_type"],
        unique=True,
        postgresql_where=sa.text("inventory_type IN ('PERSONAL', 'VIRTUAL')"),
    )

    op.add_column(
        "inventory_items",
        sa.Column("home_inventory_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_inventory_items_home_inventory_id_inventories",
        "inventory_items",
        "inventories",
        ["home_inventory_id"],
        ["id"],
    )
    op.execute(
        "UPDATE inventory_items SET home_inventory_id = owner_inventory_id "
        "WHERE owner_inventory_id <> inventory_id"
    )
    op.drop_index("ix_inventory_items_owner_inventory_id", table_name="inventory_items")
    op.drop_constraint(
        "fk_inventory_items_owner_inventory_id_inventories", "inventory_items", type_="foreignkey"
    )
    op.drop_column("inventory_items", "owner_inventory_id")
