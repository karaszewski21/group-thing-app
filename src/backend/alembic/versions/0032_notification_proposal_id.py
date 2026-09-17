"""notification proposal id

Adds a nullable `proposal_id` column to `notifications` — a loose
cross-BC pointer (no FK, per `standards/backend/models.md`'s
`ItemListingPreference`/`Pledge.resolved_reservation_id` convention) at
`app.groups.models.SwapProposal.id`, populated only for `SWAP_PROPOSED`
notifications. Lets the frontend's global pending-actions modal resolve
the proposal to accept/reject directly instead of deep-linking to the
term page.

Revision ID: 0032
Revises: 0031
Create Date: 2026-09-17
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0032"
down_revision: str | None = "0031"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "notifications",
        sa.Column("proposal_id", sa.BigInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notifications", "proposal_id")
