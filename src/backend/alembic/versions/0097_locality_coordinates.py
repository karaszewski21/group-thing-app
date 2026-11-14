"""locality coordinates

Schema only. `localities.lat`/`lng` hold the locality's main point as WGS 84
decimal degrees, for distance and nearby search; nullable, as a few
localities have no point in the source register. Filled by `0098`. Adding
nullable columns without a default is metadata-only, but it still takes a
brief ACCESS EXCLUSIVE lock on `localities`, hence the `lock_timeout`.

Revision ID: 0097
Revises: 0096
Create Date: 2026-11-14
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0097"
down_revision: str | None = "0096"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column("localities", sa.Column("lat", sa.Numeric(9, 6), nullable=True))
    op.add_column("localities", sa.Column("lng", sa.Numeric(9, 6), nullable=True))
    op.create_check_constraint(
        "ck_localities_coordinates", "localities", "(lat IS NULL) = (lng IS NULL)"
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_constraint("ck_localities_coordinates", "localities", type_="check")
    op.drop_column("localities", "lng")
    op.drop_column("localities", "lat")
