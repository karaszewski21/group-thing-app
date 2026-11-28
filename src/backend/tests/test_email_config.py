"""E-mail settings: blank placeholders, configuration errors, the lifespan checks, the
send job's error handling and graceful finish, token redaction in the access log and
Warsaw → UTC (no DB needed)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

import pytest
from sqlalchemy.exc import DBAPIError

from app.config import Settings
from app.core import clock
from app.core.access_log import TokenRedactingFilter, install_access_log_filter

_EMAIL_ENV_VARS = (
    "EMAIL_ENABLED",
    "EMAIL_NOTIFICATIONS_ENABLED",
    "EMAIL_BACKEND",
    "EMAIL_PROVIDER_API_URL",
    "EMAIL_PROVIDER_API_KEY",
    "EMAIL_FROM_ADDRESS",
    "EMAIL_FROM_NAME",
    "EMAIL_REPLY_TO_ADDRESS",
    "EMAIL_LINK_SIGNING_SECRET",
    "EMAIL_WEBHOOK_SIGNING_KEY",
    "EMAIL_DAILY_CAP",
    "EMAIL_SMTP_HOST",
    "EMAIL_SMTP_PORT",
    "APP_PUBLIC_BASE_URL",
)

_COMMON_VALID = {
    "EMAIL_ENABLED": "true",
    "EMAIL_FROM_ADDRESS": "mail@example.test",
    "EMAIL_LINK_SIGNING_SECRET": "x" * 32,
    "APP_PUBLIC_BASE_URL": "https://app.example.test",
}


def _settings(monkeypatch: pytest.MonkeyPatch, **env: str) -> Settings:
    """`Settings` built from a clean env plus `env`, ignoring any local `.env` file."""
    for name in _EMAIL_ENV_VARS:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("JWT_SECRET", "test-secret")
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@localhost/db")
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return Settings(_env_file=None)


def test_emailConfigurationErrors_disabled_isEmptyAndDefaultsApply(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(monkeypatch, EMAIL_BACKEND="mailgun")

    assert settings.email_enabled is False
    assert settings.email_notifications_enabled is False
    assert settings.email_from_name == "Gooo"
    assert settings.email_daily_cap == 100
    assert settings.email_smtp_port == 1025
    assert settings.email_configuration_errors == []


def test_emailConfigurationErrors_enabledWithNothingSet_listsCommonNames(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(monkeypatch, EMAIL_ENABLED="true")

    assert settings.email_backend == "log"
    assert settings.email_configuration_errors == [
        "EMAIL_FROM_ADDRESS",
        "EMAIL_LINK_SIGNING_SECRET",
        "APP_PUBLIC_BASE_URL",
    ]


@pytest.mark.parametrize(
    ("env", "expected"),
    [
        ({"EMAIL_BACKEND": "log"}, []),
        ({"EMAIL_BACKEND": "log", "APP_PUBLIC_BASE_URL": "http://localhost:5174"}, []),
        ({"EMAIL_BACKEND": "log", "APP_PUBLIC_BASE_URL": "http://localhost"}, []),
        ({"EMAIL_BACKEND": "log", "APP_PUBLIC_BASE_URL": "http://127.0.0.1:5173/"}, []),
        (
            {"EMAIL_BACKEND": "log", "APP_PUBLIC_BASE_URL": "http://localhost.evil.test"},
            ["APP_PUBLIC_BASE_URL"],
        ),
        (
            {"EMAIL_BACKEND": "log", "APP_PUBLIC_BASE_URL": "http://localhost:5174@evil.test"},
            ["APP_PUBLIC_BASE_URL"],
        ),
        (
            {"EMAIL_BACKEND": "log", "APP_PUBLIC_BASE_URL": "http://app.example.test"},
            ["APP_PUBLIC_BASE_URL"],
        ),
        (
            {"EMAIL_BACKEND": "log", "EMAIL_LINK_SIGNING_SECRET": "x" * 31},
            ["EMAIL_LINK_SIGNING_SECRET"],
        ),
        (
            {"EMAIL_BACKEND": "mailgun"},
            ["EMAIL_PROVIDER_API_URL", "EMAIL_PROVIDER_API_KEY", "EMAIL_WEBHOOK_SIGNING_KEY"],
        ),
        (
            {
                "EMAIL_BACKEND": "mailgun",
                "EMAIL_PROVIDER_API_URL": "http://api.example.test/v3/d",
                "EMAIL_PROVIDER_API_KEY": "dummy-key",
                "EMAIL_WEBHOOK_SIGNING_KEY": "dummy-webhook",
            },
            ["EMAIL_PROVIDER_API_URL"],
        ),
        (
            {
                "EMAIL_BACKEND": "mailgun",
                "EMAIL_PROVIDER_API_URL": "https://api.example.test/v3/d",
                "EMAIL_PROVIDER_API_KEY": "dummy-key",
                "EMAIL_WEBHOOK_SIGNING_KEY": "dummy-webhook",
            },
            [],
        ),
        ({"EMAIL_BACKEND": "smtp"}, ["EMAIL_SMTP_HOST"]),
        ({"EMAIL_BACKEND": "smtp", "EMAIL_SMTP_HOST": "mailpit"}, []),
    ],
)
def test_emailConfigurationErrors_perBackend_listsMissingOrInvalidNames(
    monkeypatch: pytest.MonkeyPatch, env: dict[str, str], expected: list[str]
) -> None:
    settings = _settings(monkeypatch, **{**_COMMON_VALID, **env})

    assert settings.email_configuration_errors == expected


def test_emailSettings_blankPlaceholders_readAsNoneOrDefault(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _settings(
        monkeypatch,
        **{name: "" for name in _EMAIL_ENV_VARS if name != "EMAIL_SMTP_HOST"},
        EMAIL_SMTP_HOST="   ",
    )

    assert settings.email_enabled is False
    assert settings.email_notifications_enabled is False
    assert settings.email_backend == "log"
    assert settings.email_from_name == "Gooo"
    assert settings.email_daily_cap == 100
    assert settings.email_smtp_port == 1025
    assert settings.email_from_address is None
    assert settings.email_smtp_host is None
    assert settings.app_public_base_url is None


@pytest.mark.parametrize(
    ("local", "utc"),
    [
        (datetime(2026, 1, 15, 0, 0), datetime(2026, 1, 14, 23, 0)),
        (datetime(2026, 7, 15, 0, 0), datetime(2026, 7, 14, 22, 0)),
    ],
)
def test_localToUtc_winterAndSummer_roundTrips(local: datetime, utc: datetime) -> None:
    assert clock.local_to_utc(local) == utc
    assert clock.utc_to_local(clock.local_to_utc(local)) == local


_DUMMY_SECRET = "dummy-signing-secret-" + "y" * 16


async def test_lifespan_incompleteEmailConfig_raisesNamingOnlyVariables(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main

    config = _settings(
        monkeypatch,
        EMAIL_ENABLED="true",
        EMAIL_BACKEND="mailgun",
        EMAIL_FROM_ADDRESS="mail@example.test",
        EMAIL_LINK_SIGNING_SECRET=_DUMMY_SECRET,
        EMAIL_PROVIDER_API_KEY="dummy-provider-key",
    )
    monkeypatch.setattr(main, "settings", config)

    with pytest.raises(RuntimeError) as raised:
        async with main.lifespan(main.app):
            pass

    message = str(raised.value)
    for name in ("APP_PUBLIC_BASE_URL", "EMAIL_PROVIDER_API_URL", "EMAIL_WEBHOOK_SIGNING_KEY"):
        assert name in message
    for value in ("mail@example.test", _DUMMY_SECRET, "dummy-provider-key"):
        assert value not in message


@pytest.mark.parametrize("backend", ["log", "smtp"])
def test_checkEmailSettings_enabledNonMailgun_warnsWithoutValues(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, backend: str
) -> None:
    from app import main

    config = _settings(
        monkeypatch,
        **{**_COMMON_VALID, "EMAIL_LINK_SIGNING_SECRET": _DUMMY_SECRET},
        EMAIL_BACKEND=backend,
        EMAIL_SMTP_HOST="mailpit",
    )
    monkeypatch.setattr(main, "settings", config)

    with caplog.at_level(logging.INFO, logger="app.main"):
        main._check_email_settings()

    messages = [record.getMessage() for record in caplog.records]
    assert "EMAIL_ENABLED=True EMAIL_NOTIFICATIONS_ENABLED=False EMAIL_BACKEND=" + backend in (
        messages
    )
    assert (
        f"EMAIL_BACKEND={backend} with EMAIL_ENABLED=true: mail is not delivered to real inboxes"
        in messages
    )
    logged = "\n".join(messages)
    for value in ("mail@example.test", _DUMMY_SECRET, "mailpit", "app.example.test"):
        assert value not in logged


def test_checkEmailSettings_mailgunOrDisabled_noWarning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from app import main

    monkeypatch.setattr(main, "settings", _settings(monkeypatch, EMAIL_BACKEND="log"))

    with caplog.at_level(logging.INFO, logger="app.main"):
        main._check_email_settings()

    assert [record.levelno for record in caplog.records] == [logging.INFO]


class _FakeSession:
    async def __aenter__(self) -> object:
        return object()

    async def __aexit__(self, *_exc: object) -> None:
        return None


class _Conflict(Exception):
    sqlstate = "40P01"


async def test_runEmailSend_lostRace_oneWarningOtherErrorLogged_neverRaises(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    from app import main

    errors: list[Exception] = [
        DBAPIError("UPDATE email_messages", None, _Conflict()),
        ValueError("boom"),
    ]

    async def failing_batch(_db: object) -> None:
        raise errors.pop(0)

    monkeypatch.setattr(main, "async_session_factory", _FakeSession)
    monkeypatch.setattr(main.email_sending, "run_send_batch", failing_batch)

    with caplog.at_level(logging.WARNING, logger="app.main"):
        await main._run_email_send()
        await main._run_email_send()

    assert [(r.levelno, r.exc_info is not None) for r in caplog.records] == [
        (logging.WARNING, False),
        (logging.ERROR, True),
    ]
    assert "40P01" in caplog.records[0].getMessage()


async def test_finishEmailSend_waitsForTheRunningBatchButNotPastTheTimeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main

    release = asyncio.Event()
    finished: list[bool] = []

    async def batch(_db: object) -> None:
        await release.wait()
        finished.append(True)

    monkeypatch.setattr(main, "async_session_factory", _FakeSession)
    monkeypatch.setattr(main.email_sending, "run_send_batch", batch)
    run = asyncio.create_task(main._run_email_send())
    await asyncio.sleep(0)

    await main._finish_email_send(0.01)
    assert not run.done() and not run.cancelled()

    asyncio.get_running_loop().call_later(0.01, release.set)
    await main._finish_email_send(5)
    assert run.done() and finished == [True]
    assert main._email_send_in_flight is None
    await main._finish_email_send(5)


def _access_record(path: str) -> logging.LogRecord:
    return logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("127.0.0.1:5000", "POST", path, "1.1", 200),
        None,
    )


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/email/unsubscribe/1.WANTS.abc.sig", "/api/email/unsubscribe/[redacted]"),
        ("/api/email/unsubscribe/1.WANTS.abc.sig?x=1", "/api/email/unsubscribe/[redacted]?x=1"),
        ("/reset-password?token=secret-1&a=b", "/reset-password?token=[redacted]&a=b"),
        ("/oauth2/authorize?a=b&_token=jwt.value", "/oauth2/authorize?a=b&_token=[redacted]"),
        ("/api/email/preferences", "/api/email/preferences"),
    ],
)
def test_accessLogFilter_redactsLinkTokensKeepsTheRecord(path: str, expected: str) -> None:
    record = _access_record(path)

    assert TokenRedactingFilter().filter(record) is True

    assert record.getMessage() == f'127.0.0.1:5000 - "POST {expected} HTTP/1.1" 200'


def test_installAccessLogFilter_onUvicornAccessOnce_redactsWhatIsLogged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    access = logging.getLogger("uvicorn.access")
    try:
        install_access_log_filter()
        install_access_log_filter()
        assert sum(isinstance(f, TokenRedactingFilter) for f in access.filters) == 1
        with caplog.at_level(logging.INFO, logger="uvicorn.access"):
            access.info('%s - "%s %s"', "c", "GET", "/api/email/unsubscribe/raw-token")
        assert "raw-token" not in caplog.text
        assert "/api/email/unsubscribe/[redacted]" in caplog.text
    finally:
        for existing in [f for f in access.filters if isinstance(f, TokenRedactingFilter)]:
            access.removeFilter(existing)
