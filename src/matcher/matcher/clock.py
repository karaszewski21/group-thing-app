"""The matcher's only clock read. Timestamps are naive UTC, like the backend's
audit columns; every run takes one `now` from here and passes it down."""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
