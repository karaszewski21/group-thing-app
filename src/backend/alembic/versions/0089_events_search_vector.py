"""events search_vector

Adds `events.search_vector`, a GENERATED ALWAYS ... STORED `tsvector` over
`fold_pl()`-folded text with the `'simple'` configuration: name at weight A,
description at weight C. Kept current by PostgreSQL itself, no triggers.
Declared on the model with `Computed(..., persisted=True)` and
`deferred(raiseload=True)`.

Adding a stored generated column rewrites `events` under ACCESS EXCLUSIVE,
hence `lock_timeout` and an off-peak deploy. Switching to a `polish`
(hunspell) configuration later means `ALTER TABLE events DROP COLUMN
search_vector` and `ADD COLUMN` again with the new expression, which
recomputes every row.

Revision ID: 0089
Revises: 0088
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0089"
down_revision: str | None = "0088"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

SEARCH_VECTOR_SQL = (
    "setweight(to_tsvector('simple'::regconfig, fold_pl(coalesce(name, ''))), 'A') || "
    "setweight(to_tsvector('simple'::regconfig, fold_pl(coalesce(description, ''))), 'C')"
)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(
        "ALTER TABLE events ADD COLUMN search_vector tsvector "
        f"GENERATED ALWAYS AS ({SEARCH_VECTOR_SQL}) STORED"
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column("events", "search_vector")
