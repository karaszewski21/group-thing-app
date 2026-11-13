"""search vector indexes

GIN full-text indexes on the generated `search_vector` columns of
`products`, `events` and `terms` (0088–0090), serving `search_vector @@
plainto_tsquery('simple', fold_pl(:q))`.

Built and dropped CONCURRENTLY, as 0053 and 0077, so writes are not blocked
while they build; `autocommit_block()` because CONCURRENTLY cannot run inside
a transaction. An interrupted build can leave an INVALID index behind, so
`upgrade` drops any leftover first and a rerun recovers. Each index is also
declared on its model.

Revision ID: 0093
Revises: 0092
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0093"
down_revision: str | None = "0092"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

# (index name, table, USING clause and key)
INDEXES = (
    ("ix_products_search_vector", "products", "USING gin (search_vector)"),
    ("ix_events_search_vector", "events", "USING gin (search_vector)"),
    ("ix_terms_search_vector", "terms", "USING gin (search_vector)"),
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
