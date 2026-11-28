"""The email send job (`app.email.sending.run_send_batch`): late binding and
skip reasons, the claim filters, retries, stuck-row recovery, the webhook race
(H-1), token removal, the statement budget and log privacy."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import insert, select, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.config import settings
from app.core import clock
from app.email import senders
from app.email import sending as email_sending
from app.email.models import EmailMessage, EmailPreference, EmailSuppression
from app.email.rules import MAX_ATTEMPTS
from app.email.senders import (
    OutgoingEmail,
    PermanentSendError,
    RetryableSendError,
    SendResult,
)
from app.email.sending import run_send_batch
from app.party.models import Party
from app.users.models import UserProfile
from tests.conftest import FakeEmailSender, count_queries

_NOON = datetime(2030, 3, 12, 12, 0)
_MESSAGES = EmailMessage.__table__
_TOKEN = "raw-token-value-must-not-leak"


@pytest.fixture(autouse=True)
def _email_on(
    monkeypatch: pytest.MonkeyPatch, freeze_local_now: Callable[[datetime], None]
) -> None:
    monkeypatch.setattr(settings, "email_enabled", True)
    monkeypatch.setattr(settings, "email_notifications_enabled", True)
    monkeypatch.setattr(settings, "email_link_signing_secret", "test-link-secret")
    monkeypatch.setattr(settings, "app_public_base_url", "https://gooo.test")
    monkeypatch.setattr(settings, "email_daily_cap", 100)
    freeze_local_now(_NOON)


def _now() -> datetime:
    return clock.local_to_utc(clock.local_now())


async def _party(db: AsyncSession, *, organization: bool = False) -> uuid.UUID:
    party_id = uuid.uuid4()
    now = datetime.utcnow()
    await db.execute(
        insert(Party.__table__).values(
            id=party_id,
            party_type="ORGANIZATION" if organization else "PERSON",
            active=True,
            created_at=now,
            updated_at=now,
        )
    )
    return party_id


async def _person(
    db: AsyncSession,
    *,
    email: str | None = "",
    verified: bool = True,
    display_name: str = "Anna Nowak",
) -> tuple[uuid.UUID, str | None]:
    party_id = await _party(db)
    address = f"anna-{party_id.hex[:10]}@example.com" if email == "" else email
    now = datetime.utcnow()
    await db.execute(
        insert(UserProfile.__table__).values(
            id=uuid.uuid4(),
            party_id=party_id,
            display_name=display_name,
            email=address,
            email_verified_at=now if verified else None,
            created_at=now,
            updated_at=now,
        )
    )
    return party_id, address


async def _message(
    db: AsyncSession,
    party_id: uuid.UUID,
    *,
    stream: str = "NOTIFICATION",
    status: str = "PENDING",
    attempts: int = 0,
    send_after: datetime | None = None,
    expires_at: datetime | None = None,
    claimed_at: datetime | None = None,
    sent_at: datetime | None = None,
    payload: dict[str, Any] | None = None,
    kind: str = "SWAP_PROPOSED",
    category: str = "RESERVATIONS",
) -> uuid.UUID:
    now = _now()
    message_id = uuid.uuid4()
    notification = stream == "NOTIFICATION"
    if payload is None:
        payload = (
            {"message": "Ktoś proponuje wymianę za Rower", "link_path": "/swaps/1"}
            if notification
            else {"token": _TOKEN}
        )
    await db.execute(
        insert(_MESSAGES).values(
            id=message_id,
            idempotency_key=f"test:{message_id}",
            party_id=party_id,
            stream=stream,
            category=category if notification else None,
            template="notification" if notification else "verify_email",
            notification_id=uuid.uuid4() if notification else None,
            notification_kind=kind if notification else None,
            payload=payload,
            status=status,
            attempts=attempts,
            send_after=send_after or now - timedelta(minutes=1),
            expires_at=expires_at or now + timedelta(hours=1),
            claimed_at=claimed_at,
            sent_at=sent_at,
            created_at=now,
            updated_at=now,
        )
    )
    return message_id


async def _row(db: AsyncSession, message_id: uuid.UUID) -> Any:
    return (await db.execute(select(_MESSAGES).where(_MESSAGES.c.id == message_id))).one()


@pytest.mark.parametrize(
    ("reason", "stream"),
    [
        ("organization", "NOTIFICATION"),
        ("no_address", "NOTIFICATION"),
        ("no_address", "TRANSACTIONAL"),
        ("unverified", "NOTIFICATION"),
        ("suppressed", "NOTIFICATION"),
        ("category_disabled", "NOTIFICATION"),
        ("daily_cap", "NOTIFICATION"),
        ("expired", "TRANSACTIONAL"),
    ],
)
async def test_runSendBatch_eachSkipReason_skippedWithoutTokenAndNotSent(
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    reason: str,
    stream: str,
) -> None:
    now = _now()
    expires_at = None
    if reason == "organization":
        party_id = await _party(db_session, organization=True)
    elif reason == "no_address":
        party_id, _ = await _person(db_session, email=None)
    elif reason == "unverified":
        party_id, _ = await _person(db_session, verified=False)
    else:
        party_id, address = await _person(db_session)
    if reason == "suppressed":
        await db_session.execute(
            insert(EmailSuppression.__table__).values(
                id=uuid.uuid4(),
                address_normalized=address,
                reason="BOUNCE",
                created_at=now,
                updated_at=now,
            )
        )
    if reason == "category_disabled":
        await db_session.execute(
            insert(EmailPreference.__table__).values(
                id=uuid.uuid4(),
                party_id=party_id,
                category="ALL",
                enabled=False,
                created_at=now,
                updated_at=now,
            )
        )
    if reason == "daily_cap":
        monkeypatch.setattr(settings, "email_daily_cap", 1)
        other, _ = await _person(db_session)
        await _message(db_session, other, status="SENT", sent_at=now - timedelta(hours=2))
    if reason == "expired":
        expires_at = now - timedelta(seconds=1)
    payload = {"message": "m", "link_path": None, "token": _TOKEN}
    message_id = await _message(
        db_session, party_id, stream=stream, expires_at=expires_at, payload=payload
    )

    with caplog.at_level(logging.WARNING, logger="app.email.sending"):
        result = await run_send_batch(db_session)

    row = await _row(db_session, message_id)
    assert (row.status, row.skip_reason) == ("SKIPPED", reason)
    assert "token" not in row.payload
    assert fake_email_sender.sent == []
    if reason == "expired":
        assert (result.expired, result.claimed) == (1, 0)
    else:
        assert (result.skipped, result.claimed) == (1, 1)
    cap_warnings = [r for r in caplog.records if "daily cap" in r.getMessage()]
    assert len(cap_warnings) == (1 if reason == "daily_cap" else 0)


@pytest.mark.parametrize("scenario", ["quiet_hours", "notifications_off"])
async def test_runSendBatch_quietHoursOrNotificationsOff_claimsOnlyTransactional(
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
    freeze_local_now: Callable[[datetime], None],
    scenario: str,
) -> None:
    if scenario == "quiet_hours":
        freeze_local_now(datetime(2030, 3, 12, 23, 30))
    else:
        monkeypatch.setattr(settings, "email_notifications_enabled", False)
    party_id, address = await _person(db_session)
    notification_id = await _message(db_session, party_id)
    transactional_id = await _message(db_session, party_id, stream="TRANSACTIONAL")

    result = await run_send_batch(db_session)

    assert (await _row(db_session, notification_id)).status == "PENDING"
    transactional = await _row(db_session, transactional_id)
    assert transactional.status == "SENT"
    assert transactional.sent_at == _now()
    assert transactional.provider_message_id == "fake-1"
    assert "token" not in transactional.payload
    assert [m.to for m in fake_email_sender.sent] == [address]
    assert (result.claimed, result.sent) == (1, 1)


async def test_runSendBatch_retryableError_backsOffThenFailsAtMaxAttempts(
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    caplog: pytest.LogCaptureFixture,
) -> None:
    party_id, _ = await _person(db_session)
    message_id = await _message(db_session, party_id, stream="TRANSACTIONAL")
    fake_email_sender.error = RetryableSendError("http_503")

    first = await run_send_batch(db_session)

    row = await _row(db_session, message_id)
    assert (row.status, row.attempts, row.last_error) == ("PENDING", 1, "http_503")
    assert row.send_after == _now() + timedelta(minutes=1)
    assert row.payload == {"token": _TOKEN}
    assert first.retried == 1

    await db_session.execute(
        update(_MESSAGES)
        .where(_MESSAGES.c.id == message_id)
        .values(attempts=MAX_ATTEMPTS - 1, send_after=_now() - timedelta(minutes=1))
    )
    with caplog.at_level(logging.ERROR, logger="app.email.sending"):
        last = await run_send_batch(db_session)

    row = await _row(db_session, message_id)
    assert (row.status, row.attempts, row.last_error) == ("FAILED", MAX_ATTEMPTS, "http_503")
    assert "token" not in row.payload
    assert last.failed == 1
    assert f"email message {message_id} FAILED after {MAX_ATTEMPTS} attempts" in caplog.text


async def test_runSendBatch_stuckSending_notificationRequeuedTransactionalFailed(
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "email_notifications_enabled", False)
    party_id, _ = await _person(db_session)
    stuck_at = _now() - timedelta(minutes=11)
    notification_id = await _message(db_session, party_id, status="SENDING", claimed_at=stuck_at)
    transactional_id = await _message(
        db_session, party_id, stream="TRANSACTIONAL", status="SENDING", claimed_at=stuck_at
    )
    recent_id = await _message(
        db_session, party_id, status="SENDING", claimed_at=_now() - timedelta(minutes=2)
    )

    result = await run_send_batch(db_session)

    notification = await _row(db_session, notification_id)
    assert (notification.status, notification.send_after) == ("PENDING", _now())
    transactional = await _row(db_session, transactional_id)
    assert (transactional.status, transactional.last_error) == ("FAILED", "stuck_sending")
    assert "token" not in transactional.payload
    assert (await _row(db_session, recent_id)).status == "SENDING"
    assert result.recovered == 2
    assert fake_email_sender.sent == []


class _WebhookDuringSend:
    """Raises the row to DELIVERED while the send is in flight, as a webhook
    landing between the claim and the result write would."""

    def __init__(self, db: AsyncSession, outcome: str) -> None:
        self._db = db
        self._outcome = outcome

    async def send(self, message: OutgoingEmail) -> SendResult:
        await self._db.execute(
            update(_MESSAGES)
            .where(_MESSAGES.c.id == message.email_message_id)
            .values(status="DELIVERED", delivered_at=_now())
        )
        if self._outcome == "retryable":
            raise RetryableSendError("http_503")
        if self._outcome == "permanent":
            raise PermanentSendError("http_400")
        return SendResult(provider_message_id="provider-1")


@pytest.mark.parametrize("outcome", ["sent", "retryable", "permanent"])
async def test_runSendBatch_webhookRaisedRowDuringSend_keepsDelivered(
    db_session: AsyncSession, outcome: str
) -> None:
    party_id, _ = await _person(db_session)
    message_id = await _message(db_session, party_id, stream="TRANSACTIONAL")
    senders.set_sender(_WebhookDuringSend(db_session, outcome))
    try:
        await run_send_batch(db_session)
    finally:
        senders.set_sender(None)

    row = await _row(db_session, message_id)
    assert (row.status, row.attempts, row.last_error) == ("DELIVERED", 0, None)
    if outcome == "sent":
        assert (row.sent_at, row.provider_message_id) == (_now(), "provider-1")
    else:
        assert row.sent_at is None
    assert ("token" in row.payload) is (outcome == "retryable")


@pytest.mark.parametrize("failure", ["provider", "render"])
async def test_runSendBatch_permanentFailure_failsWithCodeAndRemovesToken(
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    caplog: pytest.LogCaptureFixture,
    failure: str,
) -> None:
    party_id, _ = await _person(db_session)
    if failure == "provider":
        fake_email_sender.error = PermanentSendError("http_400")
        message_id = await _message(db_session, party_id, stream="TRANSACTIONAL")
        code = "http_400"
    else:
        message_id = await _message(
            db_session, party_id, payload={"message": "m", "link_path": None}, kind="NOT_MAILED"
        )
        code = "render_error"

    with caplog.at_level(logging.ERROR, logger="app.email.sending"):
        result = await run_send_batch(db_session)

    row = await _row(db_session, message_id)
    assert (row.status, row.last_error, row.attempts) == ("FAILED", code, 1)
    assert "token" not in row.payload
    assert result.failed == 1
    assert f"email message {message_id} FAILED: {code}" in caplog.text


async def test_runSendBatch_oneVersusTwentyRows_constantStatementCount(
    db_session: AsyncSession, engine: AsyncEngine, fake_email_sender: FakeEmailSender
) -> None:
    party_id, _ = await _person(db_session)
    await _message(db_session, party_id)
    with count_queries(engine) as single:
        await run_send_batch(db_session)

    for _ in range(20):
        other, _ = await _person(db_session)
        await _message(db_session, other)
    with count_queries(engine) as twenty:
        result = await run_send_batch(db_session)

    assert result.sent == 20
    assert len(fake_email_sender.sent) == 21
    assert len(twenty) == len(single)


async def test_runSendBatch_logsAndErrors_neverContainAddressTokenOrSubject(
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    caplog: pytest.LogCaptureFixture,
) -> None:
    party_id, address = await _person(db_session)
    await _message(db_session, party_id, stream="TRANSACTIONAL")
    notification_id = await _message(db_session, party_id)
    unverified, unverified_address = await _person(db_session, verified=False)
    await _message(db_session, unverified)

    with caplog.at_level(logging.DEBUG, logger="app.email"):
        result = await run_send_batch(db_session)

    assert (result.sent, result.skipped) == (2, 1)
    notification = next(m for m in fake_email_sender.sent if m.email_message_id == notification_id)
    assert notification.to == address
    assert "List-Unsubscribe" in notification.headers
    assert "email send: claimed=3 sent=2 skipped=1" in caplog.text
    assert address is not None and unverified_address is not None
    for secret in (address, unverified_address, _TOKEN, notification.subject, "test-link-secret"):
        assert secret not in caplog.text
    unsubscribe = notification.headers["List-Unsubscribe"].rsplit("/", 1)[1].rstrip(">")
    assert unsubscribe not in caplog.text


async def test_runSendBatch_providerRejectsCredentials_retriesAndLogsOneError(
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    caplog: pytest.LogCaptureFixture,
) -> None:
    message_ids = []
    for _ in range(3):
        party_id, _ = await _person(db_session)
        message_ids.append(await _message(db_session, party_id, stream="TRANSACTIONAL"))
    fake_email_sender.error = RetryableSendError("http_401")

    with caplog.at_level(logging.ERROR, logger="app.email.sending"):
        result = await run_send_batch(db_session)

    assert result.retried == 3
    for message_id in message_ids:
        row = await _row(db_session, message_id)
        assert (row.status, row.last_error) == ("PENDING", "http_401")
        assert row.payload == {"token": _TOKEN}
    errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert errors == [
        "email send: provider rejected credentials or domain (code=http_401)"
        " — check EMAIL_PROVIDER_API_KEY / domain"
    ]


@pytest.mark.parametrize(
    ("link_path", "expected"),
    [("/swaps/1", "https://gooo.test/swaps/1"), ("@evil.test/x", "https://gooo.test/")],
)
async def test_runSendBatch_notificationLinkPath_alwaysOnTheAppHost(
    db_session: AsyncSession, fake_email_sender: FakeEmailSender, link_path: str, expected: str
) -> None:
    party_id, _ = await _person(db_session)
    await _message(db_session, party_id, payload={"message": "m", "link_path": link_path})

    await run_send_batch(db_session)

    [message] = fake_email_sender.sent
    assert f'href="{expected}"' in message.html
    assert expected in message.text
    assert "evil" not in message.html


class _StoppingSender(FakeEmailSender):
    """Asks the job to stop once it has sent its first mail, as a shutdown would."""

    async def send(self, message: Any) -> Any:
        result = await super().send(message)
        email_sending.request_stop()
        return result


async def test_runSendBatch_stopRequestedMidBatch_keepsSentAndRequeuesTheRest(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(email_sending, "_stopping", False)
    sender = _StoppingSender()
    senders.set_sender(sender)
    try:
        message_ids = []
        for _ in range(3):
            party_id, _ = await _person(db_session)
            message_ids.append(await _message(db_session, party_id, stream="TRANSACTIONAL"))

        result = await run_send_batch(db_session)
        again = await run_send_batch(db_session)
    finally:
        senders.set_sender(None)

    assert (result.claimed, result.sent, result.requeued) == (3, 1, 2)
    rows = [await _row(db_session, message_id) for message_id in message_ids]
    sent = [row for row in rows if row.status == "SENT"]
    requeued = [row for row in rows if row.status == "PENDING"]
    assert len(sent) == 1 and sent[0].attempts == 1
    assert len(requeued) == 2
    for row in requeued:
        assert (row.attempts, row.claimed_at, row.last_error) == (0, None, None)
        assert row.payload == {"token": _TOKEN}
    assert again.claimed == 0
