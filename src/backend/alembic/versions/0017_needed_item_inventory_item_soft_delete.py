"""needed_item + inventory_item soft delete

Adds a nullable `deleted_at` timestamp to `needed_items` and
`inventory_items` — the first use of the soft-delete pattern in this
codebase (`standards/backend/models.md` §169-170). `NULL` = live,
non-`NULL` = removed. No global query filter exists in SQLAlchemy, so the
read sites filter explicitly (`app.groups.service` / `app.circulation.service`).

Additive nullable column, no backfill, fully reversible. No partial index
(the lists are small and already scoped by FK); add one later only if a
query plan shows a need.

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-09
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("needed_items", sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True))
    op.add_column("inventory_items", sa.Column("deleted_at", sa.TIMESTAMP(), nullable=True))


def downgrade() -> None:
    op.drop_column("inventory_items", "deleted_at")
    op.drop_column("needed_items", "deleted_at")
