"""The send job: one run claims a batch of queued mails, binds each to its
recipient at send time, skips what must not go, sends the rest with no
transaction open and writes every outcome in one statement.

The statement count per run is constant: recover, expire, claim, four
binding reads, one skip write and one result write. Every outcome applies
only while the row is still `SENDING`, so a status a webhook raised during
the send is never lowered and the row is never re-sent. Addresses, tokens,
subjects and bodies never reach a log line or `last_error`.
"""

from __future__ import annotations

import asyncio
import dataclasses
import logging
import typing
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    ColumnElement,
    DateTime,
    Integer,
    String,
    Table,
    case,
    cast,
    column,
    func,
    literal,
    select,
    update,
    values,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import clock
from app.email.infrastructure import users_acl
from app.email.links import sign_unsubscribe
from app.email.models import (
    EmailCategory,
    EmailMessage,
    EmailPreference,
    EmailSkipReason,
    EmailStatus,
    EmailStream,
    EmailSuppression,
    EmailTemplate,
)
from app.email.rendering import render
from app.email.rules import (
    BATCH_SIZE,
    MAX_ATTEMPTS,
    SEND_TIMEOUT,
    STUCK_SENDING_AFTER,
    category_enabled,
    is_quiet,
    next_send_after,
    normalize_address,
)
from app.email.senders import (
    CREDENTIAL_ERROR_CODES,
    EmailSender,
    OutgoingEmail,
    PermanentSendError,
    RetryableSendError,
    build_headers,
    get_sender,
)

__all__ = ["SendRunResult", "request_stop", "allow_sends", "run_send_batch"]

logger = logging.getLogger(__name__)

_messages = typing.cast(Table, EmailMessage.__table__)
_ERROR_MAX_LENGTH = 200
_stopping = False


def request_stop() -> None:
    """Shutdown: a running batch stops before its next send and puts the
    rows it has not attempted back in the queue; no new batch claims."""
    global _stopping
    _stopping = True


def allow_sends() -> None:
    global _stopping
    _stopping = False


@dataclass(frozen=True)
class SendRunResult:
    claimed: int = 0
    sent: int = 0
    skipped: int = 0
    retried: int = 0
    failed: int = 0
    expired: int = 0
    recovered: int = 0
    requeued: int = 0


@dataclass(frozen=True)
class _Claimed:
    id: uuid.UUID
    party_id: uuid.UUID
    stream: EmailStream
    category: EmailCategory | None
    template: EmailTemplate
    notification_kind: str | None
    payload: dict[str, Any]
    attempts: int
    send_after: datetime


@dataclass(frozen=True)
class _Outcome:
    """`status` is the status to write while the row is still SENDING."""

    id: uuid.UUID
    status: EmailStatus
    attempts: int
    send_after: datetime
    last_error: str | None
    sent_at: datetime | None
    provider_message_id: str | None
    remove_token: bool
    retries_exhausted: bool = False


def _without_token() -> ColumnElement[Any]:
    return _messages.c.payload.op("-", return_type=postgresql.JSONB)(literal("token", String))


async def run_send_batch(db: AsyncSession) -> SendRunResult:
    """One run of the job. It commits on `db` itself: after the claim, after
    the skip write (so no transaction is open while sending) and after the
    result write."""
    if _stopping:
        return SendRunResult()
    sender = get_sender()
    local_now = clock.local_now()
    now = clock.local_to_utc(local_now)

    recovered = await _recover_stuck(db, now)
    expired = await _expire(db, now)
    transactional_only = is_quiet(local_now) or not settings.email_notifications_enabled
    claimed = await _claim(db, now, transactional_only=transactional_only)
    await db.commit()
    if not claimed:
        return _log_run(SendRunResult(expired=expired, recovered=recovered))

    to_send, skips = await _bind(db, claimed, local_now)
    if skips:
        await _write_skips(db, skips, now)
    await db.commit()

    outcomes: list[_Outcome] = []
    unattempted: list[uuid.UUID] = []
    for index, (row, address, name) in enumerate(to_send):
        if _stopping:
            unattempted = [pending.id for pending, _, _ in to_send[index:]]
            break
        outcomes.append(await _send_one(sender, row, address, name, now))
    statuses = await _write_outcomes(db, outcomes, now) if outcomes else {}
    if unattempted:
        await _requeue(db, unattempted, now)
    await db.commit()

    _log_credential_error(outcomes)
    sent = retried = failed = 0
    for outcome in outcomes:
        if outcome.sent_at is not None:
            sent += 1
            continue
        current = statuses.get(outcome.id)
        if current == EmailStatus.PENDING:
            retried += 1
        elif current == EmailStatus.FAILED:
            failed += 1
            _log_failure(outcome)
    return _log_run(
        SendRunResult(
            claimed=len(claimed),
            sent=sent,
            skipped=len(skips),
            retried=retried,
            failed=failed,
            expired=expired,
            recovered=recovered,
            requeued=len(unattempted),
        )
    )


async def _requeue(db: AsyncSession, message_ids: Sequence[uuid.UUID], now: datetime) -> None:
    """Claimed rows a stopped run never attempted go back to PENDING as
    they were: attempts and `send_after` unchanged."""
    await db.execute(
        update(_messages)
        .where(_messages.c.id.in_(message_ids), _messages.c.status == EmailStatus.SENDING)
        .values(status=EmailStatus.PENDING, claimed_at=None, updated_at=now)
    )


async def _recover_stuck(db: AsyncSession, now: datetime) -> int:
    """NOTIFICATION rows go back to the queue; TRANSACTIONAL rows fail, since
    a crashed send may already have reached the provider."""
    notification = _messages.c.stream == EmailStream.NOTIFICATION
    result = await db.execute(
        update(_messages)
        .where(
            _messages.c.status == EmailStatus.SENDING,
            _messages.c.claimed_at < now - STUCK_SENDING_AFTER,
        )
        .values(
            status=case((notification, EmailStatus.PENDING.value), else_=EmailStatus.FAILED.value),
            send_after=case((notification, now), else_=_messages.c.send_after),
            last_error=case((notification, _messages.c.last_error), else_="stuck_sending"),
            payload=case((notification, _messages.c.payload), else_=_without_token()),
            updated_at=now,
        )
        .returning(_messages.c.id, _messages.c.stream)
    )
    rows = result.all()
    for row in rows:
        if row.stream == EmailStream.TRANSACTIONAL:
            logger.error("email message %s FAILED: stuck_sending", row.id)
    return len(rows)


async def _expire(db: AsyncSession, now: datetime) -> int:
    result = await db.execute(
        update(_messages)
        .where(_messages.c.status == EmailStatus.PENDING, _messages.c.expires_at <= now)
        .values(
            status=EmailStatus.SKIPPED,
            skip_reason=EmailSkipReason.EXPIRED,
            payload=_without_token(),
            updated_at=now,
        )
        .returning(_messages.c.id)
    )
    return len(result.all())


async def _claim(db: AsyncSession, now: datetime, *, transactional_only: bool) -> list[_Claimed]:
    due = select(_messages.c.id).where(
        _messages.c.status == EmailStatus.PENDING, _messages.c.send_after <= now
    )
    if transactional_only:
        due = due.where(_messages.c.stream == EmailStream.TRANSACTIONAL)
    due = due.order_by(_messages.c.send_after).limit(BATCH_SIZE).with_for_update(skip_locked=True)
    result = await db.execute(
        update(_messages)
        .where(_messages.c.id.in_(due.scalar_subquery()))
        .values(status=EmailStatus.SENDING, claimed_at=now, updated_at=now)
        .returning(
            _messages.c.id,
            _messages.c.party_id,
            _messages.c.stream,
            _messages.c.category,
            _messages.c.template,
            _messages.c.notification_kind,
            _messages.c.payload,
            _messages.c.attempts,
            _messages.c.send_after,
        )
    )
    claimed = [_Claimed(**row._mapping) for row in result]
    claimed.sort(key=lambda row: row.send_after)
    return claimed


async def _bind(
    db: AsyncSession, claimed: Sequence[_Claimed], local_now: datetime
) -> tuple[list[tuple[_Claimed, str, str | None]], list[tuple[uuid.UUID, EmailSkipReason]]]:
    """Late binding: the recipient, suppressions, preferences and the
    sent-today count are read now, not at enqueue. Returns the rows to send
    with their address and display name, and the skips."""
    recipients = await users_acl.get_recipients_by_party_ids(db, {row.party_id for row in claimed})
    notification_parties = {
        row.party_id for row in claimed if row.stream == EmailStream.NOTIFICATION
    }
    addresses = {
        normalize_address(recipient.email)
        for recipient in recipients.values()
        if recipient.email is not None and recipient.party_id in notification_parties
    }
    suppressed: set[str] = set()
    preferences: dict[uuid.UUID, dict[str, bool]] = {}
    sent_today = 0
    if notification_parties:
        suppressed = await _suppressed(db, addresses)
        preferences = await _preferences(db, notification_parties)
        sent_today = await _sent_since(db, clock.local_to_utc(_midnight(local_now)))

    cap = settings.email_daily_cap
    cap_warned = False
    to_send: list[tuple[_Claimed, str, str | None]] = []
    skips: list[tuple[uuid.UUID, EmailSkipReason]] = []
    for row in claimed:
        recipient = recipients.get(row.party_id)
        reason: EmailSkipReason | None
        if row.stream == EmailStream.TRANSACTIONAL:
            reason = None if recipient and recipient.email else EmailSkipReason.NO_ADDRESS
        elif recipient is not None and recipient.is_organization:
            reason = EmailSkipReason.ORGANIZATION
        elif recipient is None or recipient.email is None:
            reason = EmailSkipReason.NO_ADDRESS
        elif not recipient.email_verified:
            reason = EmailSkipReason.UNVERIFIED
        elif normalize_address(recipient.email) in suppressed:
            reason = EmailSkipReason.SUPPRESSED
        elif row.category is None or not category_enabled(
            preferences.get(row.party_id, {}), row.category
        ):
            reason = EmailSkipReason.CATEGORY_DISABLED
        elif sent_today + len(to_send) >= cap:
            reason = EmailSkipReason.DAILY_CAP
            if not cap_warned:
                logger.warning(
                    "email daily cap of %d reached; further notification mail is skipped "
                    "(daily_cap)",
                    cap,
                )
                cap_warned = True
        else:
            reason = None
        if reason is not None:
            skips.append((row.id, reason))
        else:
            assert recipient is not None and recipient.email is not None
            to_send.append((row, recipient.email, recipient.display_name))
    return to_send, skips


def _midnight(local_now: datetime) -> datetime:
    return local_now.replace(hour=0, minute=0, second=0, microsecond=0)


async def _suppressed(db: AsyncSession, addresses: set[str]) -> set[str]:
    if not addresses:
        return set()
    result = await db.execute(
        select(EmailSuppression.address_normalized).where(
            EmailSuppression.address_normalized.in_(addresses)
        )
    )
    return set(result.scalars())


async def _preferences(
    db: AsyncSession, party_ids: set[uuid.UUID]
) -> dict[uuid.UUID, dict[str, bool]]:
    result = await db.execute(
        select(EmailPreference.party_id, EmailPreference.category, EmailPreference.enabled).where(
            EmailPreference.party_id.in_(party_ids)
        )
    )
    preferences: dict[uuid.UUID, dict[str, bool]] = {}
    for row in result:
        preferences.setdefault(row.party_id, {})[row.category] = row.enabled
    return preferences


async def _sent_since(db: AsyncSession, since: datetime) -> int:
    count = await db.scalar(
        select(func.count()).select_from(_messages).where(_messages.c.sent_at >= since)
    )
    return int(count or 0)


async def _write_skips(
    db: AsyncSession, skips: Sequence[tuple[uuid.UUID, EmailSkipReason]], now: datetime
) -> None:
    skipped = values(
        column("id", postgresql.UUID(as_uuid=True)),
        column("reason", String(30)),
        name="skipped",
    ).data([(message_id, reason.value) for message_id, reason in skips])
    await db.execute(
        update(_messages)
        .where(_messages.c.id == skipped.c.id, _messages.c.status == EmailStatus.SENDING)
        .values(
            status=EmailStatus.SKIPPED,
            skip_reason=skipped.c.reason,
            payload=_without_token(),
            updated_at=now,
        )
    )


def _context(row: _Claimed, display_name: str | None) -> dict[str, Any]:
    payload = row.payload
    context: dict[str, Any] = {"display_name": display_name}
    if row.template is EmailTemplate.NOTIFICATION:
        if row.category is None:
            raise ValueError("a notification mail without a category")
        context |= {
            "kind": row.notification_kind,
            "message": payload["message"],
            "link_path": _app_path(payload.get("link_path")),
            "unsubscribe_token": sign_unsubscribe(row.party_id, row.category),
        }
    elif row.template is EmailTemplate.PASSWORD_RESET:
        context |= {"token": payload["token"], "google_only": bool(payload.get("google_only"))}
    elif row.template is EmailTemplate.PASSWORD_CHANGED:
        context["changed_at"] = payload["changed_at"]
    else:
        context["token"] = payload["token"]
    return context


def _app_path(link_path: Any) -> str:
    """A path on the app's own host; anything else (e.g. `@other.host/x`
    glued after the base URL) becomes `/`."""
    return link_path if isinstance(link_path, str) and link_path.startswith("/") else "/"


def _build(row: _Claimed, address: str, display_name: str | None) -> OutgoingEmail:
    context = _context(row, display_name)
    rendered = render(row.template, context)
    return OutgoingEmail(
        to=address,
        subject=rendered.subject,
        text=rendered.text,
        html=rendered.html,
        headers=build_headers(unsubscribe_token=context.get("unsubscribe_token")),
        tag=row.template.value,
        email_message_id=row.id,
    )


async def _send_one(
    sender: EmailSender, row: _Claimed, address: str, display_name: str | None, now: datetime
) -> _Outcome:
    attempts = row.attempts + 1
    try:
        message = _build(row, address, display_name)
    except Exception:
        return _failed(row, attempts, "render_error")
    try:
        result = await asyncio.wait_for(sender.send(message), SEND_TIMEOUT)
    except PermanentSendError as exc:
        return _failed(row, attempts, exc.code)
    except RetryableSendError as exc:
        return _retry(row, attempts, exc.code, now)
    except TimeoutError:
        return _retry(row, attempts, "timeout", now)
    except Exception as exc:
        logger.warning("email message %s: sender raised %s", row.id, type(exc).__name__)
        return _retry(row, attempts, "transport", now)
    return _Outcome(
        id=row.id,
        status=EmailStatus.SENT,
        attempts=attempts,
        send_after=row.send_after,
        last_error=None,
        sent_at=now,
        provider_message_id=result.provider_message_id,
        remove_token=True,
    )


def _failed(row: _Claimed, attempts: int, code: str) -> _Outcome:
    return _Outcome(
        id=row.id,
        status=EmailStatus.FAILED,
        attempts=attempts,
        send_after=row.send_after,
        last_error=code[:_ERROR_MAX_LENGTH],
        sent_at=None,
        provider_message_id=None,
        remove_token=True,
    )


def _retry(row: _Claimed, attempts: int, code: str, now: datetime) -> _Outcome:
    if attempts >= MAX_ATTEMPTS:
        return dataclasses.replace(_failed(row, attempts, code), retries_exhausted=True)
    return _Outcome(
        id=row.id,
        status=EmailStatus.PENDING,
        attempts=attempts,
        send_after=next_send_after(now, attempts),
        last_error=code[:_ERROR_MAX_LENGTH],
        sent_at=None,
        provider_message_id=None,
        remove_token=False,
    )


async def _write_outcomes(
    db: AsyncSession, outcomes: Sequence[_Outcome], now: datetime
) -> Mapping[uuid.UUID, str]:
    """Status, attempts, `send_after` and `last_error` change only while the
    row is still SENDING; `sent_at`/`provider_message_id` (first value wins)
    and the token removal apply whatever a webhook did meanwhile. Returns
    each row's status after the write."""
    result_rows = values(
        column("id", postgresql.UUID(as_uuid=True)),
        column("status", String(20)),
        column("attempts", Integer),
        column("send_after", DateTime()),
        column("last_error", String(_ERROR_MAX_LENGTH)),
        column("sent_at", DateTime()),
        column("provider_message_id", String(255)),
        column("remove_token", Boolean),
        name="outcomes",
    ).data(
        [
            (
                outcome.id,
                outcome.status.value,
                outcome.attempts,
                outcome.send_after,
                outcome.last_error,
                outcome.sent_at,
                outcome.provider_message_id,
                outcome.remove_token,
            )
            for outcome in outcomes
        ]
    )
    sending = _messages.c.status == EmailStatus.SENDING

    def while_sending(new: ColumnElement[Any], current: ColumnElement[Any]) -> ColumnElement[Any]:
        return case((sending, new), else_=current)

    result = await db.execute(
        update(_messages)
        .where(_messages.c.id == result_rows.c.id)
        .values(
            status=while_sending(result_rows.c.status, _messages.c.status),
            attempts=while_sending(result_rows.c.attempts, _messages.c.attempts),
            send_after=while_sending(result_rows.c.send_after, _messages.c.send_after),
            last_error=while_sending(result_rows.c.last_error, _messages.c.last_error),
            sent_at=func.coalesce(_messages.c.sent_at, cast(result_rows.c.sent_at, DateTime())),
            provider_message_id=func.coalesce(
                _messages.c.provider_message_id, result_rows.c.provider_message_id
            ),
            payload=case((result_rows.c.remove_token, _without_token()), else_=_messages.c.payload),
            updated_at=now,
        )
        .returning(_messages.c.id, _messages.c.status)
    )
    return {row.id: row.status for row in result}


def _log_credential_error(outcomes: Sequence[_Outcome]) -> None:
    """At most one ERROR per run when the provider refused the key or domain."""
    code = next((o.last_error for o in outcomes if o.last_error in CREDENTIAL_ERROR_CODES), None)
    if code is not None:
        logger.error(
            "email send: provider rejected credentials or domain (code=%s)"
            " — check EMAIL_PROVIDER_API_KEY / domain",
            code,
        )


def _log_failure(outcome: _Outcome) -> None:
    if outcome.retries_exhausted:
        logger.error(
            "email message %s FAILED after %d attempts: %s",
            outcome.id,
            outcome.attempts,
            outcome.last_error,
        )
    else:
        logger.error("email message %s FAILED: %s", outcome.id, outcome.last_error)


def _log_run(result: SendRunResult) -> SendRunResult:
    level = logging.INFO if any(vars(result).values()) else logging.DEBUG
    logger.log(
        level,
        "email send: claimed=%d sent=%d skipped=%d retried=%d failed=%d expired=%d recovered=%d"
        " requeued=%d",
        result.claimed,
        result.sent,
        result.skipped,
        result.retried,
        result.failed,
        result.expired,
        result.recovered,
        result.requeued,
    )
    return result
