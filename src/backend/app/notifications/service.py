"""`app.notifications` business logic + the cross-vertical write
entrypoints (`create_notification`, the batched `create_notifications` and
`delete_unread_notifications`).

Producing verticals call them through their own ACL module (e.g.
`app.groups.infrastructure.notifications_bridge`,
`app.wants.infrastructure.notifications_acl`); the recipient-facing
reads/marks are used only by `app.notifications.router`.
"""

from __future__ import annotations

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, insert, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AccessDeniedException, EntityNotFoundException

from . import repository
from .models import Notification, NotificationKind

__all__ = [
    "NotificationEntry",
    "create_notification",
    "create_notifications",
    "delete_unread_notifications",
    "list_my_notifications",
    "count_unread",
    "mark_read",
    "mark_all_read",
]


@dataclass(frozen=True)
class NotificationEntry:
    """One row for `create_notifications`."""

    party_id: uuid.UUID
    kind: NotificationKind
    message: str
    link_path: str | None


async def create_notification(
    db: AsyncSession,
    *,
    party_id: uuid.UUID,
    kind: NotificationKind,
    message: str,
    link_path: str | None = None,
    proposal_id: uuid.UUID | None = None,
    reservation_id: uuid.UUID | None = None,
) -> None:
    """Stage a notification on the session — no commit/flush. The producing
    use case's own trailing `db.commit()` persists it atomically with the
    action that triggered it. `proposal_id` is the loose
    `app.groups.models.SwapProposal.id` pointer, set on `SWAP_PROPOSED`
    and on a swap `TERM_CONFIRMATION_NEEDED`; `reservation_id` is the loose
    `app.inventory.models.Reservation.id` pointer, only meaningful for a
    GIFT `TERM_CONFIRMATION_NEEDED`."""
    db.add(
        Notification(
            party_id=party_id,
            kind=kind,
            message=message,
            link_path=link_path,
            proposal_id=proposal_id,
            reservation_id=reservation_id,
        )
    )


async def create_notifications(
    db: AsyncSession, entries: Sequence[NotificationEntry]
) -> list[uuid.UUID]:
    """Inserts one row per entry in one statement, no commit, and returns the
    new ids in entry order. Each row gets its id and timestamps here because
    a multi-row insert evaluates a column default once for the whole
    statement."""
    if not entries:
        return []
    now = datetime.utcnow()
    new_ids = [uuid.uuid4() for _ in entries]
    await db.execute(
        insert(Notification).values(
            [
                {
                    "id": new_id,
                    "created_at": now,
                    "updated_at": now,
                    "party_id": entry.party_id,
                    "kind": entry.kind,
                    "message": entry.message,
                    "link_path": entry.link_path,
                }
                for new_id, entry in zip(new_ids, entries, strict=True)
            ]
        )
    )
    return new_ids


async def delete_unread_notifications(
    db: AsyncSession, notification_ids: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """Deletes the given rows that are still unread in one statement and
    returns their ids. No commit."""
    if not notification_ids:
        return set()
    result = await db.execute(
        delete(Notification)
        .where(Notification.id.in_(notification_ids), Notification.read_at.is_(None))
        .returning(Notification.id)
    )
    return set(result.scalars().all())


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
