"""email tables

Schema only: four new tables, no existing table touched.

- `email_messages`: one outgoing mail and its delivery state. The recipient
  address is never a column. `notification_id` is a loose pointer with no
  FK (collapsed bells delete their notification row). Partial indexes serve
  the send job's PENDING claim and its stuck-SENDING sweep.
- `email_preferences`: one opt-out switch per `(party, category)`; the CHECK
  lists the full category catalogue so later kinds need no migration.
- `email_suppressions`: normalised addresses blocked after a bounce or a
  complaint (`source_message_id` loose).
- `account_tokens` (owned by `auth`): hashed one-time verification and
  password-reset tokens, deleted with their user.

The FKs take a `SHARE ROW EXCLUSIVE` lock on `parties` and `users`, hence the
lock timeout. The downgrade drops the tables in reverse order and is lossy
(delivery state, preferences, suppressions and open tokens are gone).

Revision ID: 0110
Revises: 0109
Create Date: 2026-11-27
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0110"
down_revision: str | None = "0109"
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
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.create_table(
        "email_messages",
        _id(),
        sa.Column("idempotency_key", sa.String(200), nullable=False),
        sa.Column("party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("stream", sa.String(20), nullable=False),
        sa.Column("category", sa.String(30), nullable=True),
        sa.Column("template", sa.String(50), nullable=False),
        sa.Column("notification_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("notification_kind", sa.String(50), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("skip_reason", sa.String(30), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("send_after", sa.TIMESTAMP(), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("claimed_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("sent_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("delivered_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("event_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("provider_message_id", sa.String(255), nullable=True),
        sa.Column("last_error", sa.String(200), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_email_messages"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_email_messages_party_id_parties"
        ),
        sa.UniqueConstraint("idempotency_key", name="uq_email_messages_idempotency_key"),
        sa.CheckConstraint(
            "stream IN ('TRANSACTIONAL', 'NOTIFICATION')", name="ck_email_messages_stream"
        ),
        sa.CheckConstraint(
            "(stream = 'TRANSACTIONAL') = (category IS NULL)",
            name="ck_email_messages_category_stream",
        ),
        sa.CheckConstraint(
            "status IN ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', "
            "'SKIPPED', 'FAILED')",
            name="ck_email_messages_status",
        ),
        sa.CheckConstraint(
            "skip_reason IS NULL OR skip_reason IN ('no_address', 'unverified', "
            "'organization', 'suppressed', 'category_disabled', 'daily_cap', 'expired')",
            name="ck_email_messages_skip_reason",
        ),
        sa.CheckConstraint(
            "(status = 'SKIPPED') = (skip_reason IS NOT NULL)",
            name="ck_email_messages_skipped_reason",
        ),
        sa.CheckConstraint("attempts >= 0", name="ck_email_messages_attempts"),
    )
    op.create_index("ix_email_messages_party_id", "email_messages", ["party_id"])
    op.create_index(
        "ix_email_messages_pending_send_after",
        "email_messages",
        ["send_after"],
        postgresql_where=sa.text("status = 'PENDING'"),
    )
    op.create_index(
        "ix_email_messages_sending_claimed_at",
        "email_messages",
        ["claimed_at"],
        postgresql_where=sa.text("status = 'SENDING'"),
    )
    op.create_index("ix_email_messages_sent_at", "email_messages", ["sent_at"])
    op.create_index(
        "ix_email_messages_provider_message_id", "email_messages", ["provider_message_id"]
    )

    op.create_table(
        "email_preferences",
        _id(),
        sa.Column("party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_email_preferences"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_email_preferences_party_id_parties"
        ),
        sa.UniqueConstraint("party_id", "category", name="uq_email_preferences_party_id_category"),
        sa.CheckConstraint(
            "category IN ('ALL', 'RESERVATIONS', 'MEETINGS', 'WANTS', 'MESSAGES', "
            "'ORGANIZER_DIGESTS')",
            name="ck_email_preferences_category",
        ),
    )

    op.create_table(
        "email_suppressions",
        _id(),
        sa.Column("address_normalized", sa.String(320), nullable=False),
        sa.Column("reason", sa.String(20), nullable=False),
        sa.Column("source_message_id", postgresql.UUID(as_uuid=True), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_email_suppressions"),
        sa.UniqueConstraint("address_normalized", name="uq_email_suppressions_address_normalized"),
        sa.CheckConstraint(
            "address_normalized = lower(btrim(address_normalized))",
            name="ck_email_suppressions_address_normalized",
        ),
        sa.CheckConstraint(
            "reason IN ('BOUNCE', 'COMPLAINT')", name="ck_email_suppressions_reason"
        ),
    )

    op.create_table(
        "account_tokens",
        _id(),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("purpose", sa.String(20), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("expires_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("used_at", sa.TIMESTAMP(), nullable=True),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name="pk_account_tokens"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_account_tokens_user_id_users",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("token_hash", name="uq_account_tokens_token_hash"),
        sa.CheckConstraint(
            "purpose IN ('VERIFY_EMAIL', 'PASSWORD_RESET')", name="ck_account_tokens_purpose"
        ),
    )
    op.create_index(
        "ix_account_tokens_user_id_purpose_created_at",
        "account_tokens",
        ["user_id", "purpose", "created_at"],
    )


def downgrade() -> None:
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.drop_index("ix_account_tokens_user_id_purpose_created_at", table_name="account_tokens")
    op.drop_table("account_tokens")
    op.drop_table("email_suppressions")
    op.drop_table("email_preferences")
    op.drop_index("ix_email_messages_provider_message_id", table_name="email_messages")
    op.drop_index("ix_email_messages_sent_at", table_name="email_messages")
    op.drop_index("ix_email_messages_sending_claimed_at", table_name="email_messages")
    op.drop_index("ix_email_messages_pending_send_after", table_name="email_messages")
    op.drop_index("ix_email_messages_party_id", table_name="email_messages")
    op.drop_table("email_messages")
