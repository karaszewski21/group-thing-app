"""backfill item listing status

Data only. Sets `inventory_items.listing_status = 'ACTIVE'` for every item
that has an `item_listing_preferences` row, so "ACTIVE ⇔ a pref row
exists" holds from the start. Kept for chain correctness even though `0069`
later deletes every item it touches on real data.

The downgrade resets every row to `'DRAFT'`.

Revision ID: 0065
Revises: 0064
Create Date: 2026-10-27
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0065"
down_revision: str | None = "0064"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE inventory_items SET listing_status = 'ACTIVE' "
        "WHERE id IN (SELECT item_id FROM item_listing_preferences)"
    )


def downgrade() -> None:
    op.execute("UPDATE inventory_items SET listing_status = 'DRAFT'")
