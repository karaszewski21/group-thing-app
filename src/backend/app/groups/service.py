"""`app.groups` business logic: Circle CRUD, leadership transfer (strictly
1:N), membership join/leave (N:N, per individual `GroupRole`), Term/
NeededItem/Pledge, and the Pledge->Reservation bridge into
`app.circulation` (one-directional dependency only).

This module is a flat re-export facade over the `domain/`, `application/`
and `infrastructure/` layers; `app.groups.router` and the cross-slice
consumers in `app.families` / `app.users` import every symbol they need
from here.

Ownership checks the coarse `AUTHORIZATION_MATRIX` can't express (only the
active organizer of a Circle may create its Terms, only the pledging party
may withdraw/fulfill their own Pledge, ...) live in `application/`, raising
`AccessDeniedException` — per `standards/backend/security.md`'s guidance.
"""

from __future__ import annotations

from app.groups.application.account_merge import merge_anonymous_profile
from app.groups.application.circles import (
    assign_leadership,
    build_leadership_responses,
    create_circle,
    create_own_circle,
    get_current_leadership,
    get_group,
    list_active_leaderships_for_party,
    list_groups,
    list_leaderships,
    remove_leadership,
    update_group,
)
from app.groups.application.memberships import (
    build_membership_responses,
    create_membership,
    end_membership,
    list_memberships_for_circle,
    list_memberships_for_party,
)
from app.groups.application.pledge_fulfillment import fulfill_pledge, sync_pledge_fulfillment
from app.groups.application.pledges import (
    create_pledge,
    get_pledge,
    list_pledges,
    withdraw_pledge,
)
from app.groups.application.public_view import (
    create_rsvp,
    get_public_circle_view,
    list_my_attendances,
)
from app.groups.application.terms import (
    create_needed_item,
    create_term,
    get_needed_item_view,
    get_term,
    list_needed_item_views,
    list_terms,
    soft_delete_needed_item,
    update_needed_item,
    update_term,
)
from app.groups.infrastructure.slug_resolver import resolve_organizer_slug

__all__ = [
    "assign_leadership",
    "build_leadership_responses",
    "build_membership_responses",
    "create_circle",
    "create_membership",
    "create_needed_item",
    "create_own_circle",
    "create_pledge",
    "create_rsvp",
    "create_term",
    "end_membership",
    "fulfill_pledge",
    "get_current_leadership",
    "get_group",
    "get_needed_item_view",
    "get_pledge",
    "get_public_circle_view",
    "get_term",
    "list_active_leaderships_for_party",
    "list_groups",
    "list_leaderships",
    "list_memberships_for_circle",
    "list_memberships_for_party",
    "list_my_attendances",
    "list_needed_item_views",
    "list_pledges",
    "list_terms",
    "merge_anonymous_profile",
    "remove_leadership",
    "resolve_organizer_slug",
    "soft_delete_needed_item",
    "sync_pledge_fulfillment",
    "update_group",
    "update_needed_item",
    "update_term",
    "withdraw_pledge",
]
