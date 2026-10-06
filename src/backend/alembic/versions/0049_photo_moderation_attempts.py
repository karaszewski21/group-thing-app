"""photo moderation attempts

Schema only. Retry state for VPS B's photo moderation cron, which claims
PENDING photos directly (the outbox is no longer the queue):
`moderation_attempts` counts claims, `moderation_retry_at` (naive UTC, like
every app timestamp) holds back a photo until its next retry. The partial
index `ix_product_photos_pending_created_at` serves the claim query
(`WHERE status = 'PENDING' ORDER BY created_at, id`). Stop the B cron before
downgrading: it reads and writes both columns.

Revision ID: 0049
Revises: 0048
Create Date: 2026-10-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0049"
down_revision: str | None = "0048"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "product_photos",
        sa.Column("moderation_attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "product_photos",
        sa.Column("moderation_retry_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_product_photos_pending_created_at",
        "product_photos",
        ["created_at", "id"],
        postgresql_where=sa.text("status = 'PENDING'"),
    )


def downgrade() -> None:
    op.drop_index("ix_product_photos_pending_created_at", table_name="product_photos")
    op.drop_column("product_photos", "moderation_retry_at")
    op.drop_column("product_photos", "moderation_attempts")
