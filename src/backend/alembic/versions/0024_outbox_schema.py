"""outbox schema

Adds `app/outbox/models.py`'s `OutboxEntry` table: the generic transactional
outbox. A row is staged atomically with the aggregate write that produced it
(`event_type` + `payload` JSONB), then claimed and dispatched by the 30s
poller (`app/outbox/dispatcher.py`). One logical change (this vertical's
schema), mirroring migration 0022's `_sequenced_id`/`_create_sequence`/
`_own_sequence` helper pattern.

Revision ID: 0024
Revises: 0023
Create Date: 2026-09-12
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0024"
down_revision: str | None = "0023"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_OUTBOX_SEQ = "outbox_entry_seq"


def _sequenced_id(sequence_name: str) -> sa.Column[Any]:
    return sa.Column(
        "id",
        sa.BigInteger(),
        server_default=sa.text(f"nextval('{sequence_name}')"),
        nullable=False,
    )


def _create_sequence(name: str) -> None:
    op.execute(f"CREATE SEQUENCE {name}")


def _own_sequence(sequence_name: str, table_name: str) -> None:
    op.execute(f"ALTER SEQUENCE {sequence_name} OWNED BY {table_name}.id")


def upgrade() -> None:
    _create_sequence(_OUTBOX_SEQ)
    op.create_table(
        "outbox_entries",
        _sequenced_id(_OUTBOX_SEQ),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
        sa.Column("processed_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_outbox_entries"),
    )
    _own_sequence(_OUTBOX_SEQ, "outbox_entries")
    op.create_index("ix_outbox_entries_status", "outbox_entries", ["status"], unique=False)


def downgrade() -> None:
    op.execute(f"ALTER SEQUENCE {_OUTBOX_SEQ} OWNED BY NONE")
    op.drop_index("ix_outbox_entries_status", table_name="outbox_entries")
    op.drop_table("outbox_entries")
    op.execute(f"DROP SEQUENCE {_OUTBOX_SEQ}")
