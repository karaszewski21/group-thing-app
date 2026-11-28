"""app settings

The single-row `app_settings` table (`uq_app_settings_singleton` on
`((true))`) holding app-wide admin settings; for now only
`max_featured_items` (0–20, `ck_app_settings_max_featured_items_range`).

Schema and seed in one revision, a recorded exception to the
separate-schema-and-data rule: `load_settings` reads the row with
`scalar_one()`, so a head with the table but no row would turn every
featuring and the admin GET into a 500. The row is seeded with explicit
`id`, `created_at` and `updated_at` (BaseEntity has no server default for
the timestamps) and the value 3.

Plain, lossy downgrade: drops the table and the stored limit.

Revision ID: 0113
Revises: 0112
Create Date: 2026-11-27
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0113"
down_revision: str | None = "0112"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_NOW_UTC = "(now() AT TIME ZONE 'UTC')"


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("max_featured_items", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_app_settings"),
        sa.CheckConstraint(
            "max_featured_items BETWEEN 0 AND 20",
            name="ck_app_settings_max_featured_items_range",
        ),
    )
    op.create_index("uq_app_settings_singleton", "app_settings", [sa.text("(true)")], unique=True)

    op.execute(
        "INSERT INTO app_settings (id, max_featured_items, created_at, updated_at) "
        f"VALUES (gen_random_uuid(), 3, {_NOW_UTC}, {_NOW_UTC})"
    )


def downgrade() -> None:
    op.drop_index("uq_app_settings_singleton", table_name="app_settings")
    op.drop_table("app_settings")
