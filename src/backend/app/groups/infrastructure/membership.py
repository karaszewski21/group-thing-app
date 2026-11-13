"""The one definition of "a party is in a group": a standing `Membership` or
the current `Leadership`, each held through a live `GroupRole`. Set queries
use `group_ids_for`, row reads filter on the same two clauses, and the
organizer check that must reach a soft-deleted circle uses
`holds_active_leadership`.
An RSVP or a family relation never counts."""

from __future__ import annotations

import uuid
from collections.abc import Collection

from sqlalchemy import ColumnElement, Select, SQLColumnExpression, and_, exists, or_, select
from sqlalchemy.orm import aliased

from ..models import Group, GroupRole, GroupRoleType, Leadership, Membership

Parties = uuid.UUID | Collection[uuid.UUID] | SQLColumnExpression[uuid.UUID]


def active_membership_clause() -> ColumnElement[bool]:
    """`Membership` is standing and held through a live MEMBER `GroupRole`."""
    return and_(
        Membership.valid_to.is_(None),
        GroupRole.id == Membership.from_role_id,
        GroupRole.role_type == GroupRoleType.MEMBER,
        GroupRole.valid_to.is_(None),
    )


def active_leadership_clause() -> ColumnElement[bool]:
    """`Leadership` is current and held through a live ORGANIZATOR `GroupRole`."""
    return and_(
        Leadership.valid_to.is_(None),
        GroupRole.id == Leadership.from_role_id,
        GroupRole.role_type == GroupRoleType.ORGANIZATOR,
        GroupRole.valid_to.is_(None),
    )


def live_group_clause(group_id_col: SQLColumnExpression[uuid.UUID]) -> ColumnElement[bool]:
    """The group `group_id_col` points at is not soft-deleted. An alias, so
    it never correlates with a `Group` of the enclosing query."""
    live = aliased(Group)
    return exists().where(live.id == group_id_col, live.deleted_at.is_(None))


def _held_by(parties: Parties) -> ColumnElement[bool]:
    if isinstance(parties, uuid.UUID | SQLColumnExpression):
        return GroupRole.party_id == parties
    return GroupRole.party_id.in_(set(parties))


def group_ids_for(
    parties: Parties,
    *,
    organizer_only: bool = False,
    memberships_only: bool = False,
    include_deleted: bool = False,
) -> Select[tuple[uuid.UUID]]:
    """Unexecuted `select(Group.id)` of the groups in which any of `parties`
    holds an active membership (skipped when `organizer_only`) or the current
    leadership (skipped when `memberships_only`). `parties` may be a
    correlated column such as `ItemListingPreference.owner_party_id`.
    Soft-deleted groups are left out unless `include_deleted`, which only
    messaging's read paths pass."""
    if organizer_only and memberships_only:
        raise ValueError("organizer_only and memberships_only are mutually exclusive")
    held_by = _held_by(parties)
    branches: list[ColumnElement[bool]] = []
    if not organizer_only:
        member_of = (
            select(Membership.to_group_id)
            .where(active_membership_clause(), held_by)
            .correlate_except(Membership, GroupRole)
        )
        branches.append(Group.id.in_(member_of))
    if not memberships_only:
        leads = (
            select(Leadership.to_group_id)
            .where(active_leadership_clause(), held_by)
            .correlate_except(Leadership, GroupRole)
        )
        branches.append(Group.id.in_(leads))
    query = select(Group.id).where(or_(*branches)).correlate_except(Group)
    if not include_deleted:
        query = query.where(live_group_clause(Group.id))
    return query


def holds_active_leadership(party_id: uuid.UUID, group_id: uuid.UUID) -> ColumnElement[bool]:
    """`party_id` holds the current Leadership of `group_id`, soft-deleted or
    not. Sole caller: `circles.is_active_group_organizer`, which backs
    `remove_leadership` and the term-organizer reads
    (`attendance._is_term_organizer`): both must keep working on a deleted
    circle without widening `group_ids_for(include_deleted=True)` beyond
    messaging."""
    return exists().where(
        active_leadership_clause(),
        Leadership.to_group_id == group_id,
        GroupRole.party_id == party_id,
    )
