"""counterparty indexes

Composite indexes finding a viewer's open counterparties from the viewer's
side: reservations they made or give (`(reserved_by_user_id, status)`,
`(giver_user_id, status)`) and swap proposals they made
(`(proposer_party_id, status)`). The existing single-column
`ix_reservations_reserved_by_user_id` and
`ix_swap_proposals_proposer_party_id` are kept.

Built and dropped CONCURRENTLY, as 0053 and 0077, so writes are not blocked
while they build; `autocommit_block()` because CONCURRENTLY cannot run inside
a transaction. An interrupted build can leave an INVALID index behind, so
`upgrade` drops any leftover first and a rerun recovers. Each index is also
declared on its model.

Revision ID: 0095
Revises: 0094
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0095"
down_revision: str | None = "0094"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# (index name, table, USING clause and key)
INDEXES = (
    (
        "ix_reservations_reserved_by_user_id_status",
        "reservations",
        "(reserved_by_user_id, status)",
    ),
    ("ix_reservations_giver_user_id_status", "reservations", "(giver_user_id, status)"),
    (
        "ix_swap_proposals_proposer_party_id_status",
        "swap_proposals",
        "(proposer_party_id, status)",
    ),
)


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, definition in INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
            op.execute(f"CREATE INDEX CONCURRENTLY {name} ON {table} {definition}")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _table, _definition in reversed(INDEXES):
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
