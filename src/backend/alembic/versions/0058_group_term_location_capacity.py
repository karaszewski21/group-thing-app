"""group/term location and capacity

Schema only. `groups.default_location_id`/`groups.default_capacity` (the
Circle's defaults, copied by value into new Terms) and `terms.location_id`/
`terms.capacity`. Additive, nullable columns; existing rows get nulls. The
FKs to `locations` carry no `ON DELETE` action — locations are only ever
soft-deleted.

Revision ID: 0058
Revises: 0057
Create Date: 2026-10-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0058"
down_revision: str | None = "0057"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "groups",
        sa.Column("default_location_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("groups", sa.Column("default_capacity", sa.Integer(), nullable=True))
    op.add_column(
        "terms",
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("terms", sa.Column("capacity", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_groups_default_location_id_locations",
        "groups",
        "locations",
        ["default_location_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_terms_location_id_locations",
        "terms",
        "locations",
        ["location_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_terms_location_id_locations", "terms", type_="foreignkey")
    op.drop_constraint("fk_groups_default_location_id_locations", "groups", type_="foreignkey")
    op.drop_column("terms", "capacity")
    op.drop_column("terms", "location_id")
    op.drop_column("groups", "default_capacity")
    op.drop_column("groups", "default_location_id")
