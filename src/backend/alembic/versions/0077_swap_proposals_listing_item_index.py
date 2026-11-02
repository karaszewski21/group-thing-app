"""swap proposals listing item index

Adds the partial index `ix_swap_proposals_listing_item_id_proposed` on
`swap_proposals(listing_item_id) WHERE status = 'PROPOSED'` (declared on
`app/groups/models.py`'s `SwapProposal`). Every listing read now looks up
the pending proposal of each listed item (`with_pending_proposer`), and
every take/propose checks it under the preference lock; both filter on
exactly these two columns.

Built and dropped CONCURRENTLY, as 0053, so writes to `swap_proposals` are
not blocked while it builds; `autocommit_block()` because CONCURRENTLY cannot
run inside a transaction. An interrupted build can leave an INVALID index
behind, so `upgrade` drops any leftover first and a rerun recovers.

Revision ID: 0077
Revises: 0076
Create Date: 2026-11-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0077"
down_revision: str | None = "0076"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

INDEX_NAME = "ix_swap_proposals_listing_item_id_proposed"


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX_NAME}")
        op.create_index(
            INDEX_NAME,
            "swap_proposals",
            ["listing_item_id"],
            unique=False,
            postgresql_where=sa.text("status = 'PROPOSED'"),
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {INDEX_NAME}")
