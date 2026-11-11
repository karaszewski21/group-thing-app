"""Pure public-link rules: the frontend paths of a term page and an event
page under an owner's slug.
No `db`, no cross-context imports."""

from __future__ import annotations

import uuid


def term_path(slug: str, group_id: uuid.UUID, term_id: uuid.UUID) -> str:
    """The public term page: `/<slug>/group/<group-id>/term/<term-id>`."""
    return f"/{slug}/group/{group_id}/term/{term_id}"


def event_path(slug: str, event_id: uuid.UUID) -> str:
    """The public event page: `/<slug>/event/<event-id>`."""
    return f"/{slug}/event/{event_id}"
