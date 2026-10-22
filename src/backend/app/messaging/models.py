"""Messaging tables (migration 0061). No `relationship()`: every reference is
a plain FK id column, per `standards/backend/models.md`. The hot rows
(`conversations.last_message_at`, `conversation_reads`) are written with Core
statements; `updated_at` has no column default, so those statements set it
explicitly."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from app.core.base_model import BaseEntity


class ConversationKind(enum.StrEnum):
    ITEM = "ITEM"
    GROUP = "GROUP"
    TERM = "TERM"


class Conversation(BaseEntity):
    """ITEM rows carry `item_id`, `asker_party_id` and `owner_party_id` (the
    item's owner when the thread was opened); GROUP rows carry `group_id`;
    TERM rows carry `term_id` and the Term's `group_id`."""

    __tablename__ = "conversations"
    __table_args__ = (
        Index(
            "uq_conversations_group_id",
            "group_id",
            unique=True,
            postgresql_where=text("kind = 'GROUP'"),
        ),
        Index(
            "uq_conversations_term_id",
            "term_id",
            unique=True,
            postgresql_where=text("kind = 'TERM'"),
        ),
        Index(
            "uq_conversations_item_id_asker_party_id_owner_party_id",
            "item_id",
            "asker_party_id",
            "owner_party_id",
            unique=True,
            postgresql_where=text("kind = 'ITEM'"),
        ),
        Index("ix_conversations_asker_party_id", "asker_party_id"),
        Index("ix_conversations_owner_party_id", "owner_party_id"),
        Index("ix_conversations_group_id", "group_id"),
    )

    kind: Mapped[ConversationKind] = mapped_column(
        Enum(
            ConversationKind,
            native_enum=False,
            length=10,
            values_callable=lambda cls: [member.value for member in cls],
        ),
        nullable=False,
    )
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("inventory_items.id", name="fk_conversations_item_id_inventory_items"),
        nullable=True,
    )
    group_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("groups.id", name="fk_conversations_group_id_groups"),
        nullable=True,
    )
    term_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("terms.id", name="fk_conversations_term_id_terms"),
        nullable=True,
    )
    asker_party_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_conversations_asker_party_id_parties"),
        nullable=True,
    )
    owner_party_id: Mapped[uuid.UUID | None] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_conversations_owner_party_id_parties"),
        nullable=True,
    )
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)


class Message(BaseEntity):
    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_messages_conversation_id_created_at_id", "conversation_id", "created_at", "id"),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("conversations.id", name="fk_messages_conversation_id_conversations"),
        nullable=False,
    )
    sender_party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_messages_sender_party_id_parties"),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(String(1000), nullable=False)


class ConversationRead(BaseEntity):
    __tablename__ = "conversation_reads"
    __table_args__ = (
        Index(
            "uq_conversation_reads_conversation_id_party_id",
            "conversation_id",
            "party_id",
            unique=True,
        ),
    )

    conversation_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("conversations.id", name="fk_conversation_reads_conversation_id_conversations"),
        nullable=False,
    )
    party_id: Mapped[uuid.UUID] = mapped_column(
        postgresql.UUID(as_uuid=True),
        ForeignKey("parties.id", name="fk_conversation_reads_party_id_parties"),
        nullable=False,
    )
    last_read_at: Mapped[datetime] = mapped_column(DateTime(), nullable=False)
