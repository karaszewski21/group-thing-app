"""Anti-corruption layer over `app.groups`: the ONLY `app.pages` module that
imports the groups vertical. It exposes, through the groups facade, the
owner-page reads (the pending-proposer join and the paging and counting of the
owner's listed items, the per-mode counts, public
groups, upcoming public terms of a party or a group, the viewer's party and
the reservers' names, organizer slugs) and the upcoming-events reads groups
keeps for the owner pages, plus the groups types the page schemas embed. It
must not import `..schemas`."""

from __future__ import annotations

from app.groups.models import GroupLayoutMode
from app.groups.schemas import (
    ExchangeMode,
    OwnerItemCountsResponse,
    OwnerSummaryResponse,
    ReservedByResponse,
)
from app.groups.service import (
    author_slugs,
    count_owner_available_items_by_mode,
    count_owner_public_groups,
    count_owner_public_terms,
    count_upcoming_authored_events,
    list_group_upcoming_terms,
    list_owner_listed_items_page,
    list_owner_public_groups,
    list_upcoming_events_for_parties,
    list_upcoming_public_terms_for_party,
    load_reserved_by_names,
    owner_item_counts,
    resolve_organizer_slugs,
    resolve_viewer_party_id,
    with_pending_proposer,
)

__all__ = [
    "ExchangeMode",
    "GroupLayoutMode",
    "OwnerItemCountsResponse",
    "OwnerSummaryResponse",
    "ReservedByResponse",
    "author_slugs",
    "count_owner_available_items_by_mode",
    "count_owner_public_groups",
    "count_owner_public_terms",
    "count_upcoming_authored_events",
    "list_group_upcoming_terms",
    "list_owner_listed_items_page",
    "list_owner_public_groups",
    "list_upcoming_events_for_parties",
    "list_upcoming_public_terms_for_party",
    "load_reserved_by_names",
    "owner_item_counts",
    "resolve_organizer_slugs",
    "resolve_viewer_party_id",
    "with_pending_proposer",
]
