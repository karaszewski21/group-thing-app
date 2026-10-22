"""`app.messaging` request/response models (spec requirements 14 and 16).
Fields that do not apply to a conversation's kind are `null`."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from .models import ConversationKind

ReadOnlyReason = Literal["GROUP_DELETED", "GROUP_PUBLIC"]


class ConversationItemRef(BaseModel):
    id: uuid.UUID
    name: str
    deleted: bool


class ConversationSummary(BaseModel):
    """The fields shared by `GET /{id}` and the inbox rows. `title` is
    built by the server; `term_occurs_on` is naive Warsaw wall-clock."""

    id: uuid.UUID
    kind: ConversationKind
    title: str
    item: ConversationItemRef | None
    counterpart_name: str | None
    group_name: str | None
    term_occurs_on: datetime | None
    unread_count: int
    read_only_reason: ReadOnlyReason | None


class ConversationResponse(ConversationSummary):
    """`participant_count` counts account-backed parties (GROUP and TERM)."""

    participant_count: int | None


class OpenItemConversationRequest(BaseModel):
    item_id: uuid.UUID


class OpenGroupConversationRequest(BaseModel):
    group_id: uuid.UUID


class OpenTermConversationRequest(BaseModel):
    term_id: uuid.UUID


class MessageResponse(BaseModel):
    """`created_at` is naive UTC; `sender_name` is the sender's display name."""

    id: uuid.UUID
    body: str
    created_at: datetime
    is_mine: bool
    sender_name: str
    sender_is_organizer: bool


class MessagePage(BaseModel):
    """Ascending by `(created_at, id)`. Without a cursor or with `before`,
    `has_more` means older messages exist; with `after`, newer ones do."""

    items: list[MessageResponse]
    has_more: bool


class LastMessage(BaseModel):
    body: str
    sender_name: str
    is_mine: bool
    sender_is_organizer: bool
    created_at: datetime


class InboxRowResponse(ConversationSummary):
    last_message: LastMessage


class UnreadCountResponse(BaseModel):
    count: int


class SendMessageRequest(BaseModel):
    """The 1–1000 character rule is checked on the trimmed body in
    `application/messages.py` so it answers with Polish copy."""

    body: str


class MarkReadRequest(BaseModel):
    message_id: uuid.UUID
