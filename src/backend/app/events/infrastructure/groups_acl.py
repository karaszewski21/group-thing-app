"""Anti-corruption layer over `app.groups`: the ONLY `app.events` module
that imports the groups vertical. It exposes the party slug rule, so an
author's event URLs share the prefix of their term URLs, the unexecuted
listing-preference select the event page joins with the listed items, the
groups-side reserved state of those items (`with_pending_proposer` adds a
pending swap proposal's proposer; `load_reserved_by_names` names the
reservers for the viewer), and the open exchanges an event delete cancels
(`cancel_open_event_reservations`, flush only) or counts for the author's
delete dialog. It must not import `..schemas`."""

from __future__ import annotations

from app.groups.domain.organizer_slug import derive_party_slug
from app.groups.service import (
    OpenEventReservationCounts,
    ReservedByNames,
    cancel_open_event_reservations,
    count_open_event_reservations,
    item_listing_preferences_select,
    load_reserved_by_names,
    with_pending_proposer,
)

__all__ = [
    "OpenEventReservationCounts",
    "ReservedByNames",
    "cancel_open_event_reservations",
    "count_open_event_reservations",
    "derive_party_slug",
    "item_listing_preferences_select",
    "load_reserved_by_names",
    "with_pending_proposer",
]
