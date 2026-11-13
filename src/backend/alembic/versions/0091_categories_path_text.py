"""categories path_text

Schema only. `categories.path_text` holds the `fold_pl()`-folded names from
the root down to the category itself, joined with `' / '`, so search can
match a category by its ancestors with one trigram index (0094). Filled by
0092 and maintained by `app/category/service.py` in SQL. Adding a NOT NULL
column with a constant default is metadata-only, but it still takes a brief
ACCESS EXCLUSIVE lock, hence the `lock_timeout`.

Revision ID: 0091
Revises: 0090
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0091"
down_revision: str | None = "0090"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column(
        "categories",
        sa.Column("path_text", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column("categories", "path_text")
