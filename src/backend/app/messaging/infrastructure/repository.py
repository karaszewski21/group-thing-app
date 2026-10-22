"""Messaging reads, the keyset message cursor, and the Core hot-row
statements of the send and read paths.

The send path is serialized per conversation: `lock_conversation_for_send`
takes the row lock and `insert_message` stamps `created_at` strictly after
the conversation's `last_message_at`, so `(created_at, id)` order equals
commit order and an `after=` poll never skips a committed row.
The ORM `Conversation` instance is never modified on those paths:
`bump_last_message_at` and `upsert_read_marker` are Core statements that set
`updated_at` themselves, since it has no column default.

The inbox and unread aggregates take the caller's audience as plain id sets
(from `groups_acl.get_chat_audience_for_party`) and are one statement each,
whatever the row count."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from datetime import datetime, timedelta
from typing import NamedTuple

from sqlalchemy import ColumnElement, and_, func, literal, or_, select, true, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..models import Conversation, ConversationKind, ConversationRead, Message

PAGE_SIZE = 50
INBOX_LIMIT = 100
_ONE_MICROSECOND = timedelta(microseconds=1)


class InboxRow(NamedTuple):
    conversation: Conversation
    unread_count: int


async def get_conversation(db: AsyncSession, conversation_id: uuid.UUID) -> Conversation | None:
    """`populate_existing`: the Core bump does not touch identity-map
    instances, so a cached row is refreshed rather than returned stale."""
    return await db.get(Conversation, conversation_id, populate_existing=True)


async def find_item_conversation(
    db: AsyncSession, item_id: uuid.UUID, asker_party_id: uuid.UUID, owner_party_id: uuid.UUID
) -> Conversation | None:
    result = await db.execute(
        select(Conversation).where(
            Conversation.kind == ConversationKind.ITEM,
            Conversation.item_id == item_id,
            Conversation.asker_party_id == asker_party_id,
            Conversation.owner_party_id == owner_party_id,
        )
    )
    return result.scalar_one_or_none()


async def find_group_conversation(db: AsyncSession, group_id: uuid.UUID) -> Conversation | None:
    result = await db.execute(
        select(Conversation).where(
            Conversation.kind == ConversationKind.GROUP, Conversation.group_id == group_id
        )
    )
    return result.scalar_one_or_none()


async def find_term_conversation(db: AsyncSession, term_id: uuid.UUID) -> Conversation | None:
    result = await db.execute(
        select(Conversation).where(
            Conversation.kind == ConversationKind.TERM, Conversation.term_id == term_id
        )
    )
    return result.scalar_one_or_none()


async def get_message_anchor(
    db: AsyncSession, conversation_id: uuid.UUID, message_id: uuid.UUID
) -> Message | None:
    """The message only when it belongs to `conversation_id`; `None` for an
    unknown id or one from another conversation."""
    result = await db.execute(
        select(Message).where(Message.id == message_id, Message.conversation_id == conversation_id)
    )
    return result.scalar_one_or_none()


async def list_messages_page(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    *,
    before: Message | None = None,
    after: Message | None = None,
) -> tuple[list[Message], bool]:
    """Up to `PAGE_SIZE` messages ascending by `(created_at, id)`, plus
    `has_more` from the extra row. No cursor: the newest page, `has_more`
    meaning older ones exist. `before`: the page immediately older than the
    anchor. `after`: the strictly newer page, `has_more` meaning more newer
    ones exist. Anchors come from `get_message_anchor`."""
    stmt = select(Message).where(Message.conversation_id == conversation_id).limit(PAGE_SIZE + 1)
    if after is not None:
        stmt = stmt.where(
            tuple_(Message.created_at, Message.id)
            > tuple_(literal(after.created_at), literal(after.id))
        ).order_by(Message.created_at, Message.id)
        rows = list(await db.scalars(stmt))
        return rows[:PAGE_SIZE], len(rows) > PAGE_SIZE
    if before is not None:
        stmt = stmt.where(
            tuple_(Message.created_at, Message.id)
            < tuple_(literal(before.created_at), literal(before.id))
        )
    stmt = stmt.order_by(Message.created_at.desc(), Message.id.desc())
    rows = list(await db.scalars(stmt))
    return rows[:PAGE_SIZE][::-1], len(rows) > PAGE_SIZE


async def lock_conversation_for_send(
    db: AsyncSession, conversation_id: uuid.UUID
) -> datetime | None:
    """`SELECT last_message_at … FOR UPDATE`: serializes sends to one
    conversation until the transaction ends."""
    return await db.scalar(
        select(Conversation.last_message_at)
        .where(Conversation.id == conversation_id)
        .with_for_update()
    )


async def insert_message(
    db: AsyncSession,
    conversation_id: uuid.UUID,
    sender_party_id: uuid.UUID,
    body: str,
    last_message_at: datetime | None,
) -> Message:
    """`last_message_at` is the value read under `lock_conversation_for_send`;
    `created_at` is `max(utcnow, last_message_at + 1µs)`, strictly increasing
    within the conversation."""
    created_at = datetime.utcnow()
    if last_message_at is not None:
        created_at = max(created_at, last_message_at + _ONE_MICROSECOND)
    message = Message(
        conversation_id=conversation_id,
        sender_party_id=sender_party_id,
        body=body,
        created_at=created_at,
    )
    db.add(message)
    await db.flush()
    return message


async def bump_last_message_at(db: AsyncSession, conversation_id: uuid.UUID, at: datetime) -> None:
    """`last_message_at = GREATEST(coalesce(last_message_at, :at), :at)`."""
    await db.execute(
        update(Conversation)
        .where(Conversation.id == conversation_id)
        .values(
            last_message_at=func.greatest(func.coalesce(Conversation.last_message_at, at), at),
            updated_at=at,
        )
        .execution_options(synchronize_session=False)
    )


async def upsert_read_marker(
    db: AsyncSession, conversation_id: uuid.UUID, party_id: uuid.UUID, read_at: datetime
) -> None:
    """Moves the party's `last_read_at` forward to `read_at`, never back."""
    now = datetime.utcnow()
    stmt = insert(ConversationRead).values(
        id=uuid.uuid4(),
        conversation_id=conversation_id,
        party_id=party_id,
        last_read_at=read_at,
        created_at=now,
        updated_at=now,
    )
    await db.execute(
        stmt.on_conflict_do_update(
            index_elements=[ConversationRead.conversation_id, ConversationRead.party_id],
            set_={
                "last_read_at": func.greatest(
                    ConversationRead.last_read_at, stmt.excluded.last_read_at
                ),
                "updated_at": now,
            },
        )
    )


def _audience_filter(
    party_id: uuid.UUID,
    led_group_ids: Collection[uuid.UUID],
    member_group_ids: Collection[uuid.UUID],
    attended_term_ids: Collection[uuid.UUID],
) -> ColumnElement[bool]:
    return or_(
        and_(
            Conversation.kind == ConversationKind.ITEM,
            or_(
                Conversation.asker_party_id == party_id,
                Conversation.owner_party_id == party_id,
            ),
        ),
        and_(
            Conversation.kind == ConversationKind.GROUP,
            Conversation.group_id.in_([*led_group_ids, *member_group_ids]),
        ),
        and_(
            Conversation.kind == ConversationKind.TERM,
            or_(
                Conversation.term_id.in_(list(attended_term_ids)),
                Conversation.group_id.in_(list(led_group_ids)),
            ),
        ),
    )


def _unread_join(party_id: uuid.UUID) -> tuple[ColumnElement[bool], ColumnElement[bool]]:
    """Join conditions for the caller's read row and the messages unread by
    the caller: newer than the marker (or no marker) and not sent by them."""
    read_on = and_(
        ConversationRead.conversation_id == Conversation.id,
        ConversationRead.party_id == party_id,
    )
    unread_on = and_(
        Message.conversation_id == Conversation.id,
        Message.sender_party_id != party_id,
        or_(
            ConversationRead.last_read_at.is_(None),
            Message.created_at > ConversationRead.last_read_at,
        ),
    )
    return read_on, unread_on


async def select_inbox_rows(
    db: AsyncSession,
    party_id: uuid.UUID,
    led_group_ids: Collection[uuid.UUID],
    member_group_ids: Collection[uuid.UUID],
    attended_term_ids: Collection[uuid.UUID],
    limit: int = INBOX_LIMIT,
) -> list[InboxRow]:
    """The caller's conversations that have a message, newest first, each
    with its exact unread count — one statement."""
    read_on, unread_on = _unread_join(party_id)
    result = await db.execute(
        select(Conversation, func.count(Message.id))
        .outerjoin(ConversationRead, read_on)
        .outerjoin(Message, unread_on)
        .where(
            _audience_filter(party_id, led_group_ids, member_group_ids, attended_term_ids),
            Conversation.last_message_at.is_not(None),
        )
        .group_by(Conversation.id)
        .order_by(Conversation.last_message_at.desc(), Conversation.id.desc())
        .limit(limit)
        .execution_options(populate_existing=True)
    )
    return [InboxRow(conversation, unread) for conversation, unread in result.tuples()]


async def sum_unread(
    db: AsyncSession,
    party_id: uuid.UUID,
    led_group_ids: Collection[uuid.UUID],
    member_group_ids: Collection[uuid.UUID],
    attended_term_ids: Collection[uuid.UUID],
) -> int:
    """Exact unread total over every accessible conversation, read-only ones
    included, with no LIMIT — one statement."""
    return await _count_unread_where(
        db,
        party_id,
        _audience_filter(party_id, led_group_ids, member_group_ids, attended_term_ids),
    )


async def count_unread(db: AsyncSession, conversation_id: uuid.UUID, party_id: uuid.UUID) -> int:
    """One conversation's unread count for the caller (`GET /{id}`)."""
    return await _count_unread_where(db, party_id, Conversation.id == conversation_id)


async def _count_unread_where(
    db: AsyncSession, party_id: uuid.UUID, conversations: ColumnElement[bool]
) -> int:
    read_on, unread_on = _unread_join(party_id)
    total = await db.scalar(
        select(func.count(Message.id))
        .select_from(Conversation)
        .outerjoin(ConversationRead, read_on)
        .join(Message, unread_on)
        .where(conversations)
    )
    return total or 0


async def last_messages_for(
    db: AsyncSession, conversation_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, Message]:
    """The newest message of each conversation: one statement with a
    `LATERAL … LIMIT 1` per conversation (a backward scan of
    `ix_messages_conversation_id_created_at_id`), none for empty input."""
    if not conversation_ids:
        return {}
    newest = (
        select(Message)
        .where(Message.conversation_id == Conversation.id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
        .lateral()
    )
    rows = await db.scalars(
        select(aliased(Message, newest))
        .select_from(Conversation)
        .join(newest, true())
        .where(Conversation.id.in_(list(conversation_ids)))
    )
    return {message.conversation_id: message for message in rows}
