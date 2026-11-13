"""trigram indexes

GIN `gin_trgm_ops` indexes serving the word-similarity operator
`fold_pl(:q) <% <folded column>`: on `fold_pl(name)` of `products`, `events`,
`groups` and `organizations`, and on `categories.path_text` (already folded).
The expressions must stay exactly `fold_pl(name)` for the planner to use them.

Built and dropped CONCURRENTLY, as 0053 and 0077, so writes are not blocked
while they build; `autocommit_block()` because CONCURRENTLY cannot run inside
a transaction. An interrupted build can leave an INVALID index behind, so
`upgrade` drops any leftover first and a rerun recovers. Each index is also
declared on its model.

Revision ID: 0094
Revises: 0093
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0094"
down_revision: str | None = "0093"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# (index name, table, USING clause and key)
INDEXES = (
    ("ix_products_name_trgm", "products", "USING gin (fold_pl(name) gin_trgm_ops)"),
    ("ix_events_name_trgm", "events", "USING gin (fold_pl(name) gin_trgm_ops)"),
    ("ix_groups_name_trgm", "groups", "USING gin (fold_pl(name) gin_trgm_ops)"),
    ("ix_organizations_name_trgm", "organizations", "USING gin (fold_pl(name) gin_trgm_ops)"),
    ("ix_categories_path_text_trgm", "categories", "USING gin (path_text gin_trgm_ops)"),
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
