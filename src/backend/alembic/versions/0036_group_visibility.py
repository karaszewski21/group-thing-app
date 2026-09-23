"""group visibility

Adds `app/groups/models.py`'s `Group.visibility` — a string-backed enum
column (`GroupVisibility`: `PUBLIC`/`PRIVATE`) distinguishing groups that
accept anonymous per-term RSVP (`PUBLIC`, today's only behavior) from
groups that only accept standing members, joined via a group-level join
link (`PRIVATE`).

Single `add_column` step with `server_default="PUBLIC"`, kept permanently
(not dropped after backfill) — same rationale as `0035_group_layout_mode.py`:
one fixed, always-sensible default for every existing row, so the
multi-step add-nullable -> backfill -> alter-to-NOT-NULL pattern does not
apply here — see `standards/backend/migrations.md`.

Revision ID: 0036
Revises: 0035
Create Date: 2026-09-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0036"
down_revision: str | None = "0035"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "groups",
        sa.Column(
            "visibility",
            sa.String(length=10),
            nullable=False,
            server_default="PUBLIC",
        ),
    )


def downgrade() -> None:
    op.drop_column("groups", "visibility")
