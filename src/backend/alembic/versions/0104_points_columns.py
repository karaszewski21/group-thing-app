"""points columns

Schema only: additive columns on existing tables, no backfill (0105 holds
the data).

- `categories.size_class` (SMALL/MEDIUM/LARGE, NULL = inherit from the
  parent) and `inventory_items.points_value` (20/40/60, never exposed).
- `terms.attendance_points` (the level, NOT NULL DEFAULT 0, which
  PostgreSQL applies without rewriting the table) and the close snapshot
  `attendance_closed_at` / `attendance_min_present` /
  `attendance_present_count` / `attendance_rewarded`, all NULL or all set
  (`ck_terms_attendance_closed`), plus the partial index of open lists
  behind the auto-close job, built without CONCURRENTLY as `terms` is small.
- `term_attendances.present_marked_at` (naive UTC, non-NULL = present).

The downgrade drops the index and the CHECKs, then the columns, losing item
values, term levels, close snapshots and presence marks.

Revision ID: 0104
Revises: 0103
Create Date: 2026-11-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0104"
down_revision: str | None = "0103"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_CLOSE_COLUMNS = (
    "attendance_closed_at",
    "attendance_min_present",
    "attendance_present_count",
    "attendance_rewarded",
)


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column("categories", sa.Column("size_class", sa.String(10), nullable=True))
    op.add_column("inventory_items", sa.Column("points_value", sa.SmallInteger(), nullable=True))

    op.add_column(
        "terms",
        sa.Column("attendance_points", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("terms", sa.Column("attendance_closed_at", sa.TIMESTAMP(), nullable=True))
    op.add_column("terms", sa.Column("attendance_min_present", sa.Integer(), nullable=True))
    op.add_column("terms", sa.Column("attendance_present_count", sa.Integer(), nullable=True))
    op.add_column("terms", sa.Column("attendance_rewarded", sa.Boolean(), nullable=True))
    op.create_check_constraint(
        "ck_terms_attendance_points_nonnegative", "terms", "attendance_points >= 0"
    )
    op.create_check_constraint(
        "ck_terms_attendance_closed",
        "terms",
        f"num_nonnulls({', '.join(_CLOSE_COLUMNS)}) IN (0, 4)",
    )
    op.create_index(
        "ix_terms_occurs_on_attendance_open",
        "terms",
        ["occurs_on"],
        postgresql_where=sa.text("attendance_closed_at IS NULL"),
    )

    op.add_column("term_attendances", sa.Column("present_marked_at", sa.TIMESTAMP(), nullable=True))


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_column("term_attendances", "present_marked_at")

    op.drop_index("ix_terms_occurs_on_attendance_open", table_name="terms")
    op.drop_constraint("ck_terms_attendance_closed", "terms", type_="check")
    op.drop_constraint("ck_terms_attendance_points_nonnegative", "terms", type_="check")
    for column in reversed(_CLOSE_COLUMNS):
        op.drop_column("terms", column)
    op.drop_column("terms", "attendance_points")

    op.drop_column("inventory_items", "points_value")
    op.drop_column("categories", "size_class")
