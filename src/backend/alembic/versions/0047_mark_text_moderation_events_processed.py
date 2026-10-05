"""mark text moderation events processed

Data only. Product texts are now checked synchronously on write, so the
worker no longer handles `moderation.text_requested`: leftover PENDING rows
are marked PROCESSED (otherwise they would sit in the outbox forever).
Photos still PENDING whose `moderation.photo_requested` event already
FAILED (the old dispatcher gave up after 5 attempts; dev databases only)
go to NEEDS_REVIEW so an admin sees them. No `moderation_decisions` row is
inserted, so the queue shows them without a model score.

Timestamps are naive UTC, like the `utcnow()` values the application writes.
The schema change (dropping `products.text_status`) is the separate 0048.

Revision ID: 0047
Revises: 0046
Create Date: 2026-10-02
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0047"
down_revision: str | None = "0046"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE outbox_entries
        SET status = 'PROCESSED',
            processed_at = timezone('utc', now()),
            updated_at = timezone('utc', now())
        WHERE event_type = 'moderation.text_requested' AND status = 'PENDING'
        """
    )
    op.execute(
        """
        UPDATE product_photos
        SET status = 'NEEDS_REVIEW',
            updated_at = timezone('utc', now())
        WHERE status = 'PENDING'
          AND id::text IN (
              SELECT payload->>'photo_id'
              FROM outbox_entries
              WHERE event_type = 'moderation.photo_requested' AND status = 'FAILED'
          )
        """
    )


def downgrade() -> None:
    # Intentionally a no-op:
    # 1. no handler exists any more for `moderation.text_requested`, so
    #    putting those rows back to PENDING would only strand them again;
    # 2. the photo sweep is not reversible (the earlier PENDING rows are not
    #    distinguishable from photos an admin may since have sent to review);
    # 3. production never enabled moderation, so neither statement touched
    #    production data.
    pass
