"""profile page appearance

Schema only. Adds the public profile's appearance to `user_profiles`, all
nullable with no backfill: `page_layout` (a key from
`app/users/profile_layouts.py`; `NULL` renders the fallback layout) and the
theme `palette_preset` / `primary_color` / `accent_color`, which mean what
they mean on `organizations` (all `NULL` is the default palette).

Revision ID: 0081
Revises: 0080
Create Date: 2026-11-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0081"
down_revision: str | None = "0080"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

COLUMNS = ("page_layout", "palette_preset", "primary_color", "accent_color")


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column("user_profiles", sa.Column("page_layout", sa.String(64), nullable=True))
    op.add_column("user_profiles", sa.Column("palette_preset", sa.String(40), nullable=True))
    op.add_column("user_profiles", sa.Column("primary_color", sa.String(7), nullable=True))
    op.add_column("user_profiles", sa.Column("accent_color", sa.String(7), nullable=True))


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    for column in reversed(COLUMNS):
        op.drop_column("user_profiles", column)
