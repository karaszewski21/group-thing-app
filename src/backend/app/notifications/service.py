"""`app.notifications` business logic + the single cross-vertical write
entrypoint (`create_notification`).

Producing verticals call `create_notification` through their own ACL
module (e.g. `app.groups.infrastructure.notifications_bridge`); the
recipient-facing reads/marks are used only by `app.notifications.router`.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AccessDeniedException, EntityNotFoundException

from . import repository
from .models import Notification, NotificationKind

__all__ = [
    "create_notification",
    "list_my_notifications",
    "count_unread",
    "mark_read",
    "mark_all_read",
]


async def create_notification(
    db: AsyncSession,
    *,
    party_id: int,
    kind: NotificationKind,
    message: str,
    link_path: str | None = None,
) -> None:
    """Stage a notification on the session — no commit/flush. The producing
    use case's own trailing `db.commit()` persists it atomically with the
    action that triggered it."""
    db.add(Notification(party_id=party_id, kind=kind, message=message, link_path=link_path))


async def list_my_notifications(db: AsyncSession, party_id: int) -> list[Notification]:
    return await repository.list_for_party(db, party_id)


async def count_unread(db: AsyncSession, party_id: int) -> int:
    return await repository.count_unread(db, party_id)


async def mark_read(db: AsyncSession, notification_id: int, party_id: int) -> None:
    notification = await repository.get(db, notification_id)
    if notification is None:
        raise EntityNotFoundException("Notification", notification_id)
    if notification.party_id != party_id:
        raise AccessDeniedException
    if notification.read_at is None:
        notification.read_at = datetime.utcnow()
        await db.commit()


async def mark_all_read(db: AsyncSession, party_id: int) -> None:
    await db.execute(
        update(Notification)
        .where(Notification.party_id == party_id, Notification.read_at.is_(None))
        .values(read_at=datetime.utcnow())
    )
    await db.commit()
