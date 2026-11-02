"""item listing visibility

Adds `item_listing_preferences.visibility` (`ItemVisibility`: `PUBLIC`/
`PRIVATE`): whether a listed item is seen by everyone who may see the owner's
listings or only by people in the owner's private groups. Single `add_column`
with a permanent `server_default='PUBLIC'`, as `0036_group_visibility.py`:
every existing listing stays public.

The downgrade refuses while PRIVATE rows exist, since dropping the column
would silently publish those items.

Revision ID: 0076
Revises: 0075
Create Date: 2026-11-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0076"
down_revision: str | None = "0075"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Fail fast instead of queueing behind long queries (as 0074).
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column(
        "item_listing_preferences",
        sa.Column(
            "visibility",
            sa.String(length=10),
            nullable=False,
            server_default="PUBLIC",
        ),
    )


def downgrade() -> None:
    private = (
        op.get_bind()
        .execute(
            sa.text("SELECT count(*) FROM item_listing_preferences WHERE visibility = 'PRIVATE'")
        )
        .scalar_one()
    )
    if private:
        raise RuntimeError(
            f"Cannot downgrade 0076: {private} PRIVATE item listing(s) would become public. "
            "(a) The owners clear those listings (PUT /api/item-listing-preferences/{item_id} "
            'with {"mode": null}) or switch them back to PUBLIC; (b) otherwise restore a '
            "pre-0076 dump."
        )
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column("item_listing_preferences", "visibility")
