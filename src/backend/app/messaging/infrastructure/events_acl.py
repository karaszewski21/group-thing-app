"""Anti-corruption layer over `app.events`: the ONLY `app.messaging` module
that imports the events context. Only active (non-withdrawn) attendances
grant chat access. Must not import `..schemas` (cycle)."""

from __future__ import annotations

from app.events.models import Event
from app.events.service import (
    get_event,
    has_active_attendance,
    list_active_attendee_party_ids,
    list_chat_event_ids_for_party,
    list_chat_event_refs,
)

__all__ = [
    "Event",
    "get_event",
    "has_active_attendance",
    "list_active_attendee_party_ids",
    "list_chat_event_ids_for_party",
    "list_chat_event_refs",
]
