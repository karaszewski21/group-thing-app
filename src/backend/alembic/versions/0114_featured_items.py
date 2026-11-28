"""featured items

`item_listing_preferences.featured_at` (TIMESTAMP, NULL, naive UTC, no
backfill): set while the owner features the listed item, gone with the
listing row. The partial index
`ix_item_listing_preferences_owner_party_id_featured` on `(owner_party_id)
WHERE featured_at IS NOT NULL` serves the per-owner cap count.

The index is built in the migration's transaction, not concurrently: the
table holds one row per listed item, so it is small, and the predicate
matches no row yet because every `featured_at` is NULL. `lock_timeout`
bounds the brief lock.

Plain, lossy downgrade: drops the index, then the column, losing every
featured mark.

Revision ID: 0114
Revises: 0113
Create Date: 2026-11-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0114"
down_revision: str | None = "0113"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_INDEX = "ix_item_listing_preferences_owner_party_id_featured"


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column(
        "item_listing_preferences", sa.Column("featured_at", sa.TIMESTAMP(), nullable=True)
    )
    op.create_index(
        _INDEX,
        "item_listing_preferences",
        ["owner_party_id"],
        postgresql_where=sa.text("featured_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_index(_INDEX, table_name="item_listing_preferences")
    op.drop_column("item_listing_preferences", "featured_at")
