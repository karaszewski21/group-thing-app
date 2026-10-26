"""`app.groups` business logic: Circle CRUD, leadership transfer (strictly
1:N), membership join/leave (N:N, per individual `GroupRole`), Term/
NeededItem/Pledge, and the item-exchange bridge into `app.circulation`
(one-directional dependency only).

This module is a flat re-export facade over the `domain/`, `application/`
and `infrastructure/` layers; `app.groups.router` and the cross-slice
consumers in `app.families` / `app.users` import every symbol they need
from here.

Ownership checks the coarse `AUTHORIZATION_MATRIX` can't express (only the
active organizer of a Circle may create its Terms, only the pledging party
may withdraw their own Pledge, ...) live in `application/`, raising
`AccessDeniedException` — per `standards/backend/security.md`'s guidance.
"""

from __future__ import annotations

from app.groups.application.account_merge import merge_anonymous_profile
from app.groups.application.attendance import withdraw_attendance
from app.groups.application.chat_audience import (
    ChatAudience,
    get_chat_audience_for_party,
    list_active_attendee_party_ids,
)
from app.groups.application.circles import (
    assign_leadership,
    build_leadership_responses,
    create_additional_circle,
    create_circle,
    create_own_circle,
    get_current_leadership,
    get_group,
    get_group_including_deleted,
    is_active_group_organizer,
    list_active_leaderships_for_party,
    list_groups,
    list_groups_for_moderation,
    list_leaderships,
    remove_leadership,
    restore_group,
    soft_delete_group,
    update_group,
)
from app.groups.application.exchange_summary import (
    get_family_exchange_offers,
    get_group_exchange_summary,
    list_group_member_party_ids,
)
from app.groups.application.join_code import (
    get_join_code,
    redeem_join_code,
    regenerate_join_code,
)
from app.groups.application.memberships import (
    add_active_membership,
    build_membership_responses,
    end_membership,
    list_group_members,
    list_memberships_for_circle,
    list_memberships_for_party,
    list_term_attendees,
)
from app.groups.application.organizer_page import get_organizer_page, list_organizer_terms
from app.groups.application.pledges import (
    create_pledge,
    get_pledge,
    list_pledges,
    withdraw_pledge,
)
from app.groups.application.public_view import (
    create_rsvp,
    get_group_access,
    get_public_circle_view,
    list_my_attendances,
    list_my_pledges,
)
from app.groups.application.term_item_listings import (
    accept_swap_proposal,
    cancel_transaction,
    confirm_transaction,
    list_browsable_term_item_listings,
    list_my_active_taken_term_item_listings,
    list_my_inventory_items,
    list_my_term_item_listings,
    list_swap_proposals_for_my_item,
    propose_swap,
    reject_swap_proposal,
    set_item_listing_preference,
    take_item_listing,
)
from app.groups.application.terms import (
    create_needed_item,
    create_term,
    get_needed_item_view,
    get_term,
    get_term_any,
    list_needed_item_views,
    list_terms,
    list_terms_for_moderation,
    list_terms_with_counts,
    soft_delete_needed_item,
    update_needed_item,
    update_term,
)
from app.groups.infrastructure.locations_acl import (
    get_location,
    get_locations_by_ids,
    location_ref_response,
)
from app.groups.infrastructure.repository import (
    has_active_attendance,
    has_active_membership,
    list_chat_group_refs,
    list_chat_term_refs,
    list_current_organizer_party_ids,
)
from app.groups.infrastructure.slug_resolver import resolve_organizer_slug

__all__ = [
    "ChatAudience",
    "accept_swap_proposal",
    "add_active_membership",
    "assign_leadership",
    "build_leadership_responses",
    "build_membership_responses",
    "cancel_transaction",
    "confirm_transaction",
    "create_additional_circle",
    "create_circle",
    "create_needed_item",
    "create_own_circle",
    "create_pledge",
    "create_rsvp",
    "create_term",
    "end_membership",
    "get_chat_audience_for_party",
    "get_current_leadership",
    "get_family_exchange_offers",
    "get_group",
    "get_group_access",
    "get_group_exchange_summary",
    "get_group_including_deleted",
    "get_join_code",
    "get_location",
    "get_locations_by_ids",
    "get_needed_item_view",
    "get_organizer_page",
    "get_pledge",
    "get_public_circle_view",
    "get_term",
    "get_term_any",
    "has_active_attendance",
    "has_active_membership",
    "is_active_group_organizer",
    "list_active_attendee_party_ids",
    "list_active_leaderships_for_party",
    "list_browsable_term_item_listings",
    "list_chat_group_refs",
    "list_chat_term_refs",
    "list_current_organizer_party_ids",
    "list_group_member_party_ids",
    "list_group_members",
    "list_groups",
    "list_groups_for_moderation",
    "list_leaderships",
    "list_memberships_for_circle",
    "list_memberships_for_party",
    "list_my_active_taken_term_item_listings",
    "list_my_attendances",
    "list_my_inventory_items",
    "list_my_pledges",
    "list_my_term_item_listings",
    "list_needed_item_views",
    "list_organizer_terms",
    "list_pledges",
    "list_swap_proposals_for_my_item",
    "list_term_attendees",
    "list_terms",
    "list_terms_for_moderation",
    "list_terms_with_counts",
    "location_ref_response",
    "merge_anonymous_profile",
    "propose_swap",
    "redeem_join_code",
    "regenerate_join_code",
    "reject_swap_proposal",
    "remove_leadership",
    "resolve_organizer_slug",
    "restore_group",
    "set_item_listing_preference",
    "soft_delete_group",
    "soft_delete_needed_item",
    "take_item_listing",
    "update_group",
    "update_needed_item",
    "update_term",
    "withdraw_attendance",
    "withdraw_pledge",
]
