"""Domain clock: the only definition of "now" for Term logic.

`Term.occurs_on` is a naive Europe/Warsaw wall clock, so every comparison
against it uses `local_now()`, which derives Warsaw time from the current
UTC instant and never reads the host `TZ`. Call sites use module attribute
access (`clock.local_now()`) so tests can freeze it in one place.
"""

from __future__ import annotations

import functools
import logging
from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

__all__ = [
    "check_timezone",
    "fit_notification_message",
    "format_term_day",
    "format_term_when",
    "local_now",
    "utc_to_local",
    "warsaw_zone",
]

logger = logging.getLogger(__name__)

_ZONE_KEY = "Europe/Warsaw"
_WEEKDAYS = ("pon", "wt", "śr", "czw", "pt", "sob", "ndz")


@functools.cache
def warsaw_zone() -> ZoneInfo:
    return ZoneInfo(_ZONE_KEY)


def utc_to_local(naive_utc: datetime) -> datetime:
    """Converts a naive UTC timestamp to the naive Warsaw wall clock."""
    return naive_utc.replace(tzinfo=UTC).astimezone(warsaw_zone()).replace(tzinfo=None)


def local_now() -> datetime:
    return utc_to_local(datetime.now(UTC).replace(tzinfo=None))


def check_timezone() -> None:
    """Fails startup when the zone database is missing (e.g. a slim image
    without `tzdata`) instead of failing later inside a request."""
    try:
        zone = warsaw_zone()
    except ZoneInfoNotFoundError as exc:
        raise RuntimeError(
            f"Time zone {_ZONE_KEY} cannot be loaded; install the tzdata package"
        ) from exc
    logger.info("%s (%s)", _ZONE_KEY, datetime.now(UTC).astimezone(zone).tzname())


def format_term_day(occurs_on: datetime) -> str:
    return f"{_WEEKDAYS[occurs_on.weekday()]} {occurs_on:%d.%m}"


def format_term_when(occurs_on: datetime) -> str:
    return f"{format_term_day(occurs_on)} o {occurs_on:%H:%M}"


def fit_notification_message(message: str, limit: int = 500) -> str:
    """Caps a message to the `Notification.message` column length."""
    if len(message) <= limit:
        return message
    return message[: limit - 1] + "…"
