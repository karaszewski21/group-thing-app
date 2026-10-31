"""event reservations

A reservation belongs to exactly one context while it is open: a Term or an
Event. `term_id` becomes nullable, `event_id` is added with `ON DELETE SET
NULL` (deleting an event cancels its open reservations first, then detaches
the terminal ones), and `ck_reservations_context` keeps at most one context
on every row and exactly one on PENDING/CONFIRMED rows.

The downgrade refuses while any row has `term_id IS NULL`: those rows are
referenced by the ledger and cannot be given a Term back.

Revision ID: 0073
Revises: 0072
Create Date: 2026-10-31
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0073"
down_revision: str | None = "0072"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

CONTEXT_CHECK = (
    "num_nonnulls(term_id, event_id) <= 1 AND "
    "(status NOT IN ('PENDING', 'CONFIRMED') OR num_nonnulls(term_id, event_id) = 1)"
)


def upgrade() -> None:
    # Fail fast instead of queueing behind long queries while `reservations`
    # is altered and its check constraint validated (as 0071).
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.alter_column("reservations", "term_id", existing_type=postgresql.UUID(), nullable=True)
    op.add_column(
        "reservations", sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_reservations_event_id_events",
        "reservations",
        "events",
        ["event_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_reservations_event_id",
        "reservations",
        ["event_id"],
        postgresql_where=sa.text("event_id IS NOT NULL"),
    )
    op.create_check_constraint("ck_reservations_context", "reservations", CONTEXT_CHECK)


def downgrade() -> None:
    contextless = op.get_bind().execute(
        sa.text("SELECT count(*) FROM reservations WHERE term_id IS NULL")
    ).scalar_one()
    if contextless:
        raise RuntimeError(
            f"Cannot downgrade 0073: {contextless} reservation(s) have term_id IS NULL "
            "(event reservations, or reservations detached from a deleted event). "
            "Cancel and purge those event reservations and the circulation_entries "
            "referencing them manually, or restore a pre-0073 backup."
        )
    op.drop_constraint("ck_reservations_context", "reservations", type_="check")
    op.drop_index("ix_reservations_event_id", table_name="reservations")
    op.drop_constraint("fk_reservations_event_id_events", "reservations", type_="foreignkey")
    op.drop_column("reservations", "event_id")
    op.alter_column("reservations", "term_id", existing_type=postgresql.UUID(), nullable=False)
