"""localities

Creates the TERYT locality dictionary: `localities` (SIMC id as a 7-character
natural PK) and `locality_postal_codes` (postal code to locality pairs).
Both get pattern-ops indexes so prefix `LIKE` uses them under any collation.
Seeded by `0079`. New, empty tables, so no lock timeout is needed.

Revision ID: 0078
Revises: 0077
Create Date: 2026-11-03
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0078"
down_revision: str | None = "0077"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "localities",
        sa.Column("id", sa.String(7), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("name_search", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("gmina", sa.String(100), nullable=False),
        sa.Column("powiat", sa.String(100), nullable=False),
        sa.Column("voivodeship", sa.String(50), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_localities"),
        sa.CheckConstraint("kind IN ('TOWN', 'VILLAGE')", name="ck_localities_kind"),
    )
    op.create_index(
        "ix_localities_name_search",
        "localities",
        ["name_search"],
        postgresql_ops={"name_search": "text_pattern_ops"},
    )
    op.create_table(
        "locality_postal_codes",
        sa.Column("postal_code", sa.String(6), nullable=False),
        sa.Column("locality_id", sa.String(7), nullable=False),
        sa.PrimaryKeyConstraint("postal_code", "locality_id", name="pk_locality_postal_codes"),
        sa.ForeignKeyConstraint(
            ["locality_id"],
            ["localities.id"],
            name="fk_locality_postal_codes_locality_id_localities",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_locality_postal_codes_postal_code",
        "locality_postal_codes",
        ["postal_code"],
        postgresql_ops={"postal_code": "varchar_pattern_ops"},
    )


def downgrade() -> None:
    op.drop_index("ix_locality_postal_codes_postal_code", table_name="locality_postal_codes")
    op.drop_table("locality_postal_codes")
    op.drop_index("ix_localities_name_search", table_name="localities")
    op.drop_table("localities")
