"""organization page layout

Adds `app/organizations/models.py`'s `Organization.page_layout` (the public
page layout key an organizer picks) and `Organization.palette_preset` (the
chosen color preset key; NULL means the default palette or custom colors).

`page_layout` is a single `add_column` step with `server_default="CLASSIC"`,
kept permanently (not dropped after backfill): the default is one fixed,
always-sensible value for every existing row — see
`standards/backend/migrations.md` and `0035_group_layout_mode.py`. Neither
column has a CHECK constraint or DB enum: the allowed keys live in code
(`page_layouts.PAGE_LAYOUT_KEYS`, `palettes.PALETTE_PRESET_KEYS`) so that
future `custom:<uuid>` layout keys never require a migration (ADR-003).

Revision ID: 0052
Revises: 0051
Create Date: 2026-10-08
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0052"
down_revision: str | None = "0051"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organizations",
        sa.Column("page_layout", sa.String(64), nullable=False, server_default="CLASSIC"),
    )
    op.add_column("organizations", sa.Column("palette_preset", sa.String(40), nullable=True))


def downgrade() -> None:
    op.drop_column("organizations", "palette_preset")
    op.drop_column("organizations", "page_layout")
