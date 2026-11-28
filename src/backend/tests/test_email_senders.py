"""Email senders: headers per stream, the Mailgun form POST and its error
classification, and the SMTP refusal mapping. Only dummy credentials."""

from __future__ import annotations

import base64
import smtplib
import uuid
from typing import Any
from urllib.parse import parse_qsl

import httpx
import pytest

from app.config import settings
from app.email import senders
from app.email.senders import (
    MailgunSender,
    OutgoingEmail,
    PermanentSendError,
    RetryableSendError,
    SmtpSender,
)

_API_URL = "https://api.mailgun.example.test/v3/mail.example.test"
_DUMMY_KEY = "dummy-key"


@pytest.fixture
def email_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_public_base_url", "https://gooo.example.test")
    monkeypatch.setattr(settings, "email_from_address", "noreply@mail.example.test")
    monkeypatch.setattr(settings, "email_from_name", "Gooo")
    monkeypatch.setattr(settings, "email_reply_to_address", "help@example.test")


def _message(headers: dict[str, str] | None = None) -> OutgoingEmail:
    return OutgoingEmail(
        to="user@example.test",
        subject="Temat",
        text="tekst",
        html="<p>tekst</p>",
        headers=headers or {},
        tag="notification",
        email_message_id=uuid.uuid4(),
    )


def test_headers_listUnsubscribeOnlyOnNotification(
    email_settings: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    common = senders.build_headers()
    assert common == {"Auto-Submitted": "auto-generated", "Reply-To": "help@example.test"}

    notification = senders.build_headers(unsubscribe_token="1.WANTS.pid.sig")
    assert notification == {
        "Auto-Submitted": "auto-generated",
        "Reply-To": "help@example.test",
        "List-Unsubscribe": "<https://gooo.example.test/api/email/unsubscribe/1.WANTS.pid.sig>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "List-Id": "<notifications.mail.example.test>",
    }

    monkeypatch.setattr(settings, "email_reply_to_address", None)
    assert senders.build_headers() == {"Auto-Submitted": "auto-generated"}


def _respond(status: int, body: Any = None) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=body if body is not None else {})

    return handler


def _raise(exc: Exception) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        raise exc

    return handler


async def test_mailgun_send_postsFormWithBasicAuthAndTrackingOff(email_settings: None) -> None:
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"id": "<20261127.abc@mail.example.test>"})

    sender = MailgunSender(_API_URL, _DUMMY_KEY, transport=httpx.MockTransport(handler))
    message = _message({"Auto-Submitted": "auto-generated", "List-Id": "<n.example.test>"})

    result = await sender.send(message)

    assert result.provider_message_id == "20261127.abc@mail.example.test"
    (request,) = captured
    assert str(request.url) == f"{_API_URL}/messages"
    expected_auth = base64.b64encode(f"api:{_DUMMY_KEY}".encode()).decode()
    assert request.headers["authorization"] == f"Basic {expected_auth}"
    fields = dict(parse_qsl(request.content.decode()))
    assert fields == {
        "from": "Gooo <noreply@mail.example.test>",
        "to": "user@example.test",
        "subject": "Temat",
        "text": "tekst",
        "html": "<p>tekst</p>",
        "o:tag": "notification",
        "o:tracking": "no",
        "v:email_message_id": str(message.email_message_id),
        "h:Auto-Submitted": "auto-generated",
        "h:List-Id": "<n.example.test>",
    }


@pytest.mark.parametrize(
    ("handler", "error", "code"),
    [
        (_respond(400), PermanentSendError, "http_400"),
        (_respond(401), RetryableSendError, "http_401"),
        (_respond(403), RetryableSendError, "http_403"),
        (_respond(404), RetryableSendError, "http_404"),
        (_respond(422), PermanentSendError, "http_422"),
        (_respond(429), RetryableSendError, "http_429"),
        (_respond(500), RetryableSendError, "http_500"),
        (_respond(503), RetryableSendError, "http_503"),
        (_raise(httpx.ReadTimeout("slow")), RetryableSendError, "timeout"),
        (_raise(httpx.ConnectError("down")), RetryableSendError, "transport"),
    ],
)
async def test_mailgun_send_classifiesFailures(
    email_settings: None, handler: Any, error: type[Exception], code: str
) -> None:
    sender = MailgunSender(_API_URL, _DUMMY_KEY, transport=httpx.MockTransport(handler))

    with pytest.raises(error) as excinfo:
        await sender.send(_message())

    assert excinfo.value.code == code  # type: ignore[attr-defined]
    assert _DUMMY_KEY not in str(excinfo.value)


async def test_smtp_recipientsRefused_isPermanent(
    email_settings: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    class RefusingSmtp:
        def __init__(self, host: str, port: int, timeout: float) -> None:
            assert timeout == 10

        def __enter__(self) -> RefusingSmtp:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def send_message(self, message: Any) -> None:
            raise smtplib.SMTPRecipientsRefused({"user@example.test": (550, b"no such user")})

    monkeypatch.setattr(smtplib, "SMTP", RefusingSmtp)

    with pytest.raises(PermanentSendError) as excinfo:
        await SmtpSender("mailpit", 1025).send(_message())

    assert excinfo.value.code == "smtp_refused"


async def test_smtp_send_keepsLongListUnsubscribeOnOneUnencodedLine(
    email_settings: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    sent: list[bytes] = []

    class CapturingSmtp:
        def __init__(self, host: str, port: int, timeout: float) -> None:
            pass

        def __enter__(self) -> CapturingSmtp:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def send_message(self, message: Any) -> None:
            sent.append(message.as_bytes())

    monkeypatch.setattr(smtplib, "SMTP", CapturingSmtp)
    token = f"1.RESERVATIONS.{uuid.uuid4()}.{'s' * 43}"
    headers = senders.build_headers(unsubscribe_token=token)

    await SmtpSender("mailpit", 1025).send(_message(headers))

    (raw,) = sent
    expected = f"\nList-Unsubscribe: <https://gooo.example.test/api/email/unsubscribe/{token}>\r\n"
    assert expected.encode() in raw
