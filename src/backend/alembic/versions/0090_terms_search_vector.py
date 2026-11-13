"""terms search_vector

Adds `terms.search_vector`, a GENERATED ALWAYS ... STORED `tsvector` over
`fold_pl()`-folded text with the `'simple'` configuration: description at
weight C only; the group, organization and location names are joined at
query time. Kept current by PostgreSQL itself, no triggers. Declared on the
model with `Computed(..., persisted=True)` and `deferred(raiseload=True)`.

Adding a stored generated column rewrites `terms` under ACCESS EXCLUSIVE,
hence `lock_timeout` and an off-peak deploy. Switching to a `polish`
(hunspell) configuration later means `ALTER TABLE terms DROP COLUMN
search_vector` and `ADD COLUMN` again with the new expression, which
recomputes every row.

Revision ID: 0090
Revises: 0089
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0090"
down_revision: str | None = "0089"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

SEARCH_VECTOR_SQL = (
    "setweight(to_tsvector('simple'::regconfig, fold_pl(coalesce(description, ''))), 'C')"
)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "ALTER TABLE terms ADD COLUMN search_vector tsvector "
        f"GENERATED ALWAYS AS ({SEARCH_VECTOR_SQL}) STORED"
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column("terms", "search_vector")
