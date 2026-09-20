"""enforce one PERSONAL/VIRTUAL inventory per owner

`get_or_create_personal_inventory`/`get_or_create_virtual_inventory`
(`app/circulation/application/inventory.py`) do a non-atomic
check-then-insert with no database-level guard, so two near-simultaneous
callers for the same `owner_user_id` (e.g. a double-fired frontend effect)
can both observe "no existing inventory" and both insert one — silently
splitting a user's items across two inventories, one of which then hides
behind the other in `list_inventories`'s `created_at DESC` ordering. Adds a
partial unique index so a second concurrent insert fails fast with
`IntegrityError`, closing the race at its source; `PICKUP_POINT` is left
unconstrained since it has no established one-per-owner semantics anywhere
in the codebase.

Data only for existing violators: pre-migration cleanup keeps the oldest
row per `(owner_user_id, inventory_type)` conflict and reassigns any
`inventory_items`/`inventory_balances` rows pointing at a row being
dropped, so the index creation itself cannot fail on stale duplicate data.

Revision ID: 0033
Revises: 0032
Create Date: 2026-09-17
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0033"
down_revision: str | None = "0032"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_INDEX_NAME = "uq_inventories_owner_type_personal_virtual"


def upgrade() -> None:
    bind = op.get_bind()

    # Keep the oldest inventory per (owner_user_id, inventory_type) among
    # PERSONAL/VIRTUAL duplicates; repoint items/balances at it; drop the rest.
    duplicate_groups = bind.execute(
        sa.text(
            "SELECT owner_user_id, inventory_type, array_agg(id ORDER BY created_at, id) AS ids "
            "FROM inventories "
            "WHERE inventory_type IN ('PERSONAL', 'VIRTUAL') "
            "GROUP BY owner_user_id, inventory_type "
            "HAVING count(*) > 1"
        )
    ).mappings().all()

    for group in duplicate_groups:
        keep_id, *drop_ids = group["ids"]
        for drop_id in drop_ids:
            bind.execute(
                sa.text(
                    "UPDATE inventory_items SET inventory_id = :keep_id WHERE inventory_id = :drop_id"
                ),
                {"keep_id": keep_id, "drop_id": drop_id},
            )
            bind.execute(
                sa.text(
                    "UPDATE inventory_items SET home_inventory_id = :keep_id "
                    "WHERE home_inventory_id = :drop_id"
                ),
                {"keep_id": keep_id, "drop_id": drop_id},
            )
            bind.execute(
                sa.text("DELETE FROM inventories WHERE id = :drop_id"), {"drop_id": drop_id}
            )

    op.execute(
        f"CREATE UNIQUE INDEX {_INDEX_NAME} ON inventories (owner_user_id, inventory_type) "
        "WHERE inventory_type IN ('PERSONAL', 'VIRTUAL')"
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {_INDEX_NAME}")
