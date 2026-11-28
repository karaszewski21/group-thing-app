"""The sender port and its three adapters (Mailgun HTTP API, plain SMTP for
Mailpit, and a log-only sender).

A failure is either permanent (the mail will never go: `PermanentSendError`)
or retryable (`RetryableSendError`); `code` is a short value safe to store in
`last_error`. Never log or raise with the API key, an address, a subject or a
body.
"""

from __future__ import annotations

import asyncio
import email.policy
import logging
import smtplib
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from typing import Protocol

import httpx

from app.config import Settings, settings
from app.email.rules import SEND_TIMEOUT

logger = logging.getLogger(__name__)

_MAILGUN_TIMEOUT = httpx.Timeout(SEND_TIMEOUT, connect=5.0)
# A bad or rotated key (401/403) or an unknown domain (404) is a setup fault,
# not the mail's: those mails back off and go once the setting is fixed.
_CREDENTIAL_STATUSES = frozenset({401, 403, 404})
CREDENTIAL_ERROR_CODES = frozenset(f"http_{status}" for status in _CREDENTIAL_STATUSES)
_RETRYABLE_CLIENT_STATUSES = _CREDENTIAL_STATUSES | {429}
_SMTP_POLICY = email.policy.SMTP.clone(max_line_length=998)


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    text: str
    html: str
    headers: Mapping[str, str]
    tag: str
    email_message_id: uuid.UUID


@dataclass(frozen=True)
class SendResult:
    provider_message_id: str | None


class SendError(Exception):
    def __init__(self, code: str) -> None:
        self.code = code
        super().__init__(code)


class PermanentSendError(SendError):
    """The provider refused the mail for good; it is never retried."""


class RetryableSendError(SendError):
    """A transient failure; the job retries with backoff."""


class EmailSender(Protocol):
    async def send(self, message: OutgoingEmail) -> SendResult: ...


def _from_header() -> str:
    return formataddr((settings.email_from_name, settings.email_from_address or ""))


def _from_domain() -> str:
    return (settings.email_from_address or "").rpartition("@")[2]


def build_headers(*, unsubscribe_token: str | None = None) -> dict[str, str]:
    """Headers of every mail; with `unsubscribe_token` also the one-click
    unsubscribe headers that only NOTIFICATION mail carries."""
    headers = {"Auto-Submitted": "auto-generated"}
    if settings.email_reply_to_address:
        headers["Reply-To"] = settings.email_reply_to_address
    if unsubscribe_token is not None:
        base_url = (settings.app_public_base_url or "").rstrip("/")
        headers["List-Unsubscribe"] = f"<{base_url}/api/email/unsubscribe/{unsubscribe_token}>"
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
        headers["List-Id"] = f"<notifications.{_from_domain()}>"
    return headers


class MailgunSender:
    def __init__(
        self, api_url: str, api_key: str, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self._url = f"{api_url.rstrip('/')}/messages"
        self._api_key = api_key
        self._transport = transport

    async def send(self, message: OutgoingEmail) -> SendResult:
        data = {
            "from": _from_header(),
            "to": message.to,
            "subject": message.subject,
            "text": message.text,
            "html": message.html,
            "o:tag": message.tag,
            "o:tracking": "no",
            "v:email_message_id": str(message.email_message_id),
            **{f"h:{name}": value for name, value in message.headers.items()},
        }
        try:
            async with httpx.AsyncClient(
                timeout=_MAILGUN_TIMEOUT, transport=self._transport, auth=("api", self._api_key)
            ) as client:
                response = await client.post(self._url, data=data)
        except httpx.TimeoutException:
            raise RetryableSendError("timeout") from None
        except httpx.HTTPError:
            raise RetryableSendError("transport") from None
        status = response.status_code
        if 200 <= status < 300:
            return SendResult(provider_message_id=_mailgun_id(response))
        code = f"http_{status}"
        if 400 <= status < 500 and status not in _RETRYABLE_CLIENT_STATUSES:
            raise PermanentSendError(code)
        raise RetryableSendError(code)


def _mailgun_id(response: httpx.Response) -> str | None:
    try:
        body = response.json()
    except ValueError:
        return None
    raw = body.get("id") if isinstance(body, dict) else None
    return raw.strip("<>") if isinstance(raw, str) and raw.strip("<>") else None


class SmtpSender:
    """Plain SMTP without auth or TLS, for the local Mailpit only."""

    def __init__(self, host: str, port: int) -> None:
        self._host = host
        self._port = port

    async def send(self, message: OutgoingEmail) -> SendResult:
        message_id = make_msgid(domain=_from_domain() or None)
        # The default policy folds a long space-free header (List-Unsubscribe)
        # into RFC 2047 encoded-words, which mail clients cannot parse.
        mime = EmailMessage(policy=_SMTP_POLICY)
        mime["From"] = _from_header()
        mime["To"] = message.to
        mime["Subject"] = message.subject
        mime["Message-ID"] = message_id
        for name, value in message.headers.items():
            mime[name] = value
        mime.set_content(message.text)
        mime.add_alternative(message.html, subtype="html")
        try:
            await asyncio.to_thread(self._deliver, mime)
        except smtplib.SMTPRecipientsRefused:
            raise PermanentSendError("smtp_refused") from None
        except TimeoutError:
            raise RetryableSendError("timeout") from None
        except (smtplib.SMTPException, OSError):
            raise RetryableSendError("transport") from None
        return SendResult(provider_message_id=message_id.strip("<>"))

    def _deliver(self, mime: EmailMessage) -> None:
        with smtplib.SMTP(self._host, self._port, timeout=SEND_TIMEOUT) as smtp:
            smtp.send_message(mime)


class LogSender:
    """Sends nothing; logs only the message id and the template."""

    async def send(self, message: OutgoingEmail) -> SendResult:
        logger.info(
            "email (log backend): message=%s template=%s", message.email_message_id, message.tag
        )
        return SendResult(provider_message_id=f"log-{uuid.uuid4()}")


_sender: EmailSender | None = None


def set_sender(sender: EmailSender | None) -> None:
    global _sender
    _sender = sender


def get_sender() -> EmailSender:
    if _sender is None:
        raise RuntimeError("no email sender is set")
    return _sender


def build_sender(config: Settings) -> EmailSender:
    """The sender for `EMAIL_BACKEND`; `email_configuration_errors` has
    already checked the variables it needs."""
    if config.email_backend == "mailgun":
        return MailgunSender(
            config.email_provider_api_url or "", config.email_provider_api_key or ""
        )
    if config.email_backend == "smtp":
        return SmtpSender(config.email_smtp_host or "", config.email_smtp_port)
    return LogSender()
