"""item listing status

Schema only. Adds `inventory_items.listing_status VARCHAR(20) NOT NULL`
with server default `'DRAFT'`: the item's visibility, `ACTIVE` exactly when
an `item_listing_preferences` row exists for it (backfilled by `0065`).
NOT NULL is a deliberate deviation from the additive-nullable convention;
the server default covers existing rows.

The downgrade drops the column.

Revision ID: 0064
Revises: 0063
Create Date: 2026-10-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0064"
down_revision: str | None = "0063"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "inventory_items",
        sa.Column(
            "listing_status",
            sa.String(length=20),
            server_default=sa.text("'DRAFT'"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("inventory_items", "listing_status")
