"""points seed

Data only.

- Inserts the single EMISSION account and the default `points_config` row,
  with explicit `id`, `created_at` and `updated_at` (BaseEntity has no
  server default for the timestamps).
- Sets `size_class = 'MEDIUM'` on every root category.
- Backfills every item's `points_value` in one `UPDATE … FROM`: a top-down
  recursive CTE resolves each category's class (a child's own value wins
  over its parent's), joined through `products.category_id`, times the
  default condition multiplier, snapped as in the code (< 30 → 20,
  < 50 → 40, otherwise 60).
- Closes every term that has already started (no retroactive points), so
  the auto-close job finds no backlog.

Guarded downgrade: refuses while any `point_transactions` row exists.
Recovery: restore the pre-0103 dump, or purge `point_entries` and
`point_transactions` (losing every balance) and rerun the downgrade.
Otherwise it deletes the config and EMISSION rows and NULLs every
`size_class` (admin-set ones too), every `points_value` and the four
attendance-close columns.

Revision ID: 0105
Revises: 0104
Create Date: 2026-11-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0105"
down_revision: str | None = "0104"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_NOW_UTC = "(now() AT TIME ZONE 'UTC')"

_BACKFILL_POINTS_VALUE = """
WITH RECURSIVE resolved (id, size_class) AS (
    SELECT c.id, coalesce(c.size_class, 'MEDIUM')
    FROM categories c
    WHERE c.parent_id IS NULL
  UNION ALL
    SELECT c.id, coalesce(c.size_class, r.size_class)
    FROM resolved r
    JOIN categories c ON c.parent_id = r.id
), raw_values AS (
    SELECT i.id,
           CASE r.size_class
               WHEN 'SMALL' THEN cfg.base_small
               WHEN 'LARGE' THEN cfg.base_large
               ELSE cfg.base_medium
           END
           * CASE i.condition
               WHEN 'NEW' THEN cfg.multiplier_new
               WHEN 'LIKE_NEW' THEN cfg.multiplier_like_new
               WHEN 'GOOD' THEN cfg.multiplier_good
               WHEN 'FAIR' THEN cfg.multiplier_fair
               WHEN 'POOR' THEN cfg.multiplier_poor
           END AS raw
    FROM inventory_items i
    JOIN products p ON p.id = i.product_id
    JOIN resolved r ON r.id = p.category_id
    CROSS JOIN points_config cfg
)
UPDATE inventory_items i
SET points_value = CASE WHEN v.raw < 30 THEN 20 WHEN v.raw < 50 THEN 40 ELSE 60 END
FROM raw_values v
WHERE v.id = i.id AND v.raw IS NOT NULL
"""


def upgrade() -> None:
    op.execute(
        "INSERT INTO point_accounts (id, account_type, party_id, created_at, updated_at) "
        f"VALUES (gen_random_uuid(), 'EMISSION', NULL, {_NOW_UTC}, {_NOW_UTC})"
    )
    op.execute(
        "INSERT INTO points_config (id, base_small, base_medium, base_large, "
        "multiplier_new, multiplier_like_new, multiplier_good, multiplier_fair, "
        "multiplier_poor, swap_award, wants_bonus, attendance_levels, "
        "attendance_monthly_cap, attendance_min_present, attendance_auto_close_days, "
        "pair_reward_limit, pair_window_days, max_points_offers, created_at, updated_at) "
        "VALUES (gen_random_uuid(), 20, 40, 60, 1.50, 1.25, 1.00, 0.75, 0.50, 10, 10, "
        f"ARRAY[0, 10, 20], 40, 3, 7, 3, 30, 5, {_NOW_UTC}, {_NOW_UTC})"
    )
    op.execute("UPDATE categories SET size_class = 'MEDIUM' WHERE parent_id IS NULL")
    op.execute(_BACKFILL_POINTS_VALUE)
    op.execute(
        f"UPDATE terms SET attendance_closed_at = {_NOW_UTC}, attendance_min_present = 3, "
        "attendance_present_count = 0, attendance_rewarded = false "
        "WHERE occurs_on < (now() AT TIME ZONE 'Europe/Warsaw') "
        "AND attendance_closed_at IS NULL"
    )


def downgrade() -> None:
    posted = op.get_bind().execute(sa.text("SELECT count(*) FROM point_transactions")).scalar_one()
    if posted:
        raise RuntimeError(
            f"Cannot downgrade 0105: {posted} point transactions exist. Restore the pre-0103 "
            "dump, or purge point_entries and point_transactions (every balance is lost) "
            "and rerun the downgrade."
        )
    op.execute("DELETE FROM points_config")
    op.execute("DELETE FROM point_accounts WHERE account_type = 'EMISSION'")
    op.execute("UPDATE categories SET size_class = NULL WHERE size_class IS NOT NULL")
    op.execute("UPDATE inventory_items SET points_value = NULL WHERE points_value IS NOT NULL")
    op.execute(
        "UPDATE terms SET attendance_closed_at = NULL, attendance_min_present = NULL, "
        "attendance_present_count = NULL, attendance_rewarded = NULL "
        "WHERE attendance_closed_at IS NOT NULL"
    )
