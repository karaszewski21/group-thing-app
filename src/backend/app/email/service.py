"""Enqueueing outgoing mail in the caller's transaction, and the
preference and suppression reads and writes behind `/api/email`.

The enqueue functions only stage rows: no reads, no commit, and nothing
about the recipient is checked, because the send job binds the address late.
The bell paths cost no statement for unmailed input and one otherwise; a row
whose idempotency key already exists is silently dropped. Nothing here
commits.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import clock

from . import rules
from .models import (
    EmailCategory,
    EmailMessage,
    EmailPreference,
    EmailStatus,
    EmailStream,
    EmailSuppression,
    EmailTemplate,
    SuppressionReason,
)

__all__ = [
    "NotificationEmail",
    "stage_notification_email",
    "enqueue_notification_emails",
    "enqueue_transactional",
    "clear_bounce_suppression",
    "read_preferences",
    "set_preference",
    "find_suppression",
]


@dataclass(frozen=True)
class NotificationEmail:
    """One bell as the email module sees it; `kind` is the bell kind string."""

    notification_id: uuid.UUID
    party_id: uuid.UUID
    kind: str
    message: str
    link_path: str | None
    topic_id: uuid.UUID | None = None
    proposal_id: uuid.UUID | None = None
    reservation_id: uuid.UUID | None = None


def _notifications_live() -> bool:
    return settings.email_enabled and settings.email_notifications_enabled


def _idempotency_key(item: NotificationEmail) -> str:
    if item.kind == rules.WANT_MATCH_KIND and item.topic_id is not None:
        return rules.want_match_key(item.topic_id, rules.want_match_day(clock.local_now()))
    if item.kind == rules.TERM_CONFIRMATION_KIND:
        source_id = item.proposal_id or item.reservation_id
        if source_id is not None:
            return rules.term_confirmation_key(source_id, item.party_id)
    return rules.notification_key(item.notification_id)


def _notification_row(item: NotificationEmail, now: datetime) -> dict[str, Any]:
    return {
        "id": uuid.uuid4(),
        "created_at": now,
        "updated_at": now,
        "idempotency_key": _idempotency_key(item),
        "party_id": item.party_id,
        "stream": EmailStream.NOTIFICATION,
        "category": rules.KIND_RULES[item.kind].category,
        "template": EmailTemplate.NOTIFICATION,
        "notification_id": item.notification_id,
        "notification_kind": item.kind,
        "payload": {"message": item.message, "link_path": item.link_path},
        "status": EmailStatus.PENDING,
        "attempts": 0,
        "send_after": now,
        "expires_at": now + rules.NOTIFICATION_TTL,
    }


async def stage_notification_email(db: AsyncSession, item: NotificationEmail) -> None:
    """The single-bell path. A `notification:` key is unique by construction,
    so the row is only added to the session; any other key may repeat (a
    retried confirmation) and goes out as one `ON CONFLICT DO NOTHING`."""
    if not _notifications_live() or item.kind not in rules.KIND_RULES:
        return
    row = _notification_row(item, datetime.utcnow())
    if row["idempotency_key"] == rules.notification_key(item.notification_id):
        db.add(EmailMessage(**row))
        return
    await db.execute(
        insert(EmailMessage).values(row).on_conflict_do_nothing(index_elements=["idempotency_key"])
    )


async def enqueue_notification_emails(db: AsyncSession, items: Sequence[NotificationEmail]) -> None:
    """The batch path: one multi-row insert for the mailed bells, or no
    statement. Each row gets its own id and timestamps, because a multi-row
    insert evaluates a column default once for the whole statement."""
    if not _notifications_live():
        return
    now = datetime.utcnow()
    rows: dict[str, dict[str, Any]] = {}
    for item in items:
        if item.kind in rules.KIND_RULES:
            row = _notification_row(item, now)
            rows.setdefault(row["idempotency_key"], row)
    if not rows:
        return
    await db.execute(
        insert(EmailMessage)
        .values(list(rows.values()))
        .on_conflict_do_nothing(index_elements=["idempotency_key"])
    )


async def enqueue_transactional(
    db: AsyncSession,
    *,
    template: EmailTemplate,
    party_id: uuid.UUID,
    idempotency_key: str,
    expires_at: datetime,
    payload: dict[str, Any],
) -> None:
    """Stages one account mail (no category). A no-op while email is off."""
    if not settings.email_enabled:
        return
    now = datetime.utcnow()
    db.add(
        EmailMessage(
            idempotency_key=idempotency_key,
            party_id=party_id,
            stream=EmailStream.TRANSACTIONAL,
            category=None,
            template=template,
            payload=payload,
            status=EmailStatus.PENDING,
            attempts=0,
            send_after=now,
            expires_at=expires_at,
        )
    )


async def clear_bounce_suppression(db: AsyncSession, address: str) -> None:
    """Lifts a BOUNCE suppression of `address`; a COMPLAINT stays."""
    await db.execute(
        delete(EmailSuppression).where(
            EmailSuppression.address_normalized == rules.normalize_address(address),
            EmailSuppression.reason == SuppressionReason.BOUNCE,
        )
    )


async def read_preferences(db: AsyncSession, party_id: uuid.UUID) -> dict[str, bool]:
    """The party's stored categories mapped to `enabled`, the shape
    `rules.category_enabled` reads; a missing category means its default."""
    rows = await db.execute(
        select(EmailPreference.category, EmailPreference.enabled).where(
            EmailPreference.party_id == party_id
        )
    )
    return {row.category: row.enabled for row in rows}


async def set_preference(
    db: AsyncSession, party_id: uuid.UUID, category: EmailCategory, enabled: bool
) -> None:
    """Upserts one preference row (Core, so no ORM version check)."""
    now = datetime.utcnow()
    statement = insert(EmailPreference).values(
        id=uuid.uuid4(),
        created_at=now,
        updated_at=now,
        party_id=party_id,
        category=category,
        enabled=enabled,
    )
    statement = statement.on_conflict_do_update(
        constraint="uq_email_preferences_party_id_category",
        set_={"enabled": enabled, "updated_at": now},
    )
    await db.execute(statement)


async def find_suppression(db: AsyncSession, address: str | None) -> SuppressionReason | None:
    if not address:
        return None
    reason: SuppressionReason | None = await db.scalar(
        select(EmailSuppression.reason).where(
            EmailSuppression.address_normalized == rules.normalize_address(address)
        )
    )
    return reason
