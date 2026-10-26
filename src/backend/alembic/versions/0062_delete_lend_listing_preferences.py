"""delete LEND listing preferences

Lending between parents is removed from the product: only SWAP and
GIFT stay offerable (`groups.schemas._OFFERABLE_RESERVATION_TYPES`). Data-only
migration: deletes every `item_listing_preferences` row with `mode = 'LEND'`,
so no item is still shown as "Wypożyczę". Reservations already taken from such
a listing are left alone.

The downgrade is a no-op: deleted preferences are not restored.

Revision ID: 0062
Revises: 0061
Create Date: 2026-10-26
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0062"
down_revision: str | None = "0061"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM item_listing_preferences WHERE mode = 'LEND'")


def downgrade() -> None:
    pass
