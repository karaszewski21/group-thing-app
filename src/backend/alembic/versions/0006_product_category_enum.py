"""product category enum

Removes the standalone `categories` table/`Category` module — `products`
now carries `category` as a closed, string-backed enum column
(`ProductCategory`: TOY/BOOK/GAME/CLOTHING/OTHER) instead of a
`category_id` FK. Existing `products` rows are backfilled to `'OTHER'`
before the new column is made `NOT NULL` (same rows, only the
representation of one column changes — unlike the circulation-product
cleanup in 0007/0008, no cross-table remap is needed here).

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_CATEGORY_SEQ = "category_seq"


def upgrade() -> None:
    # --- products.category_id -> products.category (enum) ------------------
    op.drop_constraint("fk_products_category_id_categories", "products", type_="foreignkey")
    op.drop_index("ix_products_category_id", table_name="products")
    op.add_column("products", sa.Column("category", sa.String(length=20), nullable=True))
    op.execute("UPDATE products SET category = 'OTHER' WHERE category IS NULL")
    op.alter_column("products", "category", nullable=False)
    op.drop_column("products", "category_id")

    # --- drop categories -----------------------------------------------------
    op.drop_table("categories")
    op.execute(f"DROP SEQUENCE IF EXISTS {_CATEGORY_SEQ}")


def downgrade() -> None:
    op.execute(f"CREATE SEQUENCE {_CATEGORY_SEQ}")
    op.create_table(
        "categories",
        sa.Column(
            "id",
            sa.BigInteger(),
            server_default=sa.text(f"nextval('{_CATEGORY_SEQ}')"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_categories"),
    )
    op.execute(f"ALTER SEQUENCE {_CATEGORY_SEQ} OWNED BY categories.id")

    op.add_column("products", sa.Column("category_id", sa.BigInteger(), nullable=True))
    # No source category row exists to backfill from (categories was just
    # recreated empty) — every product's category_id stays NULL until an
    # operator repopulates categories and re-links products by hand. This
    # asymmetry is expected: downgrading a data-dropping migration cannot
    # resurrect the original 1:1 mapping.
    op.create_index("ix_products_category_id", "products", ["category_id"], unique=False)
    op.create_foreign_key(
        "fk_products_category_id_categories",
        "products",
        "categories",
        ["category_id"],
        ["id"],
    )
    op.drop_column("products", "category")
