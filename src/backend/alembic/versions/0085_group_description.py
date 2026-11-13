"""group description

Schema only. The free-text description an organizer writes for a group,
shown on the group terms page and in search; nullable, as existing groups
have none. Adding a nullable column without a default is metadata-only, but
it still takes a brief ACCESS EXCLUSIVE lock on `groups`, hence the
`lock_timeout`. The downgrade drops the column and every description with it.

Revision ID: 0085
Revises: 0084
Create Date: 2026-11-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0085"
down_revision: str | None = "0084"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column("groups", sa.Column("description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column("groups", "description")
