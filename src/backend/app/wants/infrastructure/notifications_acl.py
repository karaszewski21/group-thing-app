"""Anti-corruption layer over `app.notifications`: the ONLY `app.wants`
module that imports the notifications vertical. `app.wants` builds its own
Polish messages and writes them through these functions inside its own
transaction; none of them commits. It must not import `..schemas`."""

from __future__ import annotations

from app.notifications.models import NotificationKind
from app.notifications.service import (
    NotificationEntry,
    create_notification,
    create_notifications,
    delete_unread_notifications,
)

__all__ = [
    "NotificationEntry",
    "NotificationKind",
    "create_notification",
    "create_notifications",
    "delete_unread_notifications",
]
