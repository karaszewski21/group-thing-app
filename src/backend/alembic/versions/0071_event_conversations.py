"""event conversations

Adds the EVENT conversation kind's `conversations.event_id` (cascading from
`events`) with a partial unique index per event and a plain index for the
cascade lookup. The `messages` and `conversation_reads` FKs to `conversations`
become cascades so deleting an event removes its chat.

Revision ID: 0071
Revises: 0070
Create Date: 2026-10-30
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0071"
down_revision: str | None = "0070"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

CONVERSATION_CHILD_FKS = (
    ("fk_messages_conversation_id_conversations", "messages"),
    ("fk_conversation_reads_conversation_id_conversations", "conversation_reads"),
)


def _recreate_child_fks(ondelete: str | None) -> None:
    for name, table in CONVERSATION_CHILD_FKS:
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(
            name, table, "conversations", ["conversation_id"], ["id"], ondelete=ondelete
        )


def upgrade() -> None:
    # Fail fast instead of queueing behind long queries while the
    # `messages`/`conversation_reads` FKs are dropped and recreated.
    op.execute("SET LOCAL lock_timeout = '5s'")
    op.add_column(
        "conversations",
        sa.Column("event_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_conversations_event_id_events",
        "conversations",
        "events",
        ["event_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "uq_conversations_event_id",
        "conversations",
        ["event_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'EVENT'"),
    )
    op.create_index("ix_conversations_event_id", "conversations", ["event_id"])
    _recreate_child_fks("CASCADE")


def downgrade() -> None:
    op.execute("DELETE FROM conversations WHERE kind = 'EVENT'")
    _recreate_child_fks(None)
    op.drop_index("ix_conversations_event_id", table_name="conversations")
    op.drop_index("uq_conversations_event_id", table_name="conversations")
    op.drop_constraint("fk_conversations_event_id_events", "conversations", type_="foreignkey")
    op.drop_column("conversations", "event_id")
