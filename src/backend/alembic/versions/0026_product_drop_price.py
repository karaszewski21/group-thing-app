"""product drop price

Removes `products.price` (a `NUMERIC(19, 2) NOT NULL` column) — the product
catalog no longer tracks a price. `downgrade()` recreates the column
nullable, backfills every existing row to `0.00`, then re-tightens to
NOT NULL — mirroring `0020_needed_item_drop_category.py`'s
recreate-and-backfill downgrade. The pre-drop per-row price is not
recoverable.

Revision ID: 0026
Revises: 0025
Create Date: 2026-09-14
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0026"
down_revision: str | None = "0025"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("products", "price")


def downgrade() -> None:
    op.add_column("products", sa.Column("price", sa.Numeric(19, 2), nullable=True))
    op.execute("UPDATE products SET price = 0.00")
    op.alter_column("products", "price", existing_type=sa.Numeric(19, 2), nullable=False)
