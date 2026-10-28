"""category tree

Schema only. Turns `categories` into a tree:
- `parent_id UUID NULL`, a self-FK `fk_categories_parent_id_categories`
  (`ON DELETE RESTRICT`) with index `ix_categories_parent_id`; NULL is a root.
- `external_id INTEGER NULL`, the Vinted catalog id, unique
  (`uq_categories_external_id`).
- `uq_categories_name` is replaced by the per-parent
  `uq_categories_parent_id_name (parent_id, name)` plus the partial unique
  index `uq_categories_root_name (name) WHERE parent_id IS NULL`, because
  NULL parents never collide in a plain unique constraint.

The downgrade reverses this in reverse dependency order. Re-adding
`uq_categories_name` fails if names repeat across parents, so the tree seed
(`0069`) must be downgraded first, which Alembic guarantees.

Revision ID: 0066
Revises: 0065
Create Date: 2026-10-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0066"
down_revision: str | None = "0065"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "categories", sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_categories_parent_id_categories",
        "categories",
        "categories",
        ["parent_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_categories_parent_id", "categories", ["parent_id"], unique=False)
    op.add_column("categories", sa.Column("external_id", sa.Integer(), nullable=True))
    op.create_unique_constraint("uq_categories_external_id", "categories", ["external_id"])
    op.drop_constraint("uq_categories_name", "categories", type_="unique")
    op.create_unique_constraint("uq_categories_parent_id_name", "categories", ["parent_id", "name"])
    op.create_index(
        "uq_categories_root_name",
        "categories",
        ["name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_categories_root_name", table_name="categories")
    op.drop_constraint("uq_categories_parent_id_name", "categories", type_="unique")
    op.create_unique_constraint("uq_categories_name", "categories", ["name"])
    op.drop_constraint("uq_categories_external_id", "categories", type_="unique")
    op.drop_column("categories", "external_id")
    op.drop_index("ix_categories_parent_id", table_name="categories")
    op.drop_constraint("fk_categories_parent_id_categories", "categories", type_="foreignkey")
    op.drop_column("categories", "parent_id")
