"""`app.messaging` use cases: a flat re-export facade over `application/`
for `app.messaging.router`."""

from __future__ import annotations

from app.messaging.application.conversations import (
    get_conversation,
    open_group_conversation,
    open_item_conversation,
    open_term_conversation,
)
from app.messaging.application.inbox import count_unread, list_inbox
from app.messaging.application.messages import list_messages, send_message
from app.messaging.application.read_markers import mark_read

__all__ = [
    "count_unread",
    "get_conversation",
    "list_inbox",
    "list_messages",
    "mark_read",
    "open_group_conversation",
    "open_item_conversation",
    "open_term_conversation",
    "send_message",
]
