"""`POST /api/email/webhooks/mailgun`: the signature check, status
precedence, suppressions and the complaint opt-out. Payloads are signed with
a dummy test key set through `monkeypatch`."""

from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.email import webhooks
from app.email.models import (
    EmailCategory,
    EmailMessage,
    EmailPreference,
    EmailSkipReason,
    EmailStatus,
    EmailStream,
    EmailSuppression,
    EmailTemplate,
    SuppressionReason,
)

_URL = "/api/email/webhooks/mailgun"
_TEST_KEY = "test-webhook-key-not-a-secret"


@pytest.fixture(autouse=True)
def _signing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "email_webhook_signing_key", _TEST_KEY)


def _signature(*, timestamp: int | None = None, key: str = _TEST_KEY) -> dict[str, str]:
    ts = str(int(time.time()) if timestamp is None else timestamp)
    token = uuid.uuid4().hex
    digest = hmac.new(key.encode(), (ts + token).encode(), hashlib.sha256).hexdigest()
    return {"timestamp": ts, "token": token, "signature": digest}


def _payload(
    event: str,
    *,
    message: EmailMessage | None = None,
    email_message_id: str | None = None,
    provider_message_id: str | None = None,
    recipient: str = "Someone@Example.com ",
    severity: str | None = None,
    signature: dict[str, str] | None = None,
) -> dict[str, Any]:
    event_data: dict[str, Any] = {
        "event": event,
        "timestamp": time.time(),
        "recipient": recipient,
        "message": {"headers": {"message-id": provider_message_id or "<unknown@mg>"}},
        "user-variables": {
            "email_message_id": email_message_id or (str(message.id) if message else "")
        },
    }
    if severity:
        event_data["severity"] = severity
    return {"signature": signature or _signature(), "event-data": event_data}


async def _seed_message(
    db: AsyncSession,
    *,
    status: EmailStatus = EmailStatus.SENT,
    stream: EmailStream = EmailStream.NOTIFICATION,
    provider_message_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> EmailMessage:
    party_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO parties (id, party_type, active, created_at, updated_at) "
            "VALUES (:id, 'PERSON', true, now(), now())"
        ),
        {"id": party_id},
    )
    now = datetime.now(UTC).replace(tzinfo=None)
    message = EmailMessage(
        idempotency_key=f"test:{uuid.uuid4()}",
        party_id=party_id,
        stream=stream,
        category=EmailCategory.RESERVATIONS if stream == EmailStream.NOTIFICATION else None,
        template=(
            EmailTemplate.NOTIFICATION
            if stream == EmailStream.NOTIFICATION
            else EmailTemplate.VERIFY_EMAIL
        ),
        payload=payload or {},
        status=status,
        skip_reason=EmailSkipReason.SUPPRESSED if status == EmailStatus.SKIPPED else None,
        send_after=now,
        expires_at=now + timedelta(hours=24),
        provider_message_id=provider_message_id,
    )
    db.add(message)
    await db.commit()
    return message


async def _row(db: AsyncSession, message_id: uuid.UUID) -> Any:
    result = await db.execute(
        select(
            EmailMessage.status,
            EmailMessage.payload,
            EmailMessage.delivered_at,
            EmailMessage.event_at,
        ).where(EmailMessage.id == message_id)
    )
    return result.one()


async def _suppression(db: AsyncSession, address: str) -> SuppressionReason | None:
    result = await db.execute(
        select(EmailSuppression.reason).where(EmailSuppression.address_normalized == address)
    )
    return result.scalar_one_or_none()


async def test_webhook_validDelivered_movesSentToDelivered(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    message = await _seed_message(db_session, provider_message_id="abc@mg.example")

    response = await client.post(
        _URL, json=_payload("delivered", provider_message_id="<abc@mg.example>")
    )

    assert response.status_code == 200
    assert response.json() == {}
    row = await _row(db_session, message.id)
    assert row.status == EmailStatus.DELIVERED
    assert row.delivered_at is not None
    assert row.event_at is not None


@pytest.mark.parametrize("case", ["bad_signature", "stale", "replay", "not_configured"])
async def test_webhook_rejectedRequest_returns401WithoutDetail(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    case: str,
) -> None:
    message = await _seed_message(db_session)
    signature = _signature()
    if case == "bad_signature":
        signature = _signature(key="another-dummy-key")
    elif case == "stale":
        signature = _signature(timestamp=int(time.time()) - 6 * 60)
    elif case == "replay":
        first = await client.post(_URL, json=_payload("opened", signature=signature))
        assert first.status_code == 200
    else:
        monkeypatch.setattr(settings, "email_webhook_signing_key", None)

    response = await client.post(
        _URL, json=_payload("delivered", message=message, signature=signature)
    )

    assert response.status_code == 401
    assert response.content == b""
    assert (await _row(db_session, message.id)).status == EmailStatus.SENT


async def test_webhook_outOfOrderEvents_neverLowerStatus(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    message = await _seed_message(db_session)

    complained = await client.post(_URL, json=_payload("complained", message=message))
    delivered = await client.post(_URL, json=_payload("delivered", message=message))
    bounced = await client.post(
        _URL, json=_payload("failed", message=message, severity="permanent")
    )

    assert [complained.status_code, delivered.status_code, bounced.status_code] == [200] * 3
    assert (await _row(db_session, message.id)).status == EmailStatus.COMPLAINED


async def test_webhook_bounceThenComplaint_suppressesAndDisablesCategory(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    message = await _seed_message(db_session)
    address = "someone@example.com"

    temporary = await client.post(
        _URL, json=_payload("failed", message=message, severity="temporary")
    )
    assert temporary.status_code == 200
    assert (await _row(db_session, message.id)).status == EmailStatus.SENT
    assert await _suppression(db_session, address) is None

    bounced = await client.post(
        _URL, json=_payload("failed", message=message, severity="permanent")
    )
    assert bounced.status_code == 200
    assert (await _row(db_session, message.id)).status == EmailStatus.BOUNCED
    assert await _suppression(db_session, address) == SuppressionReason.BOUNCE

    complained = await client.post(_URL, json=_payload("complained", message=message))
    assert complained.status_code == 200
    assert (await _row(db_session, message.id)).status == EmailStatus.COMPLAINED
    assert await _suppression(db_session, address) == SuppressionReason.COMPLAINT
    enabled = (
        await db_session.execute(
            select(EmailPreference.enabled).where(
                EmailPreference.party_id == message.party_id,
                EmailPreference.category == EmailCategory.RESERVATIONS,
            )
        )
    ).scalar_one()
    assert enabled is False


async def test_webhook_unknownOrMalformed_returns200OrBadRequest(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    message = await _seed_message(db_session, provider_message_id="known@mg.example")

    unknown = await client.post(
        _URL,
        json=_payload("failed", provider_message_id="<nobody@mg.example>", severity="permanent"),
    )
    malformed_id = await client.post(
        _URL,
        json=_payload("delivered", email_message_id="not-a-uuid", provider_message_id="<x@mg>"),
    )
    unparseable = await client.post(
        _URL, content=b"{not json", headers={"Content-Type": "application/json"}
    )
    oversized = _payload("delivered", message=message)
    oversized["padding"] = "x" * webhooks.MAX_BODY_BYTES
    too_large = await client.post(_URL, json=oversized)

    assert (unknown.status_code, unknown.json()) == (200, {})
    assert (malformed_id.status_code, malformed_id.json()) == (200, {})
    assert unparseable.status_code == 400
    assert too_large.status_code == 400
    assert (await _row(db_session, message.id)).status == EmailStatus.SENT
    assert await _suppression(db_session, "someone@example.com") is None


@pytest.mark.parametrize("status", [EmailStatus.PENDING, EmailStatus.FAILED])
async def test_webhook_pendingOrFailedRow_isRaisedAndTokenRemoved(
    client: AsyncClient, db_session: AsyncSession, status: EmailStatus
) -> None:
    message = await _seed_message(
        db_session,
        status=status,
        stream=EmailStream.TRANSACTIONAL,
        payload={"token": "raw-token", "google_only": False},
    )

    response = await client.post(_URL, json=_payload("delivered", message=message))

    assert response.status_code == 200
    row = await _row(db_session, message.id)
    assert row.status == EmailStatus.DELIVERED
    assert row.payload == {"google_only": False}


async def test_webhook_skippedRow_keepsStatusButSuppresses(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    message = await _seed_message(db_session, status=EmailStatus.SKIPPED)

    response = await client.post(
        _URL,
        json=_payload("failed", message=message, severity="permanent", recipient="skip@ex.pl"),
    )

    assert response.status_code == 200
    assert (await _row(db_session, message.id)).status == EmailStatus.SKIPPED
    assert await _suppression(db_session, "skip@ex.pl") == SuppressionReason.BOUNCE


async def test_webhook_processingFailure_returns503AndRetryIsAccepted(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    message = await _seed_message(db_session)
    payload = _payload("delivered", message=message)
    real_apply = webhooks._apply_event

    async def _failing(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("forced failure")

    monkeypatch.setattr(webhooks, "_apply_event", _failing)
    failed = await client.post(_URL, json=payload)
    assert failed.status_code == 503
    assert failed.content == b""
    assert (await _row(db_session, message.id)).status == EmailStatus.SENT

    monkeypatch.setattr(webhooks, "_apply_event", real_apply)
    retried = await client.post(_URL, json=payload)
    assert retried.status_code == 200
    assert (await _row(db_session, message.id)).status == EmailStatus.DELIVERED
