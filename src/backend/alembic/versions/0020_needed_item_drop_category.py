"""needed_item drop category, product_id NOT NULL (schema, tighten + drop)

Third of three revisions (see 0018's docstring). By now every `needed_items`
row has a `product_id` (0019). Tighten it to NOT NULL and drop the legacy
`category` column (a plain `VARCHAR(30)`, no index to drop).

`downgrade()` recreates `category` as a nullable `VARCHAR(30)`, backfills
every row to `'OTHER'`, then re-tightens — mirroring 0006's
recreate-and-backfill downgrade. The pre-0018 exact per-row category is not
recoverable (0019 already discarded it).

Revision ID: 0020
Revises: 0019
Create Date: 2026-09-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("needed_items", "product_id", existing_type=sa.BigInteger(), nullable=False)
    op.drop_column("needed_items", "category")


def downgrade() -> None:
    op.add_column("needed_items", sa.Column("category", sa.String(length=30), nullable=True))
    op.execute("UPDATE needed_items SET category = 'OTHER'")
    op.alter_column("needed_items", "category", existing_type=sa.String(length=30), nullable=False)
    op.alter_column("needed_items", "product_id", existing_type=sa.BigInteger(), nullable=True)
