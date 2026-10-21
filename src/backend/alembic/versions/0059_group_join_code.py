"""group join code

Schema only. `groups.join_code`, the PRIVATE group's 6-digit join code,
created lazily on the organizer's first read. Additive, nullable column with
no backfill and no index; existing rows get nulls.

Revision ID: 0059
Revises: 0058
Create Date: 2026-10-21
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0059"
down_revision: str | None = "0058"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("groups", sa.Column("join_code", sa.String(6), nullable=True))


def downgrade() -> None:
    op.drop_column("groups", "join_code")
