"""wants

Schema only. `wants` holds what a party is looking for ("Szukam"): a name,
optional category, offer mode and locality with a radius, and the lifecycle
columns (`status`, `expires_at`, `closed_at`, `reminded_at`). `want_matches`
stores each (want, listed item) pair found by the matcher; `item_id` is a
loose pointer without a foreign key. `want_scan_markers` keeps how far the
periodic scan has read; its one row is written by the first scan run.

`wants.name_folded` and `wants.name_query` are GENERATED ALWAYS ... STORED
over `fold_pl(name)`, so changing `fold_pl` means DROP and ADD of both, as
for the `search_vector` columns. `plainto_tsquery` is used in its
two-argument form because the one-argument form is not immutable.

The downgrade is lossy and unguarded: no ledger row depends on a want. It
first deletes the `notifications` rows of kinds `WANT_MATCH_FOUND` and
`WANT_EXPIRING`, which the old image cannot read. An image-only rollback
must delete them by hand.

Revision ID: 0099
Revises: 0098
Create Date: 2026-11-15
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0099"
down_revision: str | None = "0098"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _base_columns() -> list[sa.Column[object]]:
    return [
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
    ]


def upgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        "wants",
        *_base_columns(),
        sa.Column("seeker_party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("note", sa.String(300), nullable=True),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("offer_mode", sa.String(20), nullable=True),
        sa.Column("locality_id", sa.String(7), nullable=True),
        sa.Column("radius_km", sa.SmallInteger(), nullable=True),
        sa.Column("notifications_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("reminded_at", sa.DateTime(), nullable=True),
        sa.Column("short_words_query", postgresql.TSQUERY(), nullable=True),
        sa.Column("match_notification_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("match_notification_count", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id", name="pk_wants"),
        sa.ForeignKeyConstraint(
            ["seeker_party_id"], ["parties.id"], name="fk_wants_seeker_party_id_parties"
        ),
        sa.ForeignKeyConstraint(
            ["category_id"],
            ["categories.id"],
            name="fk_wants_category_id_categories",
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["locality_id"],
            ["localities.id"],
            name="fk_wants_locality_id_localities",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "radius_km IS NULL OR (locality_id IS NOT NULL AND radius_km BETWEEN 1 AND 100)",
            name="ck_wants_radius_requires_locality",
        ),
        sa.CheckConstraint(
            "(status = 'ACTIVE') = (closed_at IS NULL)",
            name="ck_wants_closed_at_matches_status",
        ),
    )
    op.execute(
        "ALTER TABLE wants ADD COLUMN name_folded text "
        "GENERATED ALWAYS AS (fold_pl(name)) STORED NOT NULL"
    )
    op.execute(
        "ALTER TABLE wants ADD COLUMN name_query tsquery "
        "GENERATED ALWAYS AS (plainto_tsquery('simple'::regconfig, fold_pl(name))) "
        "STORED NOT NULL"
    )
    op.create_index("ix_wants_seeker_party_id_status", "wants", ["seeker_party_id", "status"])
    op.create_index(
        "ix_wants_active_expires_at",
        "wants",
        ["expires_at"],
        postgresql_where=sa.text("status = 'ACTIVE'"),
    )
    op.create_index(
        "ix_wants_closed_at",
        "wants",
        ["closed_at"],
        postgresql_where=sa.text("status <> 'ACTIVE'"),
    )

    op.create_table(
        "want_matches",
        *_base_columns(),
        sa.Column("want_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("score", sa.REAL(), nullable=False),
        sa.Column("seen_at", sa.DateTime(), nullable=True),
        sa.Column("opened_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_want_matches"),
        sa.ForeignKeyConstraint(
            ["want_id"], ["wants.id"], name="fk_want_matches_want_id_wants", ondelete="CASCADE"
        ),
        sa.UniqueConstraint("want_id", "item_id", name="uq_want_matches_want_id_item_id"),
    )
    op.create_index("ix_want_matches_item_id", "want_matches", ["item_id"])

    op.create_table(
        "want_scan_markers",
        *_base_columns(),
        sa.Column("scan_name", sa.String(30), nullable=False),
        sa.Column("scanned_through", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_want_scan_markers"),
        sa.UniqueConstraint("scan_name", name="uq_want_scan_markers_scan_name"),
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.execute("DELETE FROM notifications WHERE kind IN ('WANT_MATCH_FOUND', 'WANT_EXPIRING')")
    op.drop_index("ix_want_matches_item_id", table_name="want_matches")
    op.drop_constraint("fk_want_matches_want_id_wants", "want_matches", type_="foreignkey")
    op.drop_table("want_matches")
    op.drop_table("want_scan_markers")
    op.drop_index("ix_wants_closed_at", table_name="wants")
    op.drop_index("ix_wants_active_expires_at", table_name="wants")
    op.drop_index("ix_wants_seeker_party_id_status", table_name="wants")
    op.drop_constraint("fk_wants_locality_id_localities", "wants", type_="foreignkey")
    op.drop_constraint("fk_wants_category_id_categories", "wants", type_="foreignkey")
    op.drop_constraint("fk_wants_seeker_party_id_parties", "wants", type_="foreignkey")
    op.drop_table("wants")
