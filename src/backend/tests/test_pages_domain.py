"""Pure rules of the public owner pages: the merge order of an owner's
upcoming dates and the public link paths. No DB, no client."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from app.pages.domain.links import event_path, term_path
from app.pages.domain.owner_dates import merge_upcoming_dates


@dataclass(frozen=True)
class _Date:
    name: str
    starts_at: datetime


def test_mergeUpcomingDates_termAndEventSameStart_termFirst() -> None:
    starts_at = datetime(2026, 12, 5, 10, 0)
    term = _Date("term", starts_at)
    event = _Date("event", starts_at)

    merged = merge_upcoming_dates([term], [event], limit=5)

    assert merged == [term, event]


def test_mergeUpcomingDates_moreThanLimit_earliestLimitEntriesEarliestFirst() -> None:
    term_late = _Date("term-late", datetime(2026, 12, 9, 18, 0))
    term_early = _Date("term-early", datetime(2026, 12, 1, 9, 0))
    event_middle = _Date("event-middle", datetime(2026, 12, 3, 12, 0))
    event_latest = _Date("event-latest", datetime(2026, 12, 20, 8, 0))

    merged = merge_upcoming_dates([term_early, term_late], [event_latest, event_middle], limit=3)

    assert merged == [term_early, event_middle, term_late]


def test_termPathAndEventPath_slugAndIds_exactPublicPaths() -> None:
    group_id = uuid.UUID("11111111-1111-4111-8111-111111111111")
    term_id = uuid.UUID("22222222-2222-4222-8222-222222222222")
    event_id = uuid.UUID("33333333-3333-4333-8333-333333333333")

    assert term_path("klub-gier", group_id, term_id) == (
        "/klub-gier/group/11111111-1111-4111-8111-111111111111"
        "/term/22222222-2222-4222-8222-222222222222"
    )
    assert (
        event_path("klub-gier", event_id) == "/klub-gier/event/33333333-3333-4333-8333-333333333333"
    )
