"""pledges single active claim

Enforces "only one person brings a needed item" at the DB level: a partial
unique index on `pledges(needed_item_id)` where the pledge is not
`WITHDRAWN`. `app.groups.application.pledges.create_pledge` already checks
this and raises 409, but the index closes the check-then-insert race.

Any pre-existing local/dev duplicates must be resolved first (a unique
index cannot be built over them) — the earliest active pledge per needed
item is kept, the rest are withdrawn. Data-prep + constraint in one
revision follows the `0013_organizations_slug` precedent
(add-column + backfill + unique in one file). A fresh DB has zero pledges,
so the `UPDATE` is a no-op there.

`downgrade()` drops the index; it does NOT resurrect any pledge withdrawn
by the `UPDATE` (the original per-row status is not recoverable) — the same
one-way asymmetry the 0007/0019 downgrades accept.

Revision ID: 0023
Revises: 0022
Create Date: 2026-09-10
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0023"
down_revision: str | None = "0022"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE pledges SET status = 'WITHDRAWN'
        WHERE status <> 'WITHDRAWN'
          AND id NOT IN (
            SELECT min(id) FROM pledges
            WHERE status <> 'WITHDRAWN'
            GROUP BY needed_item_id
          )
        """
    )
    op.create_index(
        "uq_pledges_active_needed_item",
        "pledges",
        ["needed_item_id"],
        unique=True,
        postgresql_where=sa.text("status <> 'WITHDRAWN'"),
    )


def downgrade() -> None:
    op.drop_index("uq_pledges_active_needed_item", table_name="pledges")
