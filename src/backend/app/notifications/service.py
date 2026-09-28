"""`app.notifications` business logic + the single cross-vertical write
entrypoint (`create_notification`).

Producing verticals call `create_notification` through their own ACL
module (e.g. `app.groups.infrastructure.notifications_bridge`); the
recipient-facing reads/marks are used only by `app.notifications.router`.
"""

from __future__ import annotations

import uuid

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
    party_id: uuid.UUID,
    kind: NotificationKind,
    message: str,
    link_path: str | None = None,
    proposal_id: uuid.UUID | None = None,
    join_request_id: uuid.UUID | None = None,
    reservation_id: uuid.UUID | None = None,
) -> None:
    """Stage a notification on the session — no commit/flush. The producing
    use case's own trailing `db.commit()` persists it atomically with the
    action that triggered it. `proposal_id` is the loose
    `app.groups.models.SwapProposal.id` pointer, only meaningful for
    `SWAP_PROPOSED`; `join_request_id` is the loose
    `app.groups.models.GroupJoinRequest.id` pointer, only meaningful for
    the `GROUP_JOIN_*` kinds; `reservation_id` is the loose
    `app.circulation.models.Reservation.id` pointer, only meaningful for a
    GIFT/LEND `TERM_CONFIRMATION_NEEDED`."""
    db.add(
        Notification(
            party_id=party_id,
            kind=kind,
            message=message,
            link_path=link_path,
            proposal_id=proposal_id,
            join_request_id=join_request_id,
            reservation_id=reservation_id,
        )
    )


async def list_my_notifications(db: AsyncSession, party_id: uuid.UUID) -> list[Notification]:
    return await repository.list_for_party(db, party_id)


async def count_unread(db: AsyncSession, party_id: uuid.UUID) -> int:
    return await repository.count_unread(db, party_id)


async def mark_read(db: AsyncSession, notification_id: uuid.UUID, party_id: uuid.UUID) -> None:
    notification = await repository.get(db, notification_id)
    if notification is None:
        raise EntityNotFoundException("Notification", notification_id)
    if notification.party_id != party_id:
        raise AccessDeniedException
    if notification.read_at is None:
        notification.read_at = datetime.utcnow()
        await db.commit()


async def mark_all_read(db: AsyncSession, party_id: uuid.UUID) -> None:
    await db.execute(
        update(Notification)
        .where(Notification.party_id == party_id, Notification.read_at.is_(None))
        .values(read_at=datetime.utcnow())
    )
    await db.commit()
