"""locations

A person's saved meeting places (`app.locations`), picked from Google Places
(GOOGLE: place_id + cached address/coordinates) or typed by hand (MANUAL).
Rows are only soft-deleted (`deleted_at`), so the partial unique index keeps
one active row per owner and place_id while letting a deleted place be
re-added as a new row.

Revision ID: 0057
Revises: 0056
Create Date: 2026-10-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0057"
down_revision: str | None = "0056"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "locations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("owner_party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("formatted_address", sa.String(500), nullable=False),
        sa.Column("google_place_id", sa.String(255), nullable=True),
        sa.Column("lat", sa.Numeric(9, 6), nullable=True),
        sa.Column("lng", sa.Numeric(9, 6), nullable=True),
        sa.Column("notes", sa.String(500), nullable=True),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_locations"),
        sa.ForeignKeyConstraint(
            ["owner_party_id"],
            ["parties.id"],
            name="fk_locations_owner_party_id_parties",
        ),
    )
    op.create_index("ix_locations_owner_party_id", "locations", ["owner_party_id"])
    op.create_index(
        "uq_locations_owner_party_id_google_place_id",
        "locations",
        ["owner_party_id", "google_place_id"],
        unique=True,
        postgresql_where=sa.text("google_place_id IS NOT NULL AND deleted_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_locations_owner_party_id_google_place_id", table_name="locations")
    op.drop_index("ix_locations_owner_party_id", table_name="locations")
    op.drop_table("locations")
