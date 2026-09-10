"""Anti-corruption layer over `app.notifications`: the ONLY `app.groups`
module that imports the notifications vertical. `application/pledges` and
`application/pledge_fulfillment` / `application/terms` build the Polish
message themselves (the groups BC owns its own copy) and stage it through
this thin pass-through, so it lands atomically with the pledge write on the
caller's trailing `db.commit()`."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.notifications import service as notifications_service
from app.notifications.models import NotificationKind

__all__ = ["NotificationKind", "create_notification"]


async def create_notification(
    db: AsyncSession,
    *,
    party_id: int,
    kind: NotificationKind,
    message: str,
    link_path: str | None = None,
) -> None:
    await notifications_service.create_notification(
        db, party_id=party_id, kind=kind, message=message, link_path=link_path
    )
