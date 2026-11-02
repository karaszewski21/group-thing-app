"""inventory location

Additive, nullable `inventories.location_id`: the physical place of the
owner's items, a `locations` row. The FK carries no `ON DELETE` action —
locations are only ever soft-deleted. A partial index covers the set rows.
The legacy free-text `inventories.location` column is untouched.

The downgrade drops the index, the FK and the column, losing every owner's
location setting. It first runs 0074's guard and refuses while open personal
(no-context) reservations exist: a chained downgrade below 0074 would
otherwise drop the pickup places here and only then stop at 0074, leaving
the schema at 0074 with the locations already lost.

Revision ID: 0075
Revises: 0074
Create Date: 2026-10-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0075"
down_revision: str | None = "0074"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # Fail fast instead of queueing behind long queries (as 0074).
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column(
        "inventories",
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_inventories_location_id_locations",
        "inventories",
        "locations",
        ["location_id"],
        ["id"],
    )
    op.create_index(
        "ix_inventories_location_id",
        "inventories",
        ["location_id"],
        postgresql_where=sa.text("location_id IS NOT NULL"),
    )


def downgrade() -> None:
    personal = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT count(*) FROM reservations WHERE status IN ('PENDING', 'CONFIRMED') "
                "AND term_id IS NULL AND event_id IS NULL"
            )
        )
        .scalar_one()
    )
    if personal:
        raise RuntimeError(
            f"Cannot downgrade 0075: {personal} open personal reservation(s) have neither "
            "term_id nor event_id, so 0074's downgrade would refuse after this one had "
            "dropped every owner's pickup place. Resolve them first: (a) the listing owner "
            "rejects pending personal swap proposals with POST /api/swap-proposals/{id}/reject; "
            "(b) either party cancels accepted personal swaps and personal gifts with "
            "POST /api/reservations/{id}/cancel-transaction; (c) otherwise restore a "
            "pre-0074 dump."
        )
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_index("ix_inventories_location_id", table_name="inventories")
    op.drop_constraint("fk_inventories_location_id_locations", "inventories", type_="foreignkey")
    op.drop_column("inventories", "location_id")
