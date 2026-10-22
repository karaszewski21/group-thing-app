"""The inbox and the unread badge, each in a fixed number of statements
whatever the number of conversations: the caller's profile, the audience
(3), one conversations/unread statement, then for the inbox one
last-message statement and one batched lookup each for item refs, group
refs, term refs, organizers and profiles. Read-only conversations are listed and counted."""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import NamedTuple, cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal

from ..infrastructure import circulation_acl, groups_acl, repository, users_acl
from ..models import Conversation, ConversationKind, Message
from ..schemas import (
    ConversationItemRef,
    InboxRowResponse,
    LastMessage,
    ReadOnlyReason,
    UnreadCountResponse,
)
from .access import read_only_reason
from .conversations import item_counterpart, term_title
from .messages import UNKNOWN_SENDER_NAME


class _Labels(NamedTuple):
    item_refs: dict[uuid.UUID, tuple[str, datetime | None]]
    group_refs: dict[uuid.UUID, tuple[str, groups_acl.GroupVisibility, datetime | None]]
    term_refs: dict[uuid.UUID, tuple[uuid.UUID, datetime]]
    organizers: dict[uuid.UUID, uuid.UUID]
    names: dict[uuid.UUID, str]


async def list_inbox(db: AsyncSession, principal: Principal) -> list[InboxRowResponse]:
    me = await users_acl.get_caller_party_id(db, principal)
    audience = await groups_acl.get_chat_audience_for_party(db, me)
    rows = await repository.select_inbox_rows(
        db, me, audience.led_group_ids, audience.member_group_ids, audience.attended_term_ids
    )
    conversations = [row.conversation for row in rows]
    ids = [cast(uuid.UUID, conversation.id) for conversation in conversations]
    last_messages = await repository.last_messages_for(db, ids)
    labels = await _load_labels(db, me, conversations, last_messages.values())
    return [
        _to_row(row, last_messages[conversation_id], me, labels)
        for row, conversation_id in zip(rows, ids, strict=True)
        if conversation_id in last_messages
    ]


async def _load_labels(
    db: AsyncSession,
    me: uuid.UUID,
    conversations: list[Conversation],
    last_messages: Iterable[Message],
) -> _Labels:
    group_ids = {c.group_id for c in conversations if c.group_id is not None}
    party_ids = {m.sender_party_id for m in last_messages}
    party_ids.update(
        item_counterpart(c, me) for c in conversations if c.kind == ConversationKind.ITEM
    )
    profiles = await users_acl.list_chat_profiles_by_party_ids(db, party_ids)
    return _Labels(
        item_refs=await circulation_acl.list_item_refs(
            db, {c.item_id for c in conversations if c.item_id is not None}
        ),
        group_refs=await groups_acl.list_chat_group_refs(db, group_ids),
        term_refs=await groups_acl.list_chat_term_refs(
            db, {c.term_id for c in conversations if c.term_id is not None}
        ),
        organizers=await groups_acl.list_current_organizer_party_ids(db, group_ids),
        names={party_id: name for party_id, (name, _) in profiles.items()},
    )


def _to_row(
    row: repository.InboxRow, last: Message, me: uuid.UUID, labels: _Labels
) -> InboxRowResponse:
    """Titles and read-only rules match `GET /{id}`."""
    conversation = row.conversation
    item: ConversationItemRef | None = None
    counterpart_name: str | None = None
    group_name: str | None = None
    term_occurs_on: datetime | None = None
    reason: ReadOnlyReason | None = None
    organizer: uuid.UUID | None = None
    if conversation.kind == ConversationKind.ITEM:
        assert conversation.item_id is not None
        title, deleted_at = labels.item_refs[conversation.item_id]
        item = ConversationItemRef(
            id=conversation.item_id, name=title, deleted=deleted_at is not None
        )
        counterpart_name = labels.names.get(item_counterpart(conversation, me))
    else:
        assert conversation.group_id is not None
        group_name, visibility, group_deleted_at = labels.group_refs[conversation.group_id]
        organizer = labels.organizers.get(conversation.group_id)
        reason = read_only_reason(conversation.kind, group_deleted_at, visibility)
        title = group_name
        if conversation.kind == ConversationKind.TERM:
            assert conversation.term_id is not None
            _, term_occurs_on = labels.term_refs[conversation.term_id]
            title = term_title(term_occurs_on)
    return InboxRowResponse(
        id=conversation.id,
        kind=conversation.kind,
        title=title,
        item=item,
        counterpart_name=counterpart_name,
        group_name=group_name,
        term_occurs_on=term_occurs_on,
        unread_count=row.unread_count,
        read_only_reason=reason,
        last_message=LastMessage(
            body=last.body,
            sender_name=labels.names.get(last.sender_party_id, UNKNOWN_SENDER_NAME),
            is_mine=last.sender_party_id == me,
            sender_is_organizer=last.sender_party_id == organizer,
            created_at=last.created_at,
        ),
    )


async def count_unread(db: AsyncSession, principal: Principal) -> UnreadCountResponse:
    me = await users_acl.get_caller_party_id(db, principal)
    audience = await groups_acl.get_chat_audience_for_party(db, me)
    total = await repository.sum_unread(
        db, me, audience.led_group_ids, audience.member_group_ids, audience.attended_term_ids
    )
    return UnreadCountResponse(count=total)
