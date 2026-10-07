"""user profile bio

Schema only. The free-text "O mnie" a user writes on their own profile
(`PATCH /api/people/me`); nullable, as existing profiles have none.

Revision ID: 0050
Revises: 0049
Create Date: 2026-10-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0050"
down_revision: str | None = "0049"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("user_profiles", sa.Column("bio", sa.String(1000), nullable=True))


def downgrade() -> None:
    op.drop_column("user_profiles", "bio")
