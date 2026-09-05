"""circulation product cleanup data

Data-only migration, run before 0008's schema change. Clears every row that
transitively depends on the soon-to-be-dropped `circulation_products` table
(via `inventory_items.product_id`), in FK-safe child-before-parent order.
No backfill/remap into `app.product.Product` is attempted — `circulation_
products` and `products` have independent id sequences with no
correspondence between rows, and per the product-catalog unification plan
no production data exists yet to preserve (see `project/tech-stack.md`).

`pledges.resolved_reservation_id` has no DB-level FK (a deliberate loose
cross-module reference, see 0003's column comment), but is nulled out here
anyway to avoid leaving dangling references to reservations this migration
deletes.

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-05
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM circulation_entries")
    op.execute("DELETE FROM circulation_transactions")
    op.execute("UPDATE pledges SET resolved_reservation_id = NULL WHERE resolved_reservation_id IS NOT NULL")
    op.execute("DELETE FROM reservations")
    op.execute("DELETE FROM inventory_balances")
    op.execute("DELETE FROM inventory_items")


def downgrade() -> None:
    # No sensible reversal — the deleted rows (and the pledge->reservation
    # links nulled above) are gone. No-op, matching the standard's own
    # precedent for purely data-dropping migrations.
    pass
