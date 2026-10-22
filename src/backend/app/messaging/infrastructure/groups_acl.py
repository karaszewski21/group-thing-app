"""Anti-corruption layer over `app.groups`: the ONLY `app.messaging` module
that imports the groups context. Every check and audience statement here
includes soft-deleted Circles (their chats stay readable, read-only); only
ended memberships/leaderships and withdrawn RSVPs are excluded. Must not
import `..schemas` (cycle)."""

from __future__ import annotations

from app.groups.models import Group, GroupVisibility, Term
from app.groups.service import (
    ChatAudience,
    get_chat_audience_for_party,
    get_group_including_deleted,
    get_term_any,
    has_active_attendance,
    has_active_membership,
    is_active_group_organizer,
    list_active_attendee_party_ids,
    list_chat_group_refs,
    list_chat_term_refs,
    list_current_organizer_party_ids,
    list_group_member_party_ids,
)

__all__ = [
    "ChatAudience",
    "Group",
    "GroupVisibility",
    "Term",
    "get_chat_audience_for_party",
    "get_group_including_deleted",
    "get_term_any",
    "has_active_attendance",
    "has_active_membership",
    "is_active_group_organizer",
    "list_active_attendee_party_ids",
    "list_chat_group_refs",
    "list_chat_term_refs",
    "list_current_organizer_party_ids",
    "list_group_member_party_ids",
]
