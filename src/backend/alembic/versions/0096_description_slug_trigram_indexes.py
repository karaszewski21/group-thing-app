"""trigram indexes on description and slug

GIN `gin_trgm_ops` indexes for the two remaining word-similarity match
predicates of the search that 0094 left unindexed: `fold_pl(groups.description)`
(a group matched by its description) and `fold_pl(organizations.slug)` (an
organization matched by its slug). The expressions must stay exactly
`fold_pl(<column>)` for the planner to use them.

Built and dropped CONCURRENTLY, as 0094, so writes are not blocked while
they build; `autocommit_block()` because CONCURRENTLY cannot run inside a
transaction. An interrupted build can leave an INVALID index behind, so
`upgrade` drops any leftover first and a rerun recovers. Each index is also
declared on its model.

Revision ID: 0096
Revises: 0095
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0096"
down_revision: str | None = "0095"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# (index name, table, USING clause and key)
INDEXES = (
    (
        "ix_groups_description_trgm",
        "groups",
        "USING gin (fold_pl(description) gin_trgm_ops)",
    ),
    ("ix_organizations_slug_trgm", "organizations", "USING gin (fold_pl(slug) gin_trgm_ops)"),
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
