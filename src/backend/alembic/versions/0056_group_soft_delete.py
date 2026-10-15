"""group soft delete

Schema only. `groups.deleted_at` (`NULL` = live Circle, non-null = soft-
deleted; nullable-timestamp shape follows `needed_items.deleted_at`) and
`groups.deleted_by_party_id`, the party who deleted it. Additive, nullable
columns; existing Circles stay live.

Revision ID: 0056
Revises: 0055
Create Date: 2026-10-14
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0056"
down_revision: str | None = "0055"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("groups", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.add_column(
        "groups",
        sa.Column("deleted_by_party_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_groups_deleted_by_party_id_parties",
        "groups",
        "parties",
        ["deleted_by_party_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_groups_deleted_by_party_id_parties", "groups", type_="foreignkey")
    op.drop_column("groups", "deleted_by_party_id")
    op.drop_column("groups", "deleted_at")
