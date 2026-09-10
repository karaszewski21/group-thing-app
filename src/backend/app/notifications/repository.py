"""`app.notifications` read-side queries. Never commits or flushes."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Notification

# Bell dropdown cap — SQL-level per `standards/backend/queries.md`.
_MAX_NOTIFICATIONS = 50


async def list_for_party(db: AsyncSession, party_id: int) -> list[Notification]:
    result = await db.execute(
        select(Notification)
        .where(Notification.party_id == party_id)
        .order_by(Notification.created_at.desc())
        .limit(_MAX_NOTIFICATIONS)
    )
    return list(result.scalars().all())


async def count_unread(db: AsyncSession, party_id: int) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(Notification)
        .where(Notification.party_id == party_id, Notification.read_at.is_(None))
    )
    return int(result.scalar_one())


async def get(db: AsyncSession, notification_id: int) -> Notification | None:
    return await db.get(Notification, notification_id)
