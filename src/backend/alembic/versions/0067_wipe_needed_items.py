"""wipe needed items

Data only. Deletes every `pledges` row, then every `needed_items` row:
needed items become plain names (`0068`), and existing rows cannot be
mapped from their product to a name the organizer chose.

The downgrade is a no-op; deleted rows are not restored.

Revision ID: 0067
Revises: 0066
Create Date: 2026-10-27
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0067"
down_revision: str | None = "0066"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM pledges")
    op.execute("DELETE FROM needed_items")


def downgrade() -> None:
    pass
