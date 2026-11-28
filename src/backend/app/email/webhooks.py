"""The Mailgun webhook: the signature check, the replay memory and applying
delivery events to `email_messages`, `email_suppressions` and
`email_preferences`.

Writes are Core statements (no ORM version check, so a race with the send
job never becomes a `StaleDataError`) in one transaction. The replay token
is recorded only after that transaction commits, so a delivery that failed
here is processed when Mailgun retries it with the same token (M-1).

The replay memory lives in process memory and assumes one backend instance.
Logs never carry the signing key, the token, an address or content.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import String, func, literal, select, update
from sqlalchemy.dialects.postgresql import JSONB, insert
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import TRANSACTION_CONFLICTS
from app.email.models import (
    EmailCategory,
    EmailMessage,
    EmailPreference,
    EmailStatus,
    EmailStream,
    EmailSuppression,
    SuppressionReason,
)
from app.email.rules import WEBHOOK_MAX_SKEW, normalize_address

logger = logging.getLogger(__name__)

REPLAY_MEMORY_SIZE = 10_000
# Mailgun's event JSON is a few KB; a larger body is refused unread.
MAX_BODY_BYTES = 64 * 1024

_RANK = {
    EmailStatus.SENDING: 0,
    EmailStatus.SENT: 1,
    EmailStatus.DELIVERED: 2,
    EmailStatus.BOUNCED: 3,
    EmailStatus.COMPLAINED: 4,
}
_RAISED_FROM_ANY = frozenset({EmailStatus.PENDING, EmailStatus.FAILED})
_MAX_ADDRESS_LENGTH = 320


class WebhookRejectedError(Exception):
    """401 with no detail: a bad signature, a stale timestamp, a replay or no key."""


class WebhookPayloadError(Exception):
    """400: the body is not a JSON object or is over `MAX_BODY_BYTES`."""


class WebhookUnavailableError(Exception):
    """503 with no detail: processing failed, so Mailgun retries."""


class _ReplayMemory:
    """Tokens seen within `WEBHOOK_MAX_SKEW`, oldest first, at most
    `REPLAY_MEMORY_SIZE`. A token older than the skew is rejected as stale
    anyway, so forgetting it then is safe."""

    def __init__(self, size: int) -> None:
        self._size = size
        self._expiry: dict[str, float] = {}

    def _prune(self, now: float) -> None:
        for token in [token for token, expiry in self._expiry.items() if expiry <= now]:
            del self._expiry[token]

    def seen(self, token: str, now: float) -> bool:
        self._prune(now)
        return token in self._expiry

    def record(self, token: str, now: float) -> None:
        self._prune(now)
        while len(self._expiry) >= self._size:
            del self._expiry[next(iter(self._expiry))]
        self._expiry[token] = now + WEBHOOK_MAX_SKEW.total_seconds()


replay_memory = _ReplayMemory(REPLAY_MEMORY_SIZE)


def _reject(reason: str) -> WebhookRejectedError:
    logger.info("email webhook rejected: reason=%s", reason)
    return WebhookRejectedError()


def parse_body(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_BODY_BYTES:
        raise WebhookPayloadError()
    try:
        body = json.loads(raw)
    except ValueError as exc:
        raise WebhookPayloadError() from exc
    if not isinstance(body, dict):
        raise WebhookPayloadError()
    return body


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def verify_signature(body: dict[str, Any], now: float) -> str:
    """Returns the token of a valid, fresh, unseen signature."""
    key = settings.email_webhook_signing_key
    if not key:
        raise _reject("not_configured")
    signature = body.get("signature")
    fields = signature if isinstance(signature, dict) else {}
    timestamp, token, digest = (
        _text(fields.get("timestamp")),
        _text(fields.get("token")),
        _text(fields.get("signature")),
    )
    if timestamp is None or token is None or digest is None:
        raise _reject("bad_signature")
    expected = hmac.new(key.encode(), (timestamp + token).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected.encode(), digest.encode()):
        raise _reject("bad_signature")
    try:
        signed_at = int(timestamp)
    except ValueError:
        raise _reject("stale") from None
    if abs(now - signed_at) > WEBHOOK_MAX_SKEW.total_seconds():
        raise _reject("stale")
    if replay_memory.seen(token, now):
        raise _reject("replay")
    return token


async def handle_mailgun_webhook(db: AsyncSession, raw: bytes) -> None:
    body = parse_body(raw)
    now = datetime.utcnow()
    now_ts = now.replace(tzinfo=UTC).timestamp()
    token = verify_signature(body, now_ts)
    event_data = body.get("event-data")
    try:
        if isinstance(event_data, dict):
            await _apply_event(db, event_data, now)
        await db.commit()
    except DBAPIError as exc:
        await db.rollback()
        sqlstate = getattr(exc.orig, "sqlstate", None)
        if sqlstate in TRANSACTION_CONFLICTS:
            logger.warning("email webhook lost a race (%s); Mailgun retries", sqlstate)
        else:
            logger.exception("email webhook processing failed")
        raise WebhookUnavailableError() from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("email webhook processing failed")
        raise WebhookUnavailableError() from exc
    replay_memory.record(token, now_ts)


def _event_status(event_data: dict[str, Any]) -> EmailStatus | None:
    event = event_data.get("event")
    if event == "delivered":
        return EmailStatus.DELIVERED
    if event == "failed" and event_data.get("severity") == "permanent":
        return EmailStatus.BOUNCED
    if event == "complained":
        return EmailStatus.COMPLAINED
    return None


def _event_time(event_data: dict[str, Any], now: datetime) -> datetime:
    timestamp = event_data.get("timestamp")
    if isinstance(timestamp, int | float) and not isinstance(timestamp, bool):
        try:
            return datetime.fromtimestamp(timestamp, UTC).replace(tzinfo=None)
        except (OverflowError, OSError, ValueError):
            return now
    return now


def _email_message_id(event_data: dict[str, Any]) -> uuid.UUID | None:
    variables = event_data.get("user-variables")
    raw = variables.get("email_message_id") if isinstance(variables, dict) else None
    if not isinstance(raw, str):
        return None
    try:
        return uuid.UUID(raw)
    except ValueError:
        return None


def _provider_message_id(event_data: dict[str, Any]) -> str | None:
    message = event_data.get("message")
    headers = message.get("headers") if isinstance(message, dict) else None
    raw = headers.get("message-id") if isinstance(headers, dict) else None
    if not isinstance(raw, str):
        return None
    normalized = raw.strip().strip("<>")
    return normalized or None


def _recipient(event_data: dict[str, Any]) -> str | None:
    raw = event_data.get("recipient")
    if not isinstance(raw, str):
        return None
    address = normalize_address(raw)
    return address if 0 < len(address) <= _MAX_ADDRESS_LENGTH else None


async def _find_message(db: AsyncSession, event_data: dict[str, Any]) -> Any:
    columns = select(
        EmailMessage.id,
        EmailMessage.status,
        EmailMessage.stream,
        EmailMessage.category,
        EmailMessage.party_id,
    ).with_for_update()
    message_id = _email_message_id(event_data)
    if message_id is not None:
        row = (await db.execute(columns.where(EmailMessage.id == message_id))).first()
        if row is not None:
            return row
    provider_id = _provider_message_id(event_data)
    if provider_id is None:
        return None
    statement = columns.where(EmailMessage.provider_message_id == provider_id).limit(1)
    return (await db.execute(statement)).first()


def _next_status(current: EmailStatus, event_status: EmailStatus) -> EmailStatus:
    if current in _RAISED_FROM_ANY:
        return event_status
    if current in _RANK and _RANK[event_status] > _RANK[current]:
        return event_status
    return current


async def _apply_event(db: AsyncSession, event_data: dict[str, Any], now: datetime) -> None:
    event_status = _event_status(event_data)
    if event_status is None:
        return
    message = await _find_message(db, event_data)
    if message is None:
        return
    at = _event_time(event_data, now)
    values: dict[str, Any] = {"event_at": at, "updated_at": now}
    status = _next_status(message.status, event_status)
    if status != message.status:
        values["status"] = status
        values["payload"] = EmailMessage.payload.op("-", return_type=JSONB)(
            literal("token", String())
        )
    if event_status == EmailStatus.DELIVERED and message.status != EmailStatus.SKIPPED:
        values["delivered_at"] = func.coalesce(EmailMessage.delivered_at, at)
    await db.execute(update(EmailMessage).where(EmailMessage.id == message.id).values(**values))

    if event_status == EmailStatus.DELIVERED:
        return
    reason = (
        SuppressionReason.COMPLAINT
        if event_status == EmailStatus.COMPLAINED
        else SuppressionReason.BOUNCE
    )
    address = _recipient(event_data)
    if address is not None:
        await _upsert_suppression(db, address, reason, message.id, now)
    if (
        reason == SuppressionReason.COMPLAINT
        and message.stream == EmailStream.NOTIFICATION
        and message.category is not None
    ):
        await _disable_category(db, message.party_id, message.category, now)


async def _upsert_suppression(
    db: AsyncSession,
    address: str,
    reason: SuppressionReason,
    source_message_id: uuid.UUID,
    now: datetime,
) -> None:
    statement = insert(EmailSuppression).values(
        id=uuid.uuid4(),
        created_at=now,
        updated_at=now,
        address_normalized=func.lower(func.btrim(address)),
        reason=reason,
        source_message_id=source_message_id,
    )
    statement = statement.on_conflict_do_update(
        index_elements=[EmailSuppression.address_normalized],
        set_={
            "reason": statement.excluded.reason,
            "source_message_id": statement.excluded.source_message_id,
            "updated_at": now,
        },
        where=statement.excluded.reason == SuppressionReason.COMPLAINT,
    )
    await db.execute(statement)


async def _disable_category(
    db: AsyncSession, party_id: uuid.UUID, category: EmailCategory, now: datetime
) -> None:
    statement = insert(EmailPreference).values(
        id=uuid.uuid4(),
        created_at=now,
        updated_at=now,
        party_id=party_id,
        category=category,
        enabled=False,
    )
    statement = statement.on_conflict_do_update(
        constraint="uq_email_preferences_party_id_category",
        set_={"enabled": False, "updated_at": now},
    )
    await db.execute(statement)
