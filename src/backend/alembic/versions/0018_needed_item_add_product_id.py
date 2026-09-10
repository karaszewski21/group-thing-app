"""needed_item add product_id (schema, additive nullable)

First of three revisions replacing `needed_items.category` (a plain
`VARCHAR(30)`, `native_enum=False` — no Postgres type, no index) with a
`product_id` FK into the shared `app.product` catalog:

  0018  add `product_id` nullable + FK + index   (this file)
  0019  backfill `product_id` from the legacy `category` value  (data only)
  0020  make `product_id` NOT NULL, drop `category`

Additive nullable column — old application code keeps working between 0018
and 0020. Fully reversible.

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("needed_items", sa.Column("product_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "fk_needed_items_product_id_products",
        "needed_items",
        "products",
        ["product_id"],
        ["id"],
    )
    op.create_index("ix_needed_items_product_id", "needed_items", ["product_id"])


def downgrade() -> None:
    op.drop_index("ix_needed_items_product_id", table_name="needed_items")
    op.drop_constraint("fk_needed_items_product_id_products", "needed_items", type_="foreignkey")
    op.drop_column("needed_items", "product_id")
