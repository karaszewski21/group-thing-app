"""drop pledge fulfillment

A pledge is now a pure declaration: no item is registered, reserved or moved
for it. The upgrade, in order: deletes the `PLEDGE_ITEM_REGISTERED`
notifications (the kind no longer exists in the string-backed
`NotificationKind`, so the rows would fail to load), then drops the loose
`pledges.resolved_reservation_id` column (no FK, no index; `0041` made it
`UUID`).

The downgrade re-adds `pledges.resolved_reservation_id UUID NULL`. Deleted
notifications are not restored.

Revision ID: 0063
Revises: 0062
Create Date: 2026-10-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0063"
down_revision: str | None = "0062"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM notifications WHERE kind = 'PLEDGE_ITEM_REGISTERED'")
    op.drop_column("pledges", "resolved_reservation_id")


def downgrade() -> None:
    op.add_column(
        "pledges",
        sa.Column("resolved_reservation_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
