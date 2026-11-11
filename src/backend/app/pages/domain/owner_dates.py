"""Pure rule of an owner's upcoming dates: terms and events merged earliest
first, a term winning a tie, capped.
No `db`, no cross-context imports."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime
from typing import Protocol


class _HasStartsAt(Protocol):
    @property
    def starts_at(self) -> datetime: ...


def merge_upcoming_dates[D: _HasStartsAt](
    terms: Sequence[D], events: Sequence[D], limit: int
) -> list[D]:
    """The first `limit` of `terms` and `events` together, earliest
    `starts_at` first. The sort is stable over terms followed by events, so a
    term wins a tie."""
    dates = [*terms, *events]
    dates.sort(key=lambda date: date.starts_at)
    return dates[:limit]
