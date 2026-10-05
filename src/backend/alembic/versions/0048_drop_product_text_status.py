"""drop product text status

Schema only. Product texts are checked synchronously on write (rejected
before anything is stored), so the async moderation state on `products`
goes: `ix_products_text_status`, `text_moderated_hash` and `text_status`.
The downgrade restores them exactly as `0046` added them (existing rows get
APPROVED from the server default). Stop the old moderation worker before
applying this revision, as it still reads these columns. To roll back to
an image older than this revision, run `alembic downgrade 0046` with the
new image first: the old image does not know 0048.

Revision ID: 0048
Revises: 0047
Create Date: 2026-10-02
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0048"
down_revision: str | None = "0047"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.drop_index("ix_products_text_status", table_name="products")
    op.drop_column("products", "text_moderated_hash")
    op.drop_column("products", "text_status")


def downgrade() -> None:
    op.add_column(
        "products",
        sa.Column("text_status", sa.String(20), nullable=False, server_default="APPROVED"),
    )
    op.add_column("products", sa.Column("text_moderated_hash", sa.String(64), nullable=True))
    op.create_index("ix_products_text_status", "products", ["text_status"])
