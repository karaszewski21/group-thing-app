"""Anti-corruption layer over `app.groups`: the ONLY `app.search` module that
imports the groups vertical. It exposes, through the groups facade, the
visibility predicates (`items_visible_to`, `terms_visible_to`,
`groups_visible_to`), the membership primitive `group_ids_for`, the
pending-proposer join of the listed items, "the item owner shares a group
with the viewer", the public-URL slug rules of a party and of a group, and
the groups tables the search selects read, plus unexecuted builders on top
of them: "a group the viewer is in", a group's current organizer and its
nearest upcoming term (both LATERAL). It must not import `..schemas`."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ColumnElement, SQLColumnExpression, select
from sqlalchemy.sql.selectable import LateralFromClause

from app.groups.domain.organizer_slug import derive_organizer_slug, derive_party_slug
from app.groups.models import (
    Group,
    GroupRole,
    GroupVisibility,
    ItemListingPreference,
    Leadership,
    Term,
)
from app.groups.schemas import ExchangeMode
from app.groups.service import (
    VisibilityScope,
    active_leadership_clause,
    group_ids_for,
    groups_visible_to,
    items_visible_to,
    owner_shares_group_with,
    terms_visible_to,
    with_pending_proposer,
)

__all__ = [
    "ExchangeMode",
    "Group",
    "GroupVisibility",
    "ItemListingPreference",
    "Term",
    "VisibilityScope",
    "current_organizer",
    "derive_organizer_slug",
    "derive_party_slug",
    "groups_visible_to",
    "in_groups_of",
    "items_visible_to",
    "next_term",
    "owner_shares_group_with",
    "terms_visible_to",
    "with_pending_proposer",
]


def in_groups_of(
    viewer: uuid.UUID, group_id: SQLColumnExpression[uuid.UUID]
) -> ColumnElement[bool]:
    """`group_id` is a live group `viewer` is in."""
    return group_id.in_(group_ids_for(viewer))


def current_organizer(group_id: SQLColumnExpression[uuid.UUID]) -> LateralFromClause:
    """LATERAL `(party_id)` of the group's current organizer, no row
    without one."""
    return (
        select(GroupRole.party_id.label("party_id"))
        .select_from(Leadership)
        .join(GroupRole, GroupRole.id == Leadership.from_role_id)
        .where(active_leadership_clause(), Leadership.to_group_id == group_id)
        .order_by(Leadership.created_at, Leadership.id)
        .limit(1)
        .lateral("organizer")
    )


def next_term(group_id: SQLColumnExpression[uuid.UUID], now: datetime) -> LateralFromClause:
    """LATERAL `(term_id, occurs_on)` of the group's earliest term at or
    after `now`, no row without one (`ix_terms_circle_group_id_occurs_on`)."""
    return (
        select(Term.id.label("term_id"), Term.occurs_on.label("occurs_on"))
        .where(Term.circle_group_id == group_id, Term.occurs_on >= now)
        .order_by(Term.occurs_on, Term.id)
        .limit(1)
        .lateral("next_term")
    )
