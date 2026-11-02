"""personal pickup reservations

An open reservation may now have no context at all: a personal pickup agreed
directly with the item's owner. `ck_reservations_context` becomes
`num_nonnulls(term_id, event_id) <= 1`. Constraint-only, no new column: an
open reservation with neither context is personal, a terminal one with neither
may also be one whose event was deleted.

The downgrade refuses while open no-context reservations exist, since 0073's
check would reject them. After a downgrade, terminal personal reservations
read as reservations of a deleted event.

Revision ID: 0074
Revises: 0073
Create Date: 2026-10-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0074"
down_revision: str | None = "0073"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

CONTEXT_CHECK = "num_nonnulls(term_id, event_id) <= 1"
PREVIOUS_CONTEXT_CHECK = (
    "num_nonnulls(term_id, event_id) <= 1 AND "
    "(status NOT IN ('PENDING', 'CONFIRMED') OR num_nonnulls(term_id, event_id) = 1)"
)


def _replace_context_check(condition: str) -> None:
    # Fail fast instead of queueing behind long queries while the check is
    # recreated and validated (as 0073).
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_constraint("ck_reservations_context", "reservations", type_="check")
    op.create_check_constraint("ck_reservations_context", "reservations", condition)


def upgrade() -> None:
    _replace_context_check(CONTEXT_CHECK)


def downgrade() -> None:
    personal = (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT count(*) FROM reservations WHERE status IN ('PENDING', 'CONFIRMED') "
                "AND term_id IS NULL AND event_id IS NULL"
            )
        )
        .scalar_one()
    )
    if personal:
        raise RuntimeError(
            f"Cannot downgrade 0074: {personal} open personal reservation(s) have neither "
            "term_id nor event_id. (a) The listing owner rejects pending personal swap "
            "proposals with POST /api/swap-proposals/{id}/reject (cancel-transaction refuses "
            "unpaired legs); (b) either party cancels accepted personal swaps and personal "
            "gifts with POST /api/reservations/{id}/cancel-transaction; (c) otherwise restore "
            "a pre-0074 dump."
        )
    _replace_context_check(PREVIOUS_CONTEXT_CHECK)
