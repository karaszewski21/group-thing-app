"""Unit tests for the Europe/Warsaw domain clock (`app.core.clock`).

Pure functions only: no database, no HTTP client.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta, tzinfo
from zoneinfo import ZoneInfoNotFoundError

import pytest

from app.core import clock


@pytest.mark.parametrize(
    ("naive_utc", "expected_local"),
    [
        (datetime(2026, 3, 29, 0, 59), datetime(2026, 3, 29, 1, 59)),
        (datetime(2026, 3, 29, 1, 0), datetime(2026, 3, 29, 3, 0)),
        (datetime(2026, 10, 25, 0, 59), datetime(2026, 10, 25, 2, 59)),
        (datetime(2026, 10, 25, 1, 0), datetime(2026, 10, 25, 2, 0)),
    ],
)
def test_utcToLocal_acrossDstTransitions_returnsWarsawWallClock(
    naive_utc: datetime, expected_local: datetime
) -> None:
    result = clock.utc_to_local(naive_utc)

    assert result == expected_local
    assert result.tzinfo is None


def test_localNow_hostClockSkewedByNaiveNow_derivesFromUtcInstant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fixed_utc = datetime(2026, 7, 1, 10, 0, tzinfo=UTC)

    class _FixedDatetime(datetime):
        @classmethod
        def now(cls, tz: tzinfo | None = None) -> datetime:  # type: ignore[override]
            if tz is None:
                return datetime(1999, 1, 1, 0, 0)
            return fixed_utc.astimezone(tz)

    monkeypatch.setattr(clock, "datetime", _FixedDatetime)

    assert clock.local_now() == datetime(2026, 7, 1, 12, 0)


@pytest.mark.parametrize(
    ("occurs_on", "day"),
    [
        (datetime(2026, 10, 12, 16, 30), "pon 12.10"),
        (datetime(2026, 10, 13, 16, 30), "wt 13.10"),
        (datetime(2026, 10, 14, 16, 30), "śr 14.10"),
        (datetime(2026, 10, 15, 16, 30), "czw 15.10"),
        (datetime(2026, 10, 16, 16, 30), "pt 16.10"),
        (datetime(2026, 10, 17, 16, 30), "sob 17.10"),
        (datetime(2026, 10, 18, 16, 30), "ndz 18.10"),
    ],
)
def test_formatTermDayAndWhen_everyWeekday_usesPolishAbbreviations(
    occurs_on: datetime, day: str
) -> None:
    assert clock.format_term_day(occurs_on) == day
    assert clock.format_term_when(occurs_on) == f"{day} o 16:30"


def test_formatTermWhen_singleDigitParts_zeroPadded() -> None:
    assert clock.format_term_when(datetime(2026, 4, 1, 9, 5)) == "śr 01.04 o 09:05"


def test_checkTimezone_zoneAvailable_logsOnlyZoneKeyAndAbbreviation(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.DEBUG, logger="app.core.clock"):
        clock.check_timezone()

    records = [r for r in caplog.records if r.name == "app.core.clock"]
    assert len(records) == 1
    assert records[0].levelno == logging.INFO
    assert records[0].getMessage() in ("Europe/Warsaw (CET)", "Europe/Warsaw (CEST)")


def test_checkTimezone_zoneMissing_raisesErrorMentioningTzdata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _missing(key: str) -> None:
        raise ZoneInfoNotFoundError(key)

    clock.warsaw_zone.cache_clear()
    monkeypatch.setattr(clock, "ZoneInfo", _missing)
    try:
        with pytest.raises(RuntimeError, match="tzdata"):
            clock.check_timezone()
    finally:
        clock.warsaw_zone.cache_clear()


def test_fitNotificationMessage_atOrUnderLimit_unchanged() -> None:
    message = "x" * 500

    assert clock.fit_notification_message(message) == message
    assert clock.fit_notification_message("krótko") == "krótko"


def test_fitNotificationMessage_overLimit_cutToLimitWithEllipsis() -> None:
    result = clock.fit_notification_message("y" * 555)

    assert len(result) == 500
    assert result.endswith("…")
    assert result[:499] == "y" * 499


def test_freezeLocalNow_fixture_patchesModuleAttributeSeenByCallSites(
    freeze_local_now: Callable[[datetime], None],
) -> None:
    frozen = datetime(2026, 10, 15, 16, 30)

    freeze_local_now(frozen)

    assert clock.local_now() == frozen
    assert clock.local_now() - timedelta(hours=2) == datetime(2026, 10, 15, 14, 30)
