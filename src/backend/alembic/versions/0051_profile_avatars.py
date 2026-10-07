"""profile avatars

One moderated avatar per user profile. The columns VPS B's moderation cron
reads and writes (`storage_key`, `content_sha256`, `status`,
`moderation_attempts`, `moderation_retry_at`, `created_at`, `updated_at`)
match `product_photos` exactly, and so does the partial claim index; its
decisions are logged with `subject_type = 'AVATAR'`. The files live under
`storage_key` (`/w1600.webp`, `/w400.webp`) and stay private until APPROVED.
Grant the cron role its columns (group-thing-ai `scripts/moderation_db_role.sql`)
after upgrading; stop the cron before downgrading.

Revision ID: 0051
Revises: 0050
Create Date: 2026-10-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0051"
down_revision: str | None = "0050"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "profile_avatars",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("storage_key", sa.String(200), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("moderation_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("moderation_retry_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_profile_avatars"),
        sa.ForeignKeyConstraint(
            ["user_profile_id"],
            ["user_profiles.id"],
            name="fk_profile_avatars_user_profile_id_user_profiles",
        ),
        sa.UniqueConstraint("user_profile_id", name="uq_profile_avatars_user_profile_id"),
    )
    op.create_index("ix_profile_avatars_status", "profile_avatars", ["status"])
    op.create_index(
        "ix_profile_avatars_pending_created_at",
        "profile_avatars",
        ["created_at", "id"],
        postgresql_where=sa.text("status = 'PENDING'"),
    )


def downgrade() -> None:
    op.drop_index("ix_profile_avatars_pending_created_at", table_name="profile_avatars")
    op.drop_index("ix_profile_avatars_status", table_name="profile_avatars")
    op.drop_table("profile_avatars")
