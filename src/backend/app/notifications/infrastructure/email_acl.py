"""The single bridge from notifications into `app.email`: bells become
queued mails in the caller's transaction. The email module takes the kind as
a plain string, so it never imports this vertical."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from app.email import service as email_service

from ..models import NotificationKind

if TYPE_CHECKING:
    from ..service import NotificationEntry


async def stage(
    db: AsyncSession,
    *,
    notification_id: uuid.UUID,
    party_id: uuid.UUID,
    kind: NotificationKind,
    message: str,
    link_path: str | None,
    proposal_id: uuid.UUID | None,
    reservation_id: uuid.UUID | None,
) -> None:
    await email_service.stage_notification_email(
        db,
        email_service.NotificationEmail(
            notification_id=notification_id,
            party_id=party_id,
            kind=kind.value,
            message=message,
            link_path=link_path,
            proposal_id=proposal_id,
            reservation_id=reservation_id,
        ),
    )


async def enqueue(
    db: AsyncSession,
    notification_ids: Sequence[uuid.UUID],
    entries: Sequence[NotificationEntry],
) -> None:
    await email_service.enqueue_notification_emails(
        db,
        [
            email_service.NotificationEmail(
                notification_id=notification_id,
                party_id=entry.party_id,
                kind=entry.kind.value,
                message=entry.message,
                link_path=entry.link_path,
                topic_id=entry.topic_id,
            )
            for notification_id, entry in zip(notification_ids, entries, strict=True)
        ],
    )
