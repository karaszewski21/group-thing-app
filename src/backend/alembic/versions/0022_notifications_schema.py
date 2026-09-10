"""notifications schema

Adds `app/notifications/models.py`'s `Notification` table: a per-recipient
in-app inbox row (`party_id` -> `parties.id`, a pre-rendered `message`, an
optional `link_path`, `read_at` NULL = unread). One logical change (this
vertical's schema), mirroring migration 0012/0014's
`_sequenced_id`/`_create_sequence`/`_own_sequence` helper pattern.

Revision ID: 0022
Revises: 0021
Create Date: 2026-09-10
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0022"
down_revision: str | None = "0021"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_NOTIFICATION_SEQ = "notification_seq"


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
    _create_sequence(_NOTIFICATION_SEQ)
    op.create_table(
        "notifications",
        _sequenced_id(_NOTIFICATION_SEQ),
        sa.Column("party_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=30), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("link_path", sa.String(length=255), nullable=True),
        sa.Column("read_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_notifications"),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_notifications_party_id_parties"
        ),
    )
    _own_sequence(_NOTIFICATION_SEQ, "notifications")
    op.create_index("ix_notifications_party_id", "notifications", ["party_id"], unique=False)


def downgrade() -> None:
    op.execute(f"ALTER SEQUENCE {_NOTIFICATION_SEQ} OWNED BY NONE")
    op.drop_table("notifications")
    op.execute(f"DROP SEQUENCE {_NOTIFICATION_SEQ}")
