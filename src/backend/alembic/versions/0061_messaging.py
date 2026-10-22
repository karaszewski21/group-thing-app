"""messaging

Schema only: the `app.messaging` tables.
- `conversations`: one thread per ITEM `(item_id, asker_party_id,
  owner_party_id)`, per GROUP `group_id` and per TERM `term_id`, each enforced
  by a partial unique index on `kind`. `last_message_at` is NULL until the
  first message.
- `messages`: the thread's messages, paged by `(conversation_id, created_at,
  id)`.
- `conversation_reads`: one read marker per (conversation, party).

The referenced items, Circles and Terms are only soft-deleted, so the FKs
carry no `ON DELETE` action.

Revision ID: 0061
Revises: 0060
Create Date: 2026-10-22
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0061"
down_revision: str | None = "0060"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def _id_column() -> sa.Column[uuid.UUID]:
    return sa.Column(
        "id",
        postgresql.UUID(as_uuid=True),
        server_default=sa.text("gen_random_uuid()"),
        nullable=False,
    )


def upgrade() -> None:
    op.create_table(
        "conversations",
        _id_column(),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("term_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("asker_party_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("owner_party_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_message_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_conversations"),
        sa.ForeignKeyConstraint(
            ["item_id"], ["inventory_items.id"], name="fk_conversations_item_id_inventory_items"
        ),
        sa.ForeignKeyConstraint(
            ["group_id"], ["groups.id"], name="fk_conversations_group_id_groups"
        ),
        sa.ForeignKeyConstraint(["term_id"], ["terms.id"], name="fk_conversations_term_id_terms"),
        sa.ForeignKeyConstraint(
            ["asker_party_id"], ["parties.id"], name="fk_conversations_asker_party_id_parties"
        ),
        sa.ForeignKeyConstraint(
            ["owner_party_id"], ["parties.id"], name="fk_conversations_owner_party_id_parties"
        ),
    )
    op.create_index(
        "uq_conversations_group_id",
        "conversations",
        ["group_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'GROUP'"),
    )
    op.create_index(
        "uq_conversations_term_id",
        "conversations",
        ["term_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'TERM'"),
    )
    op.create_index(
        "uq_conversations_item_id_asker_party_id_owner_party_id",
        "conversations",
        ["item_id", "asker_party_id", "owner_party_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'ITEM'"),
    )
    op.create_index("ix_conversations_asker_party_id", "conversations", ["asker_party_id"])
    op.create_index("ix_conversations_owner_party_id", "conversations", ["owner_party_id"])
    op.create_index("ix_conversations_group_id", "conversations", ["group_id"])

    op.create_table(
        "messages",
        _id_column(),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sender_party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("body", sa.String(1000), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_messages"),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name="fk_messages_conversation_id_conversations",
        ),
        sa.ForeignKeyConstraint(
            ["sender_party_id"], ["parties.id"], name="fk_messages_sender_party_id_parties"
        ),
    )
    op.create_index(
        "ix_messages_conversation_id_created_at_id",
        "messages",
        ["conversation_id", "created_at", "id"],
    )

    op.create_table(
        "conversation_reads",
        _id_column(),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("party_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("last_read_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_conversation_reads"),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name="fk_conversation_reads_conversation_id_conversations",
        ),
        sa.ForeignKeyConstraint(
            ["party_id"], ["parties.id"], name="fk_conversation_reads_party_id_parties"
        ),
    )
    op.create_index(
        "uq_conversation_reads_conversation_id_party_id",
        "conversation_reads",
        ["conversation_id", "party_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_conversation_reads_conversation_id_party_id", table_name="conversation_reads")
    op.drop_constraint(
        "fk_conversation_reads_party_id_parties", "conversation_reads", type_="foreignkey"
    )
    op.drop_constraint(
        "fk_conversation_reads_conversation_id_conversations",
        "conversation_reads",
        type_="foreignkey",
    )
    op.drop_table("conversation_reads")

    op.drop_index("ix_messages_conversation_id_created_at_id", table_name="messages")
    op.drop_constraint("fk_messages_sender_party_id_parties", "messages", type_="foreignkey")
    op.drop_constraint("fk_messages_conversation_id_conversations", "messages", type_="foreignkey")
    op.drop_table("messages")

    for index in (
        "ix_conversations_group_id",
        "ix_conversations_owner_party_id",
        "ix_conversations_asker_party_id",
        "uq_conversations_item_id_asker_party_id_owner_party_id",
        "uq_conversations_term_id",
        "uq_conversations_group_id",
    ):
        op.drop_index(index, table_name="conversations")
    for constraint in (
        "fk_conversations_owner_party_id_parties",
        "fk_conversations_asker_party_id_parties",
        "fk_conversations_term_id_terms",
        "fk_conversations_group_id_groups",
        "fk_conversations_item_id_inventory_items",
    ):
        op.drop_constraint(constraint, "conversations", type_="foreignkey")
    op.drop_table("conversations")
