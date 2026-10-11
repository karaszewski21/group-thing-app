"""organization media

Moderated organization images: one LOGO slot, one COVER slot and up to 3
GALLERY photos (the limit lives in the application layer). The columns VPS B's
moderation cron reads and writes (`id`, `storage_key`, `content_sha256`,
`status`, `moderation_attempts`, `moderation_retry_at`, `created_at`,
`updated_at`) match `profile_avatars` exactly, and so does the partial claim
index; its decisions are logged with `subject_type = 'ORGANIZATION_MEDIA'`.
The files live under `storage_key` (`/w1600.webp`, `/w400.webp`) and stay
private until APPROVED.

Deviations from the high-level design: no `width`/`height` columns (nothing
reads them), and the dedup unique is per kind
(`organization_id`, `kind`, `content_sha256`) instead of cross-kind.

After upgrading, re-run group-thing-ai `scripts/moderation_db_role.sql` to
grant the cron role its columns on `organization_media` (with the current cron
password). Before downgrading, stop (or roll back) the moderation cron.
Downgrading orphans the files under `organizations/` in object storage.

Revision ID: 0054
Revises: 0053
Create Date: 2026-10-11
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0054"
down_revision: str | None = "0053"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "organization_media",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
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
        sa.PrimaryKeyConstraint("id", name="pk_organization_media"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name="fk_organization_media_organization_id_organizations",
        ),
        sa.ForeignKeyConstraint(
            ["uploaded_by_user_id"],
            ["users.id"],
            name="fk_organization_media_uploaded_by_user_id_users",
        ),
        sa.UniqueConstraint(
            "organization_id",
            "kind",
            "content_sha256",
            name="uq_organization_media_organization_id_kind_content_sha256",
        ),
    )
    op.create_index("ix_organization_media_status", "organization_media", ["status"])
    op.create_index(
        "ix_organization_media_pending_created_at",
        "organization_media",
        ["created_at", "id"],
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.create_index(
        "uq_organization_media_one_pending_per_slot",
        "organization_media",
        ["organization_id", "kind"],
        unique=True,
        postgresql_where=sa.text(
            "status IN ('PENDING', 'NEEDS_REVIEW') AND kind IN ('LOGO', 'COVER')"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_organization_media_one_pending_per_slot", table_name="organization_media")
    op.drop_index("ix_organization_media_pending_created_at", table_name="organization_media")
    op.drop_index("ix_organization_media_status", table_name="organization_media")
    op.drop_table("organization_media")
