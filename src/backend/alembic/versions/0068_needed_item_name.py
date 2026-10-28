"""needed item name

Schema only. A needed item becomes a plain name: adds
`needed_items.name VARCHAR(255) NOT NULL` (NOT NULL is safe because `0067`
emptied the table; a deliberate deviation from the additive-nullable
convention), then drops `fk_needed_items_product_id_products`,
`ix_needed_items_product_id` and `product_id`.

The downgrade first deletes every `pledges` and `needed_items` row (a
name-only needed item cannot be mapped back to a product), re-adds
`product_id UUID NOT NULL` with its index and FK, then drops `name`.

Revision ID: 0068
Revises: 0067
Create Date: 2026-10-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0068"
down_revision: str | None = "0067"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("needed_items", sa.Column("name", sa.String(length=255), nullable=False))
    op.drop_constraint("fk_needed_items_product_id_products", "needed_items", type_="foreignkey")
    op.drop_index("ix_needed_items_product_id", table_name="needed_items")
    op.drop_column("needed_items", "product_id")


def downgrade() -> None:
    op.execute("DELETE FROM pledges")
    op.execute("DELETE FROM needed_items")
    op.add_column(
        "needed_items",
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
    )
    op.create_index("ix_needed_items_product_id", "needed_items", ["product_id"])
    op.create_foreign_key(
        "fk_needed_items_product_id_products",
        "needed_items",
        "products",
        ["product_id"],
        ["id"],
    )
    op.drop_column("needed_items", "name")
