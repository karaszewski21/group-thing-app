"""user profiles birth year

Adds the nullable `user_profiles.birth_year` (SMALLINT), set only for CHILD
family members. Schema only: no backfill, so existing rows stay NULL.

Revision ID: 0044
Revises: 0043
Create Date: 2026-10-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0044"
down_revision: str | None = "0043"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_profiles", sa.Column("birth_year", sa.SmallInteger(), nullable=True))


def downgrade() -> None:
    op.drop_column("user_profiles", "birth_year")
