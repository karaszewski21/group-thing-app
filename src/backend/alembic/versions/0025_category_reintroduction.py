"""category reintroduction

Reintroduces the standalone `categories` table (removed by
`0006_product_category_enum.py` in favor of an inline `products.category`
string enum) as a real reference table again, seeded with 5 fixed Polish
rows, and repoints `products.category` at it via a new `category_id` FK.
Also grants the new `Permission.ADMIN` (see `app/auth/models.py`) to the
seeded dev `admin` account (mirrors `0002_seed_dev_users.py`'s
`PLUGIN_MANAGEMENT` grant pattern) — no other account is touched.

One migration combining schema creation with its immediately-dependent
seed/backfill/column-drop, per `standards/backend/migrations.md`'s
documented exception (same shape as `0006` itself combining schema + column
type change).

Revision ID: 0025
Revises: 0024
Create Date: 2026-09-13
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0025"
down_revision: str | None = "0024"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_CATEGORY_SEQ = "category_seq"

# (id, name, sort_order) — positional mapping used by the `products.category`
# -> `products.category_id` backfill below: TOY->1, BOOK->2, GAME->3,
# CLOTHING->4, OTHER->5.
_CATEGORIES: list[tuple[int, str, int]] = [
    (1, "Zabawka", 0),
    (2, "Książka", 1),
    (3, "Gra", 2),
    (4, "Ubranie", 3),
    (5, "Inne", 4),
]


def _sequenced_id(sequence_name: str) -> sa.Column[Any]:
    return sa.Column(
        "id",
        sa.BigInteger(),
        server_default=sa.text(f"nextval('{sequence_name}')"),
        nullable=False,
    )


def _create_sequence(name: str) -> None:
    op.execute(f"CREATE SEQUENCE {name}")


def _own_sequence(sequence_name: str, table_name: str) -> None:
    op.execute(f"ALTER SEQUENCE {sequence_name} OWNED BY {table_name}.id")


def upgrade() -> None:
    # --- categories ------------------------------------------------------
    _create_sequence(_CATEGORY_SEQ)
    op.create_table(
        "categories",
        _sequenced_id(_CATEGORY_SEQ),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_categories"),
        sa.UniqueConstraint("name", name="uq_categories_name"),
    )
    _own_sequence(_CATEGORY_SEQ, "categories")

    for category_id, name, sort_order in _CATEGORIES:
        op.execute(
            sa.text(
                "INSERT INTO categories (id, name, sort_order, created_at, updated_at) "
                "VALUES (:id, :name, :sort_order, now(), now())"
            ).bindparams(id=category_id, name=name, sort_order=sort_order)
        )
    # Explicit ids were inserted above (not `nextval()`-generated) — advance
    # the sequence past them so the next real insert doesn't collide.
    op.execute(f"SELECT setval('{_CATEGORY_SEQ}', {len(_CATEGORIES)}, true)")

    # --- products.category (enum) -> products.category_id (FK) -----------
    op.add_column("products", sa.Column("category_id", sa.BigInteger(), nullable=True))
    op.execute(
        "UPDATE products SET category_id = CASE category "
        "WHEN 'TOY' THEN 1 "
        "WHEN 'BOOK' THEN 2 "
        "WHEN 'GAME' THEN 3 "
        "WHEN 'CLOTHING' THEN 4 "
        "WHEN 'OTHER' THEN 5 "
        "END"
    )
    op.alter_column("products", "category_id", nullable=False)
    op.create_index("ix_products_category_id", "products", ["category_id"], unique=False)
    op.create_foreign_key(
        "fk_products_category_id_categories",
        "products",
        "categories",
        ["category_id"],
        ["id"],
    )
    op.drop_column("products", "category")

    # --- ADMIN permission for the seeded dev `admin` account -------------
    op.execute(
        sa.text(
            "INSERT INTO user_permissions (user_id, permission) "
            "SELECT u.id, :permission FROM users u "
            "WHERE u.username = 'admin' "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM user_permissions p "
            "  WHERE p.user_id = u.id AND p.permission = :permission"
            ")"
        ).bindparams(permission="ADMIN")
    )


def downgrade() -> None:
    # --- revoke ADMIN from `admin` ----------------------------------------
    op.execute(
        sa.text(
            "DELETE FROM user_permissions "
            "WHERE user_id = (SELECT id FROM users WHERE username = 'admin') "
            "AND permission = :permission"
        ).bindparams(permission="ADMIN")
    )

    # --- products.category_id (FK) -> products.category (enum) -----------
    op.add_column("products", sa.Column("category", sa.String(length=20), nullable=True))
    op.execute(
        "UPDATE products p SET category = CASE c.name "
        "WHEN 'Zabawka' THEN 'TOY' "
        "WHEN 'Książka' THEN 'BOOK' "
        "WHEN 'Gra' THEN 'GAME' "
        "WHEN 'Ubranie' THEN 'CLOTHING' "
        "WHEN 'Inne' THEN 'OTHER' "
        "END "
        "FROM categories c WHERE p.category_id = c.id"
    )
    op.alter_column("products", "category", nullable=False)
    op.drop_constraint("fk_products_category_id_categories", "products", type_="foreignkey")
    op.drop_index("ix_products_category_id", table_name="products")
    op.drop_column("products", "category_id")

    # --- drop categories ---------------------------------------------------
    op.drop_table("categories")
    op.execute(f"DROP SEQUENCE IF EXISTS {_CATEGORY_SEQ}")
