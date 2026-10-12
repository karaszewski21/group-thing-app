"""organization description

Schema only. The free-text "O nas" an organizer writes for their public page
(`PATCH /api/organizations/{id}`); nullable, as existing organizations have
none.

Revision ID: 0055
Revises: 0054
Create Date: 2026-10-12
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0055"
down_revision: str | None = "0054"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("organizations", sa.Column("description", sa.String(1000), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "description")
