"""photo upload and moderation

Turns `product_photos` from external URLs into uploaded files in object
storage: `url` and its unique key go, replaced by `storage_key`, the WebP
dimensions/size, `content_sha256` (dedup), a moderation `status` and
`uploaded_by_user_id`. Existing URL photos are deleted (pre-production test
data; hot-linked URLs could not be moderated). Adds `products.text_status`
(server default APPROVED, for existing rows and inserts outside the ORM) +
`text_moderated_hash`, and the append-only `moderation_decisions` audit log.

Revision ID: 0046
Revises: 0045
Create Date: 2026-10-02
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0046"
down_revision: str | None = "0045"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM product_photos")
    op.drop_constraint("uq_product_photos_product_id_url", "product_photos", type_="unique")
    op.drop_column("product_photos", "url")
    op.add_column("product_photos", sa.Column("storage_key", sa.String(200), nullable=False))
    op.add_column("product_photos", sa.Column("width", sa.Integer(), nullable=False))
    op.add_column("product_photos", sa.Column("height", sa.Integer(), nullable=False))
    op.add_column("product_photos", sa.Column("size_bytes", sa.Integer(), nullable=False))
    op.add_column("product_photos", sa.Column("content_sha256", sa.String(64), nullable=False))
    op.add_column("product_photos", sa.Column("status", sa.String(20), nullable=False))
    op.add_column(
        "product_photos",
        sa.Column("uploaded_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
    )
    op.create_foreign_key(
        "fk_product_photos_uploaded_by_user_id_users",
        "product_photos",
        "users",
        ["uploaded_by_user_id"],
        ["id"],
    )
    op.create_unique_constraint(
        "uq_product_photos_product_id_storage_key",
        "product_photos",
        ["product_id", "storage_key"],
    )
    op.create_unique_constraint(
        "uq_product_photos_product_id_content_sha256",
        "product_photos",
        ["product_id", "content_sha256"],
    )
    # The admin queue lists photos by status.
    op.create_index("ix_product_photos_status", "product_photos", ["status"])

    op.add_column(
        "products",
        sa.Column("text_status", sa.String(20), nullable=False, server_default="APPROVED"),
    )
    op.add_column("products", sa.Column("text_moderated_hash", sa.String(64), nullable=True))
    op.create_index("ix_products_text_status", "products", ["text_status"])

    op.create_table(
        "moderation_decisions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("subject_type", sa.String(20), nullable=False),
        sa.Column("subject_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("automated", sa.Boolean(), nullable=False),
        sa.Column("decided_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("model_id", sa.String(200), nullable=True),
        sa.Column("scores", postgresql.JSONB(), nullable=True),
        sa.Column("thresholds", postgresql.JSONB(), nullable=True),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("note", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_moderation_decisions"),
        sa.ForeignKeyConstraint(
            ["decided_by_user_id"],
            ["users.id"],
            name="fk_moderation_decisions_decided_by_user_id_users",
        ),
    )
    op.create_index(
        "ix_moderation_decisions_subject",
        "moderation_decisions",
        ["subject_type", "subject_id", "created_at"],
    )
    # The moderation worker claims its own event types out of the outbox.
    op.create_index(
        "ix_outbox_entries_status_event_type",
        "outbox_entries",
        ["status", "event_type", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_outbox_entries_status_event_type", table_name="outbox_entries")
    op.drop_index("ix_moderation_decisions_subject", table_name="moderation_decisions")
    op.drop_table("moderation_decisions")
    op.drop_index("ix_products_text_status", table_name="products")
    op.drop_column("products", "text_moderated_hash")
    op.drop_column("products", "text_status")

    op.execute("DELETE FROM product_photos")
    op.drop_index("ix_product_photos_status", table_name="product_photos")
    op.drop_constraint(
        "uq_product_photos_product_id_content_sha256", "product_photos", type_="unique"
    )
    op.drop_constraint("uq_product_photos_product_id_storage_key", "product_photos", type_="unique")
    op.drop_constraint(
        "fk_product_photos_uploaded_by_user_id_users", "product_photos", type_="foreignkey"
    )
    for column in (
        "uploaded_by_user_id",
        "status",
        "content_sha256",
        "size_bytes",
        "height",
        "width",
        "storage_key",
    ):
        op.drop_column("product_photos", column)
    op.add_column("product_photos", sa.Column("url", sa.String(500), nullable=False))
    op.create_unique_constraint(
        "uq_product_photos_product_id_url", "product_photos", ["product_id", "url"]
    )
