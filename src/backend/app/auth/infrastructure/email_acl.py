"""Anti-corruption layer over `app.email`: the ONLY `app.auth` module that
reaches the email context. Every function stages its row in the caller's
transaction and does nothing while email is off."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.email import rules
from app.email.models import EmailTemplate
from app.email.service import clear_bounce_suppression as _clear_bounce_suppression
from app.email.service import enqueue_transactional

__all__ = [
    "VERIFY_TOKEN_TTL",
    "RESET_TOKEN_TTL",
    "PASSWORD_CHANGED_TTL",
    "TOKEN_REQUEST_MIN_INTERVAL",
    "TOKEN_REQUESTS_PER_HOUR",
    "enqueue_verify_email",
    "enqueue_password_reset",
    "enqueue_password_changed",
    "clear_bounce_suppression",
]

VERIFY_TOKEN_TTL = rules.VERIFY_TOKEN_TTL
RESET_TOKEN_TTL = rules.RESET_TOKEN_TTL
PASSWORD_CHANGED_TTL = rules.NOTIFICATION_TTL
TOKEN_REQUEST_MIN_INTERVAL = rules.TOKEN_REQUEST_MIN_INTERVAL
TOKEN_REQUESTS_PER_HOUR = rules.TOKEN_REQUESTS_PER_HOUR


async def enqueue_verify_email(
    db: AsyncSession, *, token_id: uuid.UUID, party_id: uuid.UUID, token: str, expires_at: datetime
) -> None:
    await enqueue_transactional(
        db,
        template=EmailTemplate.VERIFY_EMAIL,
        party_id=party_id,
        idempotency_key=rules.auth_key(token_id),
        expires_at=expires_at,
        payload={"token": token},
    )


async def enqueue_password_reset(
    db: AsyncSession,
    *,
    token_id: uuid.UUID,
    party_id: uuid.UUID,
    token: str,
    expires_at: datetime,
    google_only: bool,
) -> None:
    await enqueue_transactional(
        db,
        template=EmailTemplate.PASSWORD_RESET,
        party_id=party_id,
        idempotency_key=rules.auth_key(token_id),
        expires_at=expires_at,
        payload={"token": token, "google_only": google_only},
    )


async def enqueue_password_changed(
    db: AsyncSession, *, token_id: uuid.UUID, party_id: uuid.UUID, changed_at: datetime
) -> None:
    """`changed_at` is naive UTC, stored as an ISO string."""
    await enqueue_transactional(
        db,
        template=EmailTemplate.PASSWORD_CHANGED,
        party_id=party_id,
        idempotency_key=rules.password_changed_key(token_id),
        expires_at=changed_at + PASSWORD_CHANGED_TTL,
        payload={"changed_at": changed_at.isoformat()},
    )


async def clear_bounce_suppression(db: AsyncSession, address: str) -> None:
    """Lifts a BOUNCE suppression of `address`; a COMPLAINT stays."""
    await _clear_bounce_suppression(db, address)
