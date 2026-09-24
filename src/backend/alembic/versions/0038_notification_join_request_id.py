"""notification join request id

Adds a nullable `join_request_id` column to `notifications` — a loose
cross-BC pointer (no FK, same convention as `0032`'s `proposal_id`) at
`app.groups.models.GroupJoinRequest.id`, populated only for the
`GROUP_JOIN_*` kinds so the frontend's pending-actions modal can approve or
reject the request directly.

Revision ID: 0038
Revises: 0037
Create Date: 2026-09-24
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0038"
down_revision: str | None = "0037"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("join_request_id", sa.BigInteger(), nullable=True),
    )


def downgrade() -> None:
    # Pre-0038 code has no `GROUP_JOIN_*` members in `NotificationKind` and
    # would fail to load these rows.
    op.execute("DELETE FROM notifications WHERE kind LIKE 'GROUP_JOIN_%'")
    op.drop_column("notifications", "join_request_id")
