"""reservation giver_user_id

Adds `app/circulation/models.py`'s `Reservation.giver_user_id` — who
physically held the item when the reservation was created. Lets
`app.groups`'s `confirm_transaction`/`cancel_transaction` still recognize
the giving party after a GIFT/SWAP fulfillment, once that party's
`ItemListingPreference` has been cleared and the item has changed hands.

NOT NULL, added in three steps within this one revision (add nullable ->
backfill -> alter to NOT NULL), same shape as `0034`. Backfill is
best-effort for this pre-production database: every existing row gets the
owner of the item's *current* inventory — exact for PENDING/CONFIRMED rows
(nothing has moved yet), approximate for historical FULFILLED/CANCELLED ones.

Revision ID: 0039
Revises: 0038
Create Date: 2026-09-25
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0039"
down_revision: str | None = "0038"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_FK_NAME = "fk_reservations_giver_user_id_users"


def upgrade() -> None:
    op.add_column("reservations", sa.Column("giver_user_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(_FK_NAME, "reservations", "users", ["giver_user_id"], ["id"])

    op.get_bind().execute(
        sa.text(
            """
            UPDATE reservations r
            SET giver_user_id = inv.owner_user_id
            FROM inventory_items ii
            JOIN inventories inv ON inv.id = ii.inventory_id
            WHERE ii.id = r.item_id
            """
        )
    )

    op.alter_column("reservations", "giver_user_id", nullable=False)


def downgrade() -> None:
    op.drop_constraint(_FK_NAME, "reservations", type_="foreignkey")
    op.drop_column("reservations", "giver_user_id")
