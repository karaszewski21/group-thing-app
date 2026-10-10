"""terms circle occurs_on index

Adds the composite index `ix_terms_circle_group_id_occurs_on` on
`terms(circle_group_id, occurs_on)` (declared on `app/groups/models.py`'s
`Term`). The public organizer page's upcoming-term queries filter on
`circle_group_id IN (...)` and `occurs_on >= now`, and its LATERAL
next-term-per-circle lookup relies on this index to read only the first
future row per circle. The existing single-column `ix_terms_circle_group_id`
stays untouched, although it is now a redundant prefix of this index.

The index is built and dropped CONCURRENTLY, so writes to `terms` are not
blocked while it builds. CONCURRENTLY cannot run inside a transaction, hence
the `autocommit_block()`, which commits the migration transaction first. A
CONCURRENTLY build that is interrupted leaves an INVALID index behind (or a
valid one with `alembic_version` still at 0052), so `upgrade` drops any
leftover first and a rerun recovers on its own.

Revision ID: 0053
Revises: 0052
Create Date: 2026-10-09
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0053"
down_revision: str | None = "0052"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_terms_circle_group_id_occurs_on")
        op.create_index(
            "ix_terms_circle_group_id_occurs_on",
            "terms",
            ["circle_group_id", "occurs_on"],
            unique=False,
            postgresql_concurrently=True,
        )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_terms_circle_group_id_occurs_on")
