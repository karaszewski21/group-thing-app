"""event party indexes

Indexes the per-party event lookups: events by author, and active sign-ups
by party (partial, matching the `withdrawn_at IS NULL` filter every party
lookup uses).

Revision ID: 0072
Revises: 0071
Create Date: 2026-10-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0072"
down_revision: str | None = "0071"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_index("ix_events_author_party_id", "events", ["author_party_id"])
    op.create_index(
        "ix_event_attendances_party_id",
        "event_attendances",
        ["party_id"],
        postgresql_where=sa.text("withdrawn_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_event_attendances_party_id", table_name="event_attendances")
    op.drop_index("ix_events_author_party_id", table_name="events")
