"""backfill categories path_text

Data only. Sets every `categories.path_text` to the `fold_pl()`-folded names
from the root down, joined with `' / '`, in one recursive-CTE UPDATE.
`app/category/service.py` maintains the same value on create and rename, and
`tests/test_category_path_text.py` runs `BACKFILL_SQL` to check that both
agree byte for byte. A future category seed revision must set `path_text`
the same way, with `fold_pl()` in SQL (for example by rerunning
`BACKFILL_SQL`). The downgrade resets the derived column to `''`, losing
nothing.

Revision ID: 0092
Revises: 0091
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0092"
down_revision: str | None = "0091"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

BACKFILL_SQL = """
WITH RECURSIVE tree (id, path_text) AS (
    SELECT id, fold_pl(name) FROM categories WHERE parent_id IS NULL
    UNION ALL
    SELECT child.id, tree.path_text || ' / ' || fold_pl(child.name)
    FROM categories child
    JOIN tree ON child.parent_id = tree.id
)
UPDATE categories
SET path_text = tree.path_text
FROM tree
WHERE categories.id = tree.id
"""


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("UPDATE categories SET path_text = ''")
