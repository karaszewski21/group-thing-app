"""notification reservation id

Adds a nullable `reservation_id` column to `notifications` — a loose
cross-BC pointer (no FK, same convention as `0032`'s `proposal_id` and
`0038`'s `join_request_id`) at `app.circulation.models.Reservation.id`,
populated for the GIFT/LEND `TERM_CONFIRMATION_NEEDED` prompts so the
frontend's pending-actions modal can confirm that reservation directly.
No index: the column is never filtered on.

Revision ID: 0040
Revises: 0039
Create Date: 2026-09-26
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0040"
down_revision: str | None = "0039"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("reservation_id", sa.BigInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notifications", "reservation_id")
