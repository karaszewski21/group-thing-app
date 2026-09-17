"""inventory_items add home_inventory_id

Adds `app/circulation/models.py`'s `InventoryItem.home_inventory_id` —
nullable FK back into `inventories`, set only while an item is lent out
(`inventory_id` itself is temporarily repointed at the borrower's VIRTUAL
inventory for the loan's duration; `home_inventory_id` records where a
RETURN should put it back). Additive, backward-compatible column. No index
— never filtered/joined on, only read by the owning row.

Revision ID: 0030
Revises: 0029
Create Date: 2026-09-15
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0030"
down_revision: str | None = "0029"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inventory_items", sa.Column("home_inventory_id", sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        "fk_inventory_items_home_inventory_id_inventories",
        "inventory_items",
        "inventories",
        ["home_inventory_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_inventory_items_home_inventory_id_inventories",
        "inventory_items",
        type_="foreignkey",
    )
    op.drop_column("inventory_items", "home_inventory_id")
