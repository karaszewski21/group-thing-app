"""group layout mode

Adds `app/groups/models.py`'s `Group.layout_mode` — a string-backed enum
column (`GroupLayoutMode`: `CIRCLE`/`PITCH`/`TABLE`) selecting the
participant-visualization layout an organizer picks for their Circle.

Single `add_column` step with `server_default="CIRCLE"`, kept permanently
(not dropped after backfill): the default is one fixed, always-sensible
value for every existing row, so the multi-step add-nullable -> backfill ->
alter-to-NOT-NULL pattern `0034_reservation_term_id.py` uses (a computed,
row-dependent default) does not apply here — see
`standards/backend/migrations.md`.

Revision ID: 0035
Revises: 0034
Create Date: 2026-09-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0035"
down_revision: str | None = "0034"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "groups",
        sa.Column(
            "layout_mode",
            sa.String(length=10),
            nullable=False,
            server_default="CIRCLE",
        ),
    )


def downgrade() -> None:
    op.drop_column("groups", "layout_mode")
