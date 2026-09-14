"""term attendance withdrawn_at

Adds `app/groups/models.py`'s `TermAttendance.withdrawn_at` nullable
timestamp: `NULL` = active RSVP, non-null = the guardian withdrew. Nullable-
timestamp shape follows `needed_items.deleted_at`. Additive, backward-
compatible column — existing create-RSVP behavior is unaffected.

Revision ID: 0029
Revises: 0028
Create Date: 2026-09-14
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0029"
down_revision: str | None = "0028"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "term_attendances", sa.Column("withdrawn_at", sa.TIMESTAMP(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("term_attendances", "withdrawn_at")
