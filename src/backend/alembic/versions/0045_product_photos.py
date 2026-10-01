"""product photos

Adds `app/product/models.py`'s `ProductPhoto`: the gallery of a catalog
product as external URLs in dense `sort_order`, shared by every inventory
item of that product. `product_id` has no cascade.
`uq_product_photos_product_id_url` is the business key; its
product_id-leading index also serves the per-product lookup, so no extra
index is added. Limits (10 photos, URL format) live in the application
layer, so there are no CHECK constraints. Schema only.

Revision ID: 0045
Revises: 0044
Create Date: 2026-10-01
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0045"
down_revision: str | None = "0044"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "product_photos",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("product_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("url", sa.String(length=500), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_product_photos"),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name="fk_product_photos_product_id_products",
        ),
        sa.UniqueConstraint("product_id", "url", name="uq_product_photos_product_id_url"),
    )


def downgrade() -> None:
    op.drop_table("product_photos")
