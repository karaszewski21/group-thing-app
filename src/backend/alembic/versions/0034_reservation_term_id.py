"""reservation term_id

Adds `app/circulation/models.py`'s `Reservation.term_id` — a plain FK-id
column into `groups.terms` (`ForeignKey("terms.id")`, no ORM relationship
object), per `standards/backend/models.md`'s DDD cross-module-reference
convention: `circulation` must not take an ORM-level dependency on `Term`,
which lives in the `groups` module.

NOT NULL. Added in three steps within this one revision (add nullable ->
backfill -> alter to NOT NULL) rather than split across paired revisions,
since the backfill has to run against the same column this revision
introduces and there is no intermediate deploy between the two on this
pre-production project — see `standards/backend/migrations.md`'s "Separate
Schema and Data" note, whose motivating concern (an in-flight older app
version) doesn't apply here yet.

Backfill (best-effort — this is a dev/pre-production database with
disposable test data, not a production migration that needs to be exactly
accurate for every historical row):
  1. PENDING/CONFIRMED-leaning derivation: for each reservation, resolve its
     item's `ItemListingPreference.owner_party_id`, then the nearest (by
     `occurs_on` vs `reserved_at`) Term the owner has ever attended
     (`term_attendances`) — the same standing-preference-to-Term derivation
     `app/groups/application/term_end_scan.py` and
     `term_item_listings._list_eligible_lister_party_ids` already use, just
     run in reverse (item -> owner -> attended Terms) instead of forward
     (Term -> eligible owners -> items).
  2. Fallback for every row step 1 couldn't resolve (no matching
     preference/attendance row — e.g. very old FULFILLED/CANCELLED rows, or
     rows from `PanelDataContext.tsx::returnBorrowedItem`'s pre-existing
     RETURN reservations): nearest Term by date, system-wide, no ownership
     filter.
  3. Final fallback for anything still unresolved (e.g. a dev DB with a
     `reservations` row but zero `terms` rows at all): delete the row.
     Disposable test data; there is no Term to attach it to.

Revision ID: 0034
Revises: 0033
Create Date: 2026-09-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0034"
down_revision: str | None = "0033"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_FK_NAME = "fk_reservations_term_id_terms"


def upgrade() -> None:
    op.add_column("reservations", sa.Column("term_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(_FK_NAME, "reservations", "terms", ["term_id"], ["id"])

    bind = op.get_bind()

    # Step 1: owner-preference-based nearest-Term match.
    bind.execute(
        sa.text(
            """
            UPDATE reservations r
            SET term_id = sub.term_id
            FROM (
                SELECT DISTINCT ON (r2.id) r2.id AS reservation_id, t.id AS term_id
                FROM reservations r2
                JOIN item_listing_preferences ilp ON ilp.item_id = r2.item_id
                JOIN term_attendances ta ON ta.party_id = ilp.owner_party_id
                JOIN terms t ON t.id = ta.term_id
                WHERE r2.term_id IS NULL
                ORDER BY r2.id, ABS(EXTRACT(EPOCH FROM (t.occurs_on - r2.reserved_at)))
            ) sub
            WHERE sub.reservation_id = r.id
            """
        )
    )

    # Step 2: system-wide nearest-Term-by-date fallback for anything step 1
    # couldn't resolve (no listing-preference/attendance trail at all).
    bind.execute(
        sa.text(
            """
            UPDATE reservations r
            SET term_id = sub.term_id
            FROM (
                SELECT DISTINCT ON (r2.id) r2.id AS reservation_id, t.id AS term_id
                FROM reservations r2
                CROSS JOIN terms t
                WHERE r2.term_id IS NULL
                ORDER BY r2.id, ABS(EXTRACT(EPOCH FROM (t.occurs_on - r2.reserved_at)))
            ) sub
            WHERE sub.reservation_id = r.id
            """
        )
    )

    # Step 3: anything still unresolved (e.g. no `terms` rows exist at all
    # in this dev DB) has no Term to attach to — drop it. Disposable test
    # data; nothing downstream holds a real FK into `reservations`
    # (`Pledge.resolved_reservation_id` / `SwapProposal.proposer_reservation_id`
    # are deliberate loose pointers, not FK constraints).
    bind.execute(sa.text("DELETE FROM reservations WHERE term_id IS NULL"))

    op.alter_column("reservations", "term_id", nullable=False)


def downgrade() -> None:
    op.drop_constraint(_FK_NAME, "reservations", type_="foreignkey")
    op.drop_column("reservations", "term_id")
