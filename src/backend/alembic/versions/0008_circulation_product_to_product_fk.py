"""circulation product to product fk

Drops the standalone `circulation_products` catalog and its sequence, and
re-points `inventory_items.product_id` at the shared `products` table
(`app.product.Product`) instead. Must run after 0007's data cleanup — the
old FK would otherwise block dropping `circulation_products` while rows in
`inventory_items` still reference it.

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-05
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_CIRCULATION_PRODUCT_SEQ = "circulation_product_seq"


def _sequenced_id(sequence_name: str) -> sa.Column[Any]:
    return sa.Column(
        "id",
        sa.BigInteger(),
        server_default=sa.text(f"nextval('{sequence_name}')"),
        nullable=False,
    )


def upgrade() -> None:
    op.drop_constraint(
        "fk_inventory_items_product_id_circulation_products",
        "inventory_items",
        type_="foreignkey",
    )
    op.create_foreign_key(
        "fk_inventory_items_product_id_products",
        "inventory_items",
        "products",
        ["product_id"],
        ["id"],
    )
    op.drop_table("circulation_products")
    op.execute(f"DROP SEQUENCE IF EXISTS {_CIRCULATION_PRODUCT_SEQ}")


def downgrade() -> None:
    op.execute(f"CREATE SEQUENCE {_CIRCULATION_PRODUCT_SEQ}")
    op.create_table(
        "circulation_products",
        _sequenced_id(_CIRCULATION_PRODUCT_SEQ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("manufacturer", sa.String(length=255), nullable=True),
        sa.Column("item_type", sa.String(length=50), nullable=False),
        sa.Column("value", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_circulation_products"),
    )
    op.execute(f"ALTER SEQUENCE {_CIRCULATION_PRODUCT_SEQ} OWNED BY circulation_products.id")

    op.drop_constraint(
        "fk_inventory_items_product_id_products", "inventory_items", type_="foreignkey"
    )
    op.create_foreign_key(
        "fk_inventory_items_product_id_circulation_products",
        "inventory_items",
        "circulation_products",
        ["product_id"],
        ["id"],
    )
