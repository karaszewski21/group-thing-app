"""Anti-corruption layer over `app.groups`: the ONLY `app.events` module
that imports the groups vertical. It exposes the party slug rule, so an
author's event URLs share the prefix of their term URLs, and the unexecuted
listing-preference select the event page joins with the available items,
and the open exchanges an event delete cancels (`cancel_open_event_reservations`,
flush only) or counts for the author's delete dialog.
It must not import `..schemas`."""

from __future__ import annotations

from app.groups.domain.organizer_slug import derive_party_slug
from app.groups.service import (
    OpenEventReservationCounts,
    cancel_open_event_reservations,
    count_open_event_reservations,
    item_listing_preferences_select,
)

__all__ = [
    "OpenEventReservationCounts",
    "cancel_open_event_reservations",
    "count_open_event_reservations",
    "derive_party_slug",
    "item_listing_preferences_select",
]
