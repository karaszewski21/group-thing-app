"""Reading and sending messages (spec requirements 17 and 18).

A send is serialized per conversation: the row lock plus a strictly
increasing `created_at` make `(created_at, id)` order equal commit order, so
an `after=` poll never skips a committed message (M8). A send writes no
notification and no outbox event."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Collection

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import (
    BusinessConflictException,
    EntityNotFoundException,
    TextModerationRejected,
    TooManyAttemptsException,
)
from app.moderation.text_guard import TextField, check_text

from ..infrastructure import repository, users_acl
from ..models import Conversation, Message
from ..schemas import MessagePage, MessageResponse, ReadOnlyReason
from .access import Access, resolve_access
from .send_limiter import limiter

logger = logging.getLogger(__name__)

MAX_BODY_LENGTH = 1000
UNKNOWN_SENDER_NAME = "Użytkownik"

_READ_ONLY_MESSAGES: dict[ReadOnlyReason, str] = {
    "GROUP_DELETED": "Grupa usunięta — czat jest tylko do odczytu",
    "GROUP_PUBLIC": "Grupa jest publiczna — czat jest tylko do odczytu",
}


class ReadOnlyConversationException(BusinessConflictException):
    def __init__(self, reason: ReadOnlyReason) -> None:
        super().__init__(_READ_ONLY_MESSAGES[reason])


async def load_accessible(
    db: AsyncSession, principal: Principal, conversation_id: uuid.UUID
) -> tuple[uuid.UUID, Conversation, Access]:
    """`(me, conversation, access)`: 401 without a profile, then 404, then 403."""
    me = await users_acl.get_caller_party_id(db, principal)
    conversation = await repository.get_conversation(db, conversation_id)
    if conversation is None:
        raise EntityNotFoundException("Conversation", conversation_id)
    return me, conversation, await resolve_access(db, conversation, me)


async def get_anchor(
    db: AsyncSession, conversation_id: uuid.UUID, message_id: uuid.UUID
) -> Message:
    anchor = await repository.get_message_anchor(db, conversation_id, message_id)
    if anchor is None:
        raise ValueError("Wiadomość nie należy do tej rozmowy")
    return anchor


async def list_messages(
    db: AsyncSession,
    principal: Principal,
    conversation_id: uuid.UUID,
    before: uuid.UUID | None = None,
    after: uuid.UUID | None = None,
) -> MessagePage:
    me, conversation, access = await load_accessible(db, principal, conversation_id)
    if before is not None and after is not None:
        raise ValueError("Podaj tylko jeden kursor: before albo after")
    before_anchor = await get_anchor(db, conversation_id, before) if before is not None else None
    after_anchor = await get_anchor(db, conversation_id, after) if after is not None else None
    messages, has_more = await repository.list_messages_page(
        db, conversation_id, before=before_anchor, after=after_anchor
    )
    names = await sender_names(db, {message.sender_party_id for message in messages})
    return MessagePage(
        items=[_to_response(message, me, access, names) for message in messages],
        has_more=has_more,
    )


async def send_message(
    db: AsyncSession, principal: Principal, conversation_id: uuid.UUID, body: str
) -> MessageResponse:
    """Access and the body are checked first; the read transaction is then
    committed so no connection idles in a transaction during moderation.
    After moderation the conversation row is locked and access plus
    read-only state are re-checked against fresh rows before the insert.
    Every attempt that reaches moderation counts toward the send limit."""
    me, _, access = await load_accessible(db, principal, conversation_id)
    _ensure_writable(access)
    text = body.strip()
    if not 1 <= len(text) <= MAX_BODY_LENGTH:
        raise ValueError(f"Wiadomość musi mieć od 1 do {MAX_BODY_LENGTH} znaków")
    try:
        limiter.acquire_message(me)
    except TooManyAttemptsException as exc:
        logger.info(
            "Message send rate-limited conversation_id=%s party_id=%s retry_after_seconds=%s",
            conversation_id,
            me,
            exc.retry_after_seconds,
        )
        raise
    await db.commit()

    try:
        await check_text(TextField.MESSAGE_BODY, text)
    except TextModerationRejected:
        logger.info(
            "Message rejected by moderation conversation_id=%s party_id=%s", conversation_id, me
        )
        raise

    last_message_at = await repository.lock_conversation_for_send(db, conversation_id)
    db.expire_all()
    conversation = await repository.get_conversation(db, conversation_id)
    if conversation is None:
        raise EntityNotFoundException("Conversation", conversation_id)
    access = await resolve_access(db, conversation, me)
    _ensure_writable(access)
    message = await repository.insert_message(db, conversation_id, me, text, last_message_at)
    await repository.bump_last_message_at(db, conversation_id, message.created_at)
    await repository.upsert_read_marker(db, conversation_id, me, message.created_at)
    response = _to_response(message, me, access, await sender_names(db, [me]))
    await db.commit()
    return response


def _ensure_writable(access: Access) -> None:
    if access.read_only_reason is not None:
        raise ReadOnlyConversationException(access.read_only_reason)


async def sender_names(db: AsyncSession, party_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
    profiles = await users_acl.list_chat_profiles_by_party_ids(db, party_ids)
    return {party_id: name for party_id, (name, _) in profiles.items()}


def _to_response(
    message: Message, me: uuid.UUID, access: Access, names: dict[uuid.UUID, str]
) -> MessageResponse:
    return MessageResponse(
        id=message.id,
        body=message.body,
        created_at=message.created_at,
        is_mine=message.sender_party_id == me,
        sender_name=names.get(message.sender_party_id, UNKNOWN_SENDER_NAME),
        sender_is_organizer=message.sender_party_id == access.organizer_party_id,
    )
