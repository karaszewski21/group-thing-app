"""media

Schema only. One moderated image table for every public page: `media` rows
belong to a party (`owner_party_id`: a person's profile or an Organization's
own party) and are the LOGO, the AVATAR, the COVER or a GALLERY photo. The
columns VPS B's moderation cron reads and writes (`storage_key`, `content_sha256`,
`status`, `moderation_attempts`, `moderation_retry_at`, `created_at`,
`updated_at`) match `product_photos`, and so does the partial claim index;
its decisions are logged with `subject_type = 'MEDIA'`. The files live under
`storage_key` (`/w1600.webp`, `/w400.webp`) and stay private until APPROVED.
LOGO, AVATAR and COVER are slots with at most one unmoderated row each
(`uq_media_one_pending_per_slot`). 0083 drops the tables this replaces. Grant
the cron role its columns (group-thing-ai `scripts/moderation_db_role.sql`)
after upgrading; stop the cron before downgrading.

Revision ID: 0082
Revises: 0081
Create Date: 2026-11-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0082"
down_revision: str | None = "0081"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("owner_party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("storage_key", sa.String(200), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("content_sha256", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("uploaded_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("moderation_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("moderation_retry_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_media"),
        sa.ForeignKeyConstraint(
            ["owner_party_id"], ["parties.id"], name="fk_media_owner_party_id_parties"
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by_user_id"], ["users.id"], name="fk_media_uploaded_by_user_id_users"
        ),
        sa.UniqueConstraint(
            "owner_party_id",
            "kind",
            "content_sha256",
            name="uq_media_owner_party_id_kind_content_sha256",
        ),
    )
    op.create_index("ix_media_status", "media", ["status"])
    op.create_index(
        "ix_media_pending_created_at",
        "media",
        ["created_at", "id"],
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.create_index(
        "uq_media_one_pending_per_slot",
        "media",
        ["owner_party_id", "kind"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('PENDING', 'NEEDS_REVIEW') AND kind IN ('LOGO', 'AVATAR', 'COVER')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_media_one_pending_per_slot", table_name="media")
    op.drop_index("ix_media_pending_created_at", table_name="media")
    op.drop_index("ix_media_status", table_name="media")
    op.drop_table("media")
