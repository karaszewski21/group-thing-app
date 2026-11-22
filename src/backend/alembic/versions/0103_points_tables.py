"""points tables

Schema only: new tables, no existing table touched. The append-only points
ledger (`point_accounts`, `point_transactions`, `point_entries`) and the
single-row `points_config` (`uq_points_config_singleton` on `((true))`).
A balance is the SUM of an account's entries; the EMISSION account and the
default config row are seeded by 0105. The downgrade drops the four tables
in reverse dependency order.

Revision ID: 0103
Revises: 0102
Create Date: 2026-11-19
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0103"
down_revision: str | None = "0102"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _id() -> sa.Column[Any]:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def _timestamps() -> list[sa.Column[Any]]:
    return [
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "points_config",
        _id(),
        sa.Column("base_small", sa.Integer(), nullable=False),
        sa.Column("base_medium", sa.Integer(), nullable=False),
        sa.Column("base_large", sa.Integer(), nullable=False),
        sa.Column("multiplier_new", sa.Numeric(4, 2), nullable=False),
        sa.Column("multiplier_like_new", sa.Numeric(4, 2), nullable=False),
        sa.Column("multiplier_good", sa.Numeric(4, 2), nullable=False),
        sa.Column("multiplier_fair", sa.Numeric(4, 2), nullable=False),
        sa.Column("multiplier_poor", sa.Numeric(4, 2), nullable=False),
        sa.Column("swap_award", sa.Integer(), nullable=False),
        sa.Column("wants_bonus", sa.Integer(), nullable=False),
        sa.Column("attendance_levels", postgresql.ARRAY(sa.Integer()), nullable=False),
        sa.Column("attendance_monthly_cap", sa.Integer(), nullable=False),
        sa.Column("attendance_min_present", sa.Integer(), nullable=False),
        sa.Column("attendance_auto_close_days", sa.Integer(), nullable=False),
        sa.Column("pair_reward_limit", sa.Integer(), nullable=False),
        sa.Column("pair_window_days", sa.Integer(), nullable=False),
        sa.Column("max_points_offers", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_points_config"),
    )
    op.create_index("uq_points_config_singleton", "points_config", [sa.text("(true)")], unique=True)

    op.create_table(
        "point_accounts",
        _id(),
        sa.Column("account_type", sa.String(20), nullable=False),
        sa.Column("party_id", postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_point_accounts"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_point_accounts_party_id_parties"
        ),
        sa.UniqueConstraint("party_id", name="uq_point_accounts_party_id"),
        sa.CheckConstraint(
            "(account_type = 'PARTY' AND party_id IS NOT NULL) "
            "OR (account_type = 'EMISSION' AND party_id IS NULL)",
            name="ck_point_accounts_party_id_account_type",
        ),
    )
    op.create_index(
        "uq_point_accounts_account_type_emission",
        "point_accounts",
        ["account_type"],
        unique=True,
        postgresql_where=sa.text("account_type = 'EMISSION'"),
    )

    op.create_table(
        "point_transactions",
        _id(),
        sa.Column("transaction_type", sa.String(20), nullable=False),
        sa.Column("source_type", sa.String(20), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("counterparty_party_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("cap_month", sa.Date(), nullable=True),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("occurred_at", sa.TIMESTAMP(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_point_transactions"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_point_transactions_party_id_parties"
        ),
        sa.ForeignKeyConstraint(
            ["counterparty_party_id"],
            ["parties.id"],
            name="fk_point_transactions_counterparty_party_id_parties",
        ),
        sa.UniqueConstraint(
            "transaction_type",
            "source_type",
            "source_id",
            name="uq_point_transactions_type_source",
        ),
        sa.CheckConstraint(
            "(transaction_type = 'ATTENDANCE') = (counterparty_party_id IS NULL)",
            name="ck_point_transactions_counterparty",
        ),
        sa.CheckConstraint(
            "(transaction_type = 'ATTENDANCE') = (cap_month IS NOT NULL)",
            name="ck_point_transactions_cap_month",
        ),
    )
    op.create_index(
        "ix_point_transactions_party_counterparty_occurred_at",
        "point_transactions",
        ["party_id", "counterparty_party_id", "occurred_at"],
    )

    op.create_table(
        "point_entries",
        _id(),
        sa.Column("transaction_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("amount", sa.Integer(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_point_entries"),
        sa.ForeignKeyConstraint(
            ["transaction_id"],
            ["point_transactions.id"],
            name="fk_point_entries_transaction_id_point_transactions",
        ),
        sa.ForeignKeyConstraint(
            ["account_id"],
            ["point_accounts.id"],
            name="fk_point_entries_account_id_point_accounts",
        ),
        sa.CheckConstraint("amount <> 0", name="ck_point_entries_amount_nonzero"),
    )
    op.create_index(
        "ix_point_entries_account_id_transaction_id",
        "point_entries",
        ["account_id", "transaction_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_point_entries_account_id_transaction_id", table_name="point_entries")
    op.drop_table("point_entries")
    op.drop_index(
        "ix_point_transactions_party_counterparty_occurred_at",
        table_name="point_transactions",
    )
    op.drop_table("point_transactions")
    op.drop_index("uq_point_accounts_account_type_emission", table_name="point_accounts")
    op.drop_table("point_accounts")
    op.drop_index("uq_points_config_singleton", table_name="points_config")
    op.drop_table("points_config")
