"""Read-side queries for `app.groups`: every `select()` / `db.get()` for
`Group` / `GroupRole` / `Leadership` / `Membership` / `Term` /
`NeededItem` / `Pledge` / `TermAttendance` and the public-view
`UserProfile` join, relocated verbatim into named functions, plus the batched
organizer-directory reads (whose family count joins `app.families.models`,
the `application/exchange_summary.py` precedent). Eager-loading
and ordering options are preserved exactly per `standards/backend/queries.md`.
Never commits or flushes; `EntityNotFoundException` raising stays in the
`application/` getter wrappers."""

from __future__ import annotations

import uuid
from collections.abc import Collection, Sequence
from datetime import datetime
from typing import Any

from sqlalchemy import (
    ColumnElement,
    Row,
    Select,
    Subquery,
    and_,
    case,
    exists,
    func,
    literal,
    or_,
    select,
    true,
    union_all,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.models import FamilyMembership, FamilyRole
from app.users.models import UserProfile

from ..models import (
    Group,
    GroupLayoutMode,
    GroupRole,
    GroupRoleType,
    GroupVisibility,
    ItemListingPreference,
    ItemVisibility,
    Leadership,
    Membership,
    NeededItem,
    Pledge,
    PledgeStatus,
    SwapProposal,
    SwapProposalStatus,
    Term,
    TermAttendance,
)

# --- Group -------------------------------------------------------------------


async def list_groups(db: AsyncSession) -> list[Group]:
    result = await db.execute(
        select(Group).where(Group.deleted_at.is_(None)).order_by(Group.created_at.desc())
    )
    return list(result.scalars().all())


async def get_group(db: AsyncSession, group_id: uuid.UUID) -> Group | None:
    """`None` for a soft-deleted Circle, which is nonexistent to every caller
    except restore (`get_group_including_deleted`)."""
    group = await db.get(Group, group_id)
    if group is None or group.deleted_at is not None:
        return None
    return group


async def get_group_including_deleted(db: AsyncSession, group_id: uuid.UUID) -> Group | None:
    return await db.get(Group, group_id)


async def list_group_names(
    db: AsyncSession, group_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, str]:
    if not group_ids:
        return {}
    result = await db.execute(select(Group.id, Group.name).where(Group.id.in_(group_ids)))
    return {group_id: name for group_id, name in result.all()}


def _moderation_deleted_predicate(deleted: bool) -> Any:
    return Group.deleted_at.is_not(None) if deleted else Group.deleted_at.is_(None)


async def count_groups(db: AsyncSession, deleted: bool = False) -> int:
    return (
        await db.execute(
            select(func.count()).select_from(Group).where(_moderation_deleted_predicate(deleted))
        )
    ).scalar_one()


async def list_groups_for_moderation(
    db: AsyncSession, offset: int, limit: int, deleted: bool = False
) -> list[Row[tuple[Group, str | None, str | None, int, int, str | None]]]:
    """One aggregated query — `LEFT JOIN`/`GROUP BY` subqueries for member
    and term counts plus the current organizer's `UserProfile`, per
    `standards/backend/queries.md` (mirrors `app.category.service.
    list_categories`'s product-count pattern). Never one query per Circle.
    `deleted` selects live or soft-deleted Circles (same predicate as
    `count_groups`); deleted ones come newest-deleted first with the
    deleting party's display name (`None` without a profile)."""
    member_counts = (
        select(Membership.to_group_id, func.count().label("member_count"))
        .where(Membership.valid_to.is_(None))
        .group_by(Membership.to_group_id)
        .subquery()
    )
    term_counts = (
        select(Term.circle_group_id, func.count().label("term_count"))
        .group_by(Term.circle_group_id)
        .subquery()
    )
    organizers = (
        select(
            Leadership.to_group_id,
            UserProfile.display_name,
            UserProfile.email,
        )
        .join(GroupRole, GroupRole.id == Leadership.from_role_id)
        .join(UserProfile, UserProfile.party_id == GroupRole.party_id)
        .where(Leadership.valid_to.is_(None))
        .subquery()
    )
    order_by = (
        (Group.deleted_at.desc(), Group.id) if deleted else (Group.created_at.desc(), Group.id)
    )
    result = await db.execute(
        select(
            Group,
            organizers.c.display_name,
            organizers.c.email,
            func.coalesce(member_counts.c.member_count, 0),
            func.coalesce(term_counts.c.term_count, 0),
            UserProfile.display_name,
        )
        .outerjoin(member_counts, member_counts.c.to_group_id == Group.id)
        .outerjoin(term_counts, term_counts.c.circle_group_id == Group.id)
        .outerjoin(organizers, organizers.c.to_group_id == Group.id)
        .outerjoin(UserProfile, UserProfile.party_id == Group.deleted_by_party_id)
        .where(_moderation_deleted_predicate(deleted))
        .order_by(*order_by)
        .offset(offset)
        .limit(limit)
    )
    return list(result.all())


# --- GroupRole -------------------------------------------------------------------


async def find_active_group_role(
    db: AsyncSession, party_id: uuid.UUID, role_type: GroupRoleType
) -> GroupRole | None:
    return (
        await db.execute(
            select(GroupRole).where(
                GroupRole.party_id == party_id,
                GroupRole.role_type == role_type,
                GroupRole.valid_to.is_(None),
            )
        )
    ).scalar_one_or_none()


async def get_group_role(db: AsyncSession, group_role_id: uuid.UUID) -> GroupRole | None:
    return await db.get(GroupRole, group_role_id)


# --- Leadership -------------------------------------------------------------------


async def get_leadership(db: AsyncSession, leadership_id: uuid.UUID) -> Leadership | None:
    return await db.get(Leadership, leadership_id)


async def find_current_leadership(db: AsyncSession, group_id: uuid.UUID) -> Leadership | None:
    result = await db.execute(
        select(Leadership).where(Leadership.to_group_id == group_id, Leadership.valid_to.is_(None))
    )
    return result.scalar_one_or_none()


async def list_leaderships_for_group(db: AsyncSession, group_id: uuid.UUID) -> list[Leadership]:
    result = await db.execute(
        select(Leadership)
        .where(Leadership.to_group_id == group_id)
        .order_by(Leadership.valid_from.desc())
    )
    return list(result.scalars().all())


async def list_organizer_role_ids_for_party(
    db: AsyncSession, party_id: uuid.UUID
) -> list[uuid.UUID]:
    return list(
        (
            await db.execute(
                select(GroupRole.id).where(
                    GroupRole.party_id == party_id,
                    GroupRole.role_type == GroupRoleType.ORGANIZATOR,
                )
            )
        )
        .scalars()
        .all()
    )


async def list_active_leaderships_for_role_ids(
    db: AsyncSession, role_ids: list[uuid.UUID]
) -> list[Leadership]:
    result = await db.execute(
        select(Leadership)
        .join(Group, Group.id == Leadership.to_group_id)
        .where(
            Leadership.from_role_id.in_(role_ids),
            Leadership.valid_to.is_(None),
            Group.deleted_at.is_(None),
        )
    )
    return list(result.scalars().all())


# --- Membership -------------------------------------------------------------------


async def get_membership(db: AsyncSession, membership_id: uuid.UUID) -> Membership | None:
    return await db.get(Membership, membership_id)


async def list_active_memberships_for_group(
    db: AsyncSession, circle_group_id: uuid.UUID
) -> list[Membership]:
    result = await db.execute(
        select(Membership)
        .where(Membership.to_group_id == circle_group_id, Membership.valid_to.is_(None))
        .order_by(Membership.valid_from.desc())
    )
    return list(result.scalars().all())


async def list_member_role_ids_for_party(db: AsyncSession, party_id: uuid.UUID) -> list[uuid.UUID]:
    return list(
        (
            await db.execute(
                select(GroupRole.id).where(
                    GroupRole.party_id == party_id, GroupRole.role_type == GroupRoleType.MEMBER
                )
            )
        )
        .scalars()
        .all()
    )


async def list_active_memberships_for_role_ids(
    db: AsyncSession, role_ids: list[uuid.UUID]
) -> list[Membership]:
    result = await db.execute(
        select(Membership)
        .join(Group, Group.id == Membership.to_group_id)
        .where(
            Membership.from_role_id.in_(role_ids),
            Membership.valid_to.is_(None),
            Group.deleted_at.is_(None),
        )
    )
    return list(result.scalars().all())


# --- Chat audience ----------------------------------------------------------------
# Messaging keeps a soft-deleted Circle's chat readable, so none of these joins
# `Group` or filters `deleted_at` (unlike the `list_active_*_for_role_ids` reads).


async def has_active_membership(db: AsyncSession, group_id: uuid.UUID, party_id: uuid.UUID) -> bool:
    return bool(
        (
            await db.execute(
                select(
                    exists().where(
                        Membership.to_group_id == group_id,
                        Membership.valid_to.is_(None),
                        GroupRole.id == Membership.from_role_id,
                        GroupRole.party_id == party_id,
                        GroupRole.role_type == GroupRoleType.MEMBER,
                    )
                )
            )
        ).scalar_one()
    )


async def has_active_attendance(db: AsyncSession, term_id: uuid.UUID, party_id: uuid.UUID) -> bool:
    return bool(
        (
            await db.execute(
                select(
                    exists().where(
                        TermAttendance.term_id == term_id,
                        TermAttendance.party_id == party_id,
                        TermAttendance.withdrawn_at.is_(None),
                    )
                )
            )
        ).scalar_one()
    )


async def list_led_group_ids_for_party(db: AsyncSession, party_id: uuid.UUID) -> set[uuid.UUID]:
    result = await db.execute(led_group_ids_query(party_id))
    return set(result.scalars().all())


async def list_member_group_ids_for_party(db: AsyncSession, party_id: uuid.UUID) -> set[uuid.UUID]:
    result = await db.execute(
        select(Membership.to_group_id)
        .join(GroupRole, GroupRole.id == Membership.from_role_id)
        .where(
            GroupRole.party_id == party_id,
            GroupRole.role_type == GroupRoleType.MEMBER,
            Membership.valid_to.is_(None),
        )
    )
    return set(result.scalars().all())


async def list_attended_term_ids_for_party(db: AsyncSession, party_id: uuid.UUID) -> set[uuid.UUID]:
    result = await db.execute(
        select(TermAttendance.term_id).where(
            TermAttendance.party_id == party_id, TermAttendance.withdrawn_at.is_(None)
        )
    )
    return set(result.scalars().all())


async def list_chat_group_refs(
    db: AsyncSession, group_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, tuple[str, GroupVisibility, datetime | None]]:
    if not group_ids:
        return {}
    result = await db.execute(
        select(Group.id, Group.name, Group.visibility, Group.deleted_at).where(
            Group.id.in_(group_ids)
        )
    )
    return {
        group_id: (name, visibility, deleted_at)
        for group_id, name, visibility, deleted_at in result.all()
    }


async def list_chat_term_refs(
    db: AsyncSession, term_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, tuple[uuid.UUID, datetime]]:
    if not term_ids:
        return {}
    result = await db.execute(
        select(Term.id, Term.circle_group_id, Term.occurs_on).where(Term.id.in_(term_ids))
    )
    return {term_id: (group_id, occurs_on) for term_id, group_id, occurs_on in result.all()}


async def list_current_organizer_party_ids(
    db: AsyncSession, group_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    if not group_ids:
        return {}
    result = await db.execute(
        select(Leadership.to_group_id, GroupRole.party_id)
        .join(GroupRole, GroupRole.id == Leadership.from_role_id)
        .where(Leadership.to_group_id.in_(group_ids), Leadership.valid_to.is_(None))
    )
    return {group_id: party_id for group_id, party_id in result.all()}


# --- Term / NeededItem ----------------------------------------------------------


async def get_term(db: AsyncSession, term_id: uuid.UUID) -> Term | None:
    """`None` when the Term's Circle is soft-deleted; `get_term_any` is the
    keep-live escape hatch."""
    return (
        await db.execute(
            select(Term)
            .join(Group, Group.id == Term.circle_group_id)
            .where(Term.id == term_id, Group.deleted_at.is_(None))
        )
    ).scalar_one_or_none()


async def get_term_any(db: AsyncSession, term_id: uuid.UUID) -> Term | None:
    return await db.get(Term, term_id)


async def find_nearest_blocking_term_date(
    db: AsyncSession, group_id: uuid.UUID, now: datetime
) -> datetime | None:
    """Earliest upcoming (`occurs_on >= now`) Term of the Circle that still
    has a non-withdrawn RSVP, in one `MIN` query."""
    active_rsvp = exists().where(
        TermAttendance.term_id == Term.id, TermAttendance.withdrawn_at.is_(None)
    )
    return (
        await db.execute(
            select(func.min(Term.occurs_on)).where(
                Term.circle_group_id == group_id, Term.occurs_on >= now, active_rsvp
            )
        )
    ).scalar_one()


async def list_terms_for_group(db: AsyncSession, circle_group_id: uuid.UUID) -> list[Term]:
    result = await db.execute(
        select(Term).where(Term.circle_group_id == circle_group_id).order_by(Term.occurs_on.desc())
    )
    return list(result.scalars().all())


def led_group_ids_query(party_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """Circles the party currently leads."""
    return (
        select(Leadership.to_group_id)
        .join(GroupRole, GroupRole.id == Leadership.from_role_id)
        .where(
            GroupRole.party_id == party_id,
            GroupRole.role_type == GroupRoleType.ORGANIZATOR,
            Leadership.valid_to.is_(None),
        )
    )


def member_group_ids_query(party_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """PRIVATE circles the party or anyone in the party's families currently
    belongs to, without the circles the party leads. A PUBLIC circle's terms
    reach the panel through RSVPs instead."""
    own_family_ids = (
        select(FamilyMembership.to_family_id)
        .join(FamilyRole, FamilyRole.id == FamilyMembership.from_role_id)
        .where(FamilyRole.party_id == party_id, FamilyMembership.valid_to.is_(None))
    )
    family_party_ids = (
        select(FamilyRole.party_id)
        .join(FamilyMembership, FamilyMembership.from_role_id == FamilyRole.id)
        .where(
            FamilyMembership.to_family_id.in_(own_family_ids),
            FamilyMembership.valid_to.is_(None),
        )
    )
    return (
        select(Membership.to_group_id)
        .join(GroupRole, GroupRole.id == Membership.from_role_id)
        .join(Group, Group.id == Membership.to_group_id)
        .where(
            or_(GroupRole.party_id == party_id, GroupRole.party_id.in_(family_party_ids)),
            GroupRole.role_type == GroupRoleType.MEMBER,
            Group.visibility == GroupVisibility.PRIVATE,
            Membership.valid_to.is_(None),
            Membership.to_group_id.not_in(led_group_ids_query(party_id)),
        )
    )


async def list_terms_page(
    db: AsyncSession,
    circles: uuid.UUID | Select[tuple[uuid.UUID]],
    upcoming: bool | None,
    since: datetime,
    offset: int,
    limit: int,
) -> tuple[list[tuple[Term, str]], int]:
    """One page of the Terms of live circles with each circle's name, plus the
    total. `upcoming=True`: from `since` on, earliest first; `False`: before
    `since`, latest first; `None`: every Term, latest first."""
    query = (
        select(Term, Group.name)
        .join(Group, Group.id == Term.circle_group_id)
        .where(
            Term.circle_group_id == circles
            if isinstance(circles, uuid.UUID)
            else Term.circle_group_id.in_(circles),
            Group.deleted_at.is_(None),
        )
    )
    if upcoming is True:
        query = query.where(Term.occurs_on >= since)
    elif upcoming is False:
        query = query.where(Term.occurs_on < since)
    total = (
        await db.execute(select(func.count()).select_from(query.order_by(None).subquery()))
    ).scalar_one()
    order = (
        (Term.occurs_on.asc(), Term.id.asc())
        if upcoming is True
        else (Term.occurs_on.desc(), Term.id.desc())
    )
    result = await db.execute(query.order_by(*order).offset(offset).limit(limit))
    return [(term, name) for term, name in result.all()], int(total)


async def count_terms_by_group(
    db: AsyncSession, group_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, int]:
    if not group_ids:
        return {}
    result = await db.execute(
        select(Term.circle_group_id, func.count())
        .where(Term.circle_group_id.in_(group_ids))
        .group_by(Term.circle_group_id)
    )
    return {group_id: int(count) for group_id, count in result.all()}


async def count_terms(db: AsyncSession) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Term)
            .join(Group, Group.id == Term.circle_group_id)
            .where(Group.deleted_at.is_(None))
        )
    ).scalar_one()


async def list_terms_for_moderation(
    db: AsyncSession, offset: int, limit: int
) -> list[Row[tuple[Term, str]]]:
    """Every Circle's Terms with the Circle's name, latest occurrence first."""
    result = await db.execute(
        select(Term, Group.name)
        .join(Group, Group.id == Term.circle_group_id)
        .where(Group.deleted_at.is_(None))
        .order_by(Term.occurs_on.desc(), Term.id)
        .offset(offset)
        .limit(limit)
    )
    return list(result.all())


async def get_needed_item(db: AsyncSession, needed_item_id: uuid.UUID) -> NeededItem | None:
    return await db.get(NeededItem, needed_item_id)


async def list_needed_items_for_term(db: AsyncSession, term_id: uuid.UUID) -> list[NeededItem]:
    result = await db.execute(
        select(NeededItem)
        .where(NeededItem.term_id == term_id, NeededItem.deleted_at.is_(None))
        .order_by(NeededItem.name, NeededItem.id)
    )
    return list(result.scalars().all())


async def list_live_needed_items_for_terms(
    db: AsyncSession, term_ids: Collection[uuid.UUID]
) -> list[tuple[NeededItem, bool]]:
    """`(needed_item, claimed)` for the live needs of those `term_ids` whose
    Circle is not soft-deleted, in one query; `claimed` = a pledge that is
    not WITHDRAWN (the rule of `list_needed_item_views`)."""
    claimed = exists().where(
        Pledge.needed_item_id == NeededItem.id, Pledge.status != PledgeStatus.WITHDRAWN
    )
    result = await db.execute(
        select(NeededItem, claimed.label("claimed"))
        .join(Term, Term.id == NeededItem.term_id)
        .join(Group, Group.id == Term.circle_group_id)
        .where(
            NeededItem.term_id.in_(term_ids),
            NeededItem.deleted_at.is_(None),
            Group.deleted_at.is_(None),
        )
        .order_by(NeededItem.term_id, NeededItem.name, NeededItem.id)
    )
    return list(result.tuples().all())


# --- Pledge -------------------------------------------------------------------


async def get_pledge(db: AsyncSession, pledge_id: uuid.UUID) -> Pledge | None:
    return await db.get(Pledge, pledge_id)


async def list_pledges_for_needed_item(db: AsyncSession, needed_item_id: uuid.UUID) -> list[Pledge]:
    result = await db.execute(select(Pledge).where(Pledge.needed_item_id == needed_item_id))
    return list(result.scalars().all())


async def list_active_pledges_for_term(
    db: AsyncSession, term_id: uuid.UUID
) -> list[Row[tuple[uuid.UUID, str, uuid.UUID]]]:
    """`(needed_item_id, pledger_display_name, pledger_party_id)` for every non-withdrawn pledge
    on the term's live needs — at most one row per need (single-claim). Inner
    join: `pledged_by_party_id` is always a party with a `UserProfile`
    (`create_pledge` reads it from `profile.party_id`)."""
    result = await db.execute(
        select(NeededItem.id, UserProfile.display_name, Pledge.pledged_by_party_id)
        .join(Pledge, Pledge.needed_item_id == NeededItem.id)
        .join(UserProfile, UserProfile.party_id == Pledge.pledged_by_party_id)
        .where(
            NeededItem.term_id == term_id,
            NeededItem.deleted_at.is_(None),
            Pledge.status != PledgeStatus.WITHDRAWN,
        )
    )
    return list(result.all())


async def list_my_pledges_joined(
    db: AsyncSession, party_id: uuid.UUID
) -> list[Row[tuple[Pledge, str, str | None, Term, Group]]]:
    """The caller's own non-withdrawn pledges + the need's name /
    refinement / term / circle, one explicit multi-entity join (these
    entities carry no `relationship()` — same form as
    `list_my_attendances_joined`). Live needs only (`deleted_at IS NULL`),
    SQL-level ordering by class date."""
    result = await db.execute(
        select(Pledge, NeededItem.name, NeededItem.description, Term, Group)
        .join(NeededItem, Pledge.needed_item_id == NeededItem.id)
        .join(Term, NeededItem.term_id == Term.id)
        .join(Group, Term.circle_group_id == Group.id)
        .where(
            Pledge.pledged_by_party_id == party_id,
            Pledge.status != PledgeStatus.WITHDRAWN,
            NeededItem.deleted_at.is_(None),
            Group.deleted_at.is_(None),
        )
        .order_by(Term.occurs_on.asc(), Pledge.id.asc())
    )
    return list(result.all())


# --- Public circle-view -------------------------------------------------------


async def list_attendances_for_term(db: AsyncSession, term_id: uuid.UUID) -> list[TermAttendance]:
    result = await db.execute(
        select(TermAttendance)
        .where(TermAttendance.term_id == term_id)
        .order_by(TermAttendance.created_at)
    )
    return list(result.scalars().all())


async def aggregate_active_attendances_for_group(
    db: AsyncSession, circle_group_id: uuid.UUID
) -> list[Row[tuple[uuid.UUID, int, datetime]]]:
    """`(party_id, terms_attended, last_term_on)` for every party with at
    least one non-withdrawn RSVP on any Term of `circle_group_id` — one
    GROUP BY, most recent attendee first."""
    terms_attended = func.count(func.distinct(TermAttendance.term_id)).label("terms_attended")
    last_term_on = func.max(Term.occurs_on).label("last_term_on")
    result = await db.execute(
        select(TermAttendance.party_id, terms_attended, last_term_on)
        .join(Term, Term.id == TermAttendance.term_id)
        .where(Term.circle_group_id == circle_group_id, TermAttendance.withdrawn_at.is_(None))
        .group_by(TermAttendance.party_id)
        .order_by(last_term_on.desc(), TermAttendance.party_id)
    )
    return list(result.all())


async def list_active_attendances_for_term(
    db: AsyncSession, term_id: uuid.UUID
) -> list[TermAttendance]:
    """Unlike `list_attendances_for_term` (public-view attendee list, keeps
    withdrawn rows), excludes withdrawn RSVPs — used to find who's currently
    eligible to browse/offer exchange-mechanism listings for this Term."""
    result = await db.execute(
        select(TermAttendance)
        .where(TermAttendance.term_id == term_id, TermAttendance.withdrawn_at.is_(None))
        .order_by(TermAttendance.created_at)
    )
    return list(result.scalars().all())


async def count_active_attendances_by_term(
    db: AsyncSession, term_ids: list[uuid.UUID]
) -> dict[uuid.UUID, tuple[int, int]]:
    """`{term_id: (attendee_count, child_count_sum)}` over non-withdrawn RSVPs
    (same filter as `list_active_attendances_for_term`), in one grouped
    query. Terms with no active RSVPs are absent from the result."""
    if not term_ids:
        return {}
    result = await db.execute(
        select(
            TermAttendance.term_id,
            func.count(),
            func.coalesce(func.sum(TermAttendance.child_count), 0),
        )
        .where(TermAttendance.term_id.in_(term_ids), TermAttendance.withdrawn_at.is_(None))
        .group_by(TermAttendance.term_id)
    )
    return {term_id: (int(count), int(children)) for term_id, count, children in result.all()}


async def list_my_attendances_joined(
    db: AsyncSession, party_id: uuid.UUID
) -> list[Row[tuple[TermAttendance, Term, Group]]]:
    """Excludes withdrawn attendances (`withdrawn_at IS NOT NULL`) — mirrors
    `list_my_pledges_joined`'s existing `Pledge.status != PledgeStatus.WITHDRAWN`
    precedent. Without this filter, "Wycofaj się z zajęć" would withdraw a
    `TermAttendance` but the row would keep showing up here, since this is
    the query `MyAttendanceResponse`/the frontend's `myAttendanceForCurrentTerm`
    derivation depends on (spec-audit HIGH finding #1)."""
    result = await db.execute(
        select(TermAttendance, Term, Group)
        .join(Term, TermAttendance.term_id == Term.id)
        .join(Group, Term.circle_group_id == Group.id)
        .where(
            TermAttendance.party_id == party_id,
            TermAttendance.withdrawn_at.is_(None),
            Group.deleted_at.is_(None),
        )
        .order_by(Term.occurs_on.asc(), TermAttendance.id.asc())
    )
    return list(result.all())


async def get_attendance(db: AsyncSession, attendance_id: uuid.UUID) -> TermAttendance | None:
    return await db.get(TermAttendance, attendance_id)


async def get_active_attendance(
    db: AsyncSession, term_id: uuid.UUID, party_id: uuid.UUID
) -> TermAttendance | None:
    result = await db.execute(
        select(TermAttendance).where(
            TermAttendance.term_id == term_id,
            TermAttendance.party_id == party_id,
            TermAttendance.withdrawn_at.is_(None),
        )
    )
    return result.scalar_one_or_none()


async def list_profile_names_by_party_ids(
    db: AsyncSession, party_ids: list[uuid.UUID]
) -> list[Row[tuple[uuid.UUID, str]]]:
    return list(
        (
            await db.execute(
                select(UserProfile.party_id, UserProfile.display_name).where(
                    UserProfile.party_id.in_(party_ids)
                )
            )
        ).all()
    )


async def list_profile_names_by_account_user_ids(
    db: AsyncSession, account_user_ids: Collection[uuid.UUID]
) -> list[Row[tuple[uuid.UUID | None, uuid.UUID, str]]]:
    """`(account_user_id, party_id, display_name)` of each account's profile."""
    if not account_user_ids:
        return []
    return list(
        (
            await db.execute(
                select(
                    UserProfile.account_user_id, UserProfile.party_id, UserProfile.display_name
                ).where(UserProfile.account_user_id.in_(set(account_user_ids)))
            )
        ).all()
    )


async def find_profile_by_email(db: AsyncSession, email: str) -> UserProfile | None:
    return (
        await db.execute(select(UserProfile).where(UserProfile.email == email))
    ).scalar_one_or_none()


# --- ItemListingPreference -----------------------------------------------------


async def get_item_listing_preference(
    db: AsyncSession, item_id: uuid.UUID
) -> ItemListingPreference | None:
    result = await db.execute(
        select(ItemListingPreference).where(ItemListingPreference.item_id == item_id)
    )
    return result.scalar_one_or_none()


async def lock_item_listing_preference(
    db: AsyncSession, item_id: uuid.UUID
) -> ItemListingPreference | None:
    """The item's listing preference re-read `FOR UPDATE` until the caller
    commits, so takes and proposals on one item run one at a time."""
    result = await db.execute(
        select(ItemListingPreference)
        .where(ItemListingPreference.item_id == item_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


def _visible_preferences(
    include_private: bool, private_circle_id: uuid.UUID | None = None
) -> ColumnElement[bool]:
    """Safe by default: PUBLIC preferences only unless the caller may see
    PRIVATE ones too. `private_circle_id` admits only the PRIVATE
    preferences of owners who are standing members or the current
    organizer of that circle (an RSVP is not membership, `can_view_item`)."""
    public = ItemListingPreference.visibility == ItemVisibility.PUBLIC
    if private_circle_id is not None:
        return or_(public, _owner_in_circle(private_circle_id))
    if include_private:
        return true()
    return public


def _owner_in_circle(group_id: uuid.UUID) -> ColumnElement[bool]:
    """The preference's owner is a standing member or the current organizer
    of `group_id`, correlated to `ItemListingPreference.owner_party_id`."""
    member = exists().where(
        Membership.to_group_id == group_id,
        Membership.valid_to.is_(None),
        GroupRole.id == Membership.from_role_id,
        GroupRole.party_id == ItemListingPreference.owner_party_id,
    )
    leads = exists().where(
        Leadership.to_group_id == group_id,
        Leadership.valid_to.is_(None),
        GroupRole.id == Leadership.from_role_id,
        GroupRole.party_id == ItemListingPreference.owner_party_id,
    )
    return or_(member, leads)


async def list_item_listing_preferences_for_party(
    db: AsyncSession, party_id: uuid.UUID, *, include_private: bool = False
) -> list[ItemListingPreference]:
    result = await db.execute(
        select(ItemListingPreference)
        .where(
            ItemListingPreference.owner_party_id == party_id,
            _visible_preferences(include_private),
        )
        .order_by(ItemListingPreference.id)
    )
    return list(result.scalars().all())


async def list_item_listing_preferences_for_parties(
    db: AsyncSession,
    party_ids: set[uuid.UUID],
    *,
    include_private: bool = False,
    private_circle_id: uuid.UUID | None = None,
) -> list[ItemListingPreference]:
    """`include_private`/`private_circle_id` as `_visible_preferences`."""
    if not party_ids:
        return []
    result = await db.execute(
        select(ItemListingPreference)
        .where(
            ItemListingPreference.owner_party_id.in_(party_ids),
            _visible_preferences(include_private, private_circle_id),
        )
        .order_by(ItemListingPreference.id)
    )
    return list(result.scalars().all())


def item_listing_preferences_select(
    party_ids: Collection[uuid.UUID],
    *,
    include_private: bool = False,
    private_circle_id: uuid.UUID | None = None,
) -> Select[tuple[uuid.UUID, uuid.UUID, str, datetime]]:
    """`(item_id, owner_party_id, mode, created_at)` of every listing
    preference owned by `party_ids`, PUBLIC ones only unless
    `include_private` or `private_circle_id` (`_visible_preferences`).
    Unexecuted, so another context can join it with its own item select in
    one statement."""
    return select(
        ItemListingPreference.item_id.label("item_id"),
        ItemListingPreference.owner_party_id.label("owner_party_id"),
        ItemListingPreference.mode.label("mode"),
        ItemListingPreference.created_at.label("created_at"),
    ).where(
        ItemListingPreference.owner_party_id.in_(set(party_ids)),
        _visible_preferences(include_private, private_circle_id),
    )


def _circle_ids_of(party_id: uuid.UUID) -> ColumnElement[bool]:
    """`Group.id` is a circle `party_id` is a standing member of or
    currently leads."""
    member_of = (
        select(Membership.to_group_id)
        .join(GroupRole, GroupRole.id == Membership.from_role_id)
        .where(GroupRole.party_id == party_id, Membership.valid_to.is_(None))
    )
    leads = (
        select(Leadership.to_group_id)
        .join(GroupRole, GroupRole.id == Leadership.from_role_id)
        .where(GroupRole.party_id == party_id, Leadership.valid_to.is_(None))
    )
    return or_(Group.id.in_(member_of), Group.id.in_(leads))


async def is_in_circle(db: AsyncSession, group_id: uuid.UUID, party_id: uuid.UUID) -> bool:
    """Whether `party_id` is a standing member or the current organizer of
    `group_id`. One statement."""
    return bool(
        await db.scalar(select(exists().where(Group.id == group_id, _circle_ids_of(party_id))))
    )


async def shares_private_circle(
    db: AsyncSession, party_id: uuid.UUID, other_party_id: uuid.UUID
) -> bool:
    """Whether both parties belong to one non-deleted PRIVATE circle, each
    as a standing member or its current organizer. One statement."""
    shared = exists().where(
        Group.visibility == GroupVisibility.PRIVATE,
        Group.deleted_at.is_(None),
        _circle_ids_of(party_id),
        _circle_ids_of(other_party_id),
    )
    return bool(await db.scalar(select(shared)))


def with_pending_proposer(listed_items: Select[Any]) -> Select[Any]:
    """`listed_items` (circulation's listed-items select, reserved items
    included) plus `proposer_party_id`: the proposer of the oldest still
    `PROPOSED` `SwapProposal` targeting the item, `None` without one.
    Unexecuted, for a list read to join."""
    listed = listed_items.subquery("listed")
    proposer = (
        select(SwapProposal.proposer_party_id)
        .where(
            SwapProposal.listing_item_id == listed.c.item_id,
            SwapProposal.status == SwapProposalStatus.PROPOSED,
        )
        .order_by(SwapProposal.created_at, SwapProposal.id)
        .limit(1)
        .correlate(listed)
        .scalar_subquery()
    )
    return select(listed, proposer.label("proposer_party_id"))


def _is_reserved(items: Subquery) -> ColumnElement[bool]:
    """A `with_pending_proposer` row is reserved while its balance is not
    AVAILABLE (RESERVED or IN_TRANSIT) or a swap proposal is pending."""
    # The string-backed `BalanceStatus` column binds its plain value.
    return or_(items.c.balance_status != "AVAILABLE", items.c.proposer_party_id.is_not(None))


async def list_listed_items_for_parties(
    db: AsyncSession,
    party_ids: Collection[uuid.UUID],
    listed_items: Select[Any],
    *,
    include_private: bool = False,
    private_circle_id: uuid.UUID | None = None,
) -> list[Row[Any]]:
    """`(item_id, owner_party_id, mode, created_at, product_id, product_name,
    condition, balance_status, reserved_by_user_id, proposer_party_id)` of
    every item `party_ids` list (PUBLIC ones only unless `include_private`
    or `private_circle_id`, `_visible_preferences`), in one statement: their
    listing preferences joined to `listed_items` (a `with_pending_proposer`
    select). Oldest preference first, then item id."""
    if not party_ids:
        return []
    preferences = item_listing_preferences_select(
        party_ids, include_private=include_private, private_circle_id=private_circle_id
    ).subquery("preferences")
    listed = listed_items.subquery("listed_items")
    result = await db.execute(
        select(
            preferences.c.item_id,
            preferences.c.owner_party_id,
            preferences.c.mode,
            preferences.c.created_at,
            listed.c.product_id,
            listed.c.product_name,
            listed.c.condition,
            listed.c.balance_status,
            listed.c.reserved_by_user_id,
            listed.c.proposer_party_id,
        )
        .join(listed, listed.c.item_id == preferences.c.item_id)
        .order_by(preferences.c.created_at, preferences.c.item_id)
    )
    return list(result.all())


# --- SwapProposal -----------------------------------------------------------


async def get_swap_proposal(db: AsyncSession, proposal_id: uuid.UUID) -> SwapProposal | None:
    return await db.get(SwapProposal, proposal_id)


async def lock_swap_proposal(db: AsyncSession, proposal_id: uuid.UUID) -> SwapProposal | None:
    """The proposal re-read `FOR UPDATE` until the caller commits, so a
    concurrent decision or event delete is either seen or waits."""
    return await db.get(SwapProposal, proposal_id, with_for_update=True, populate_existing=True)


async def list_listing_item_ids_with_pending_proposal(
    db: AsyncSession, listing_item_ids: Collection[uuid.UUID]
) -> set[uuid.UUID]:
    """Which of `listing_item_ids` a still-`PROPOSED` `SwapProposal`
    targets, in one query: such an item can no longer be taken or proposed
    for."""
    if not listing_item_ids:
        return set()
    result = await db.execute(
        select(SwapProposal.listing_item_id)
        .where(
            SwapProposal.listing_item_id.in_(set(listing_item_ids)),
            SwapProposal.status == SwapProposalStatus.PROPOSED,
        )
        .distinct()
    )
    return set(result.scalars().all())


async def list_pending_swap_proposals_for_listing_item(
    db: AsyncSession, listing_item_id: uuid.UUID
) -> list[SwapProposal]:
    """Every still-`PROPOSED` `SwapProposal` targeting this listing item —
    the owner's full set of pending offers to choose from
    (`list_swap_proposals_for_my_item`), oldest first."""
    result = await db.execute(
        select(SwapProposal)
        .where(
            SwapProposal.listing_item_id == listing_item_id,
            SwapProposal.status == SwapProposalStatus.PROPOSED,
        )
        .order_by(SwapProposal.created_at)
    )
    return list(result.scalars().all())


async def list_pending_swap_proposals_by_proposer(
    db: AsyncSession, proposer_party_id: uuid.UUID
) -> list[Row[tuple[SwapProposal, uuid.UUID]]]:
    """The proposer's still-`PROPOSED` offers, each with the target listing's
    owner party, in one join."""
    result = await db.execute(
        select(SwapProposal, ItemListingPreference.owner_party_id)
        .join(ItemListingPreference, ItemListingPreference.item_id == SwapProposal.listing_item_id)
        .where(
            SwapProposal.proposer_party_id == proposer_party_id,
            SwapProposal.status == SwapProposalStatus.PROPOSED,
        )
    )
    return list(result.all())


async def list_other_pending_swap_proposals_for_listing_item(
    db: AsyncSession, listing_item_id: uuid.UUID, exclude_proposal_id: uuid.UUID
) -> list[SwapProposal]:
    """Every still-`PROPOSED` `SwapProposal` targeting this listing item
    other than `exclude_proposal_id` — used by `accept_swap_proposal` to
    auto-reject every other pending offer once the owner picks one, instead
    of leaving them (and the losing proposers' locked offered items)
    hanging forever."""
    proposals = await list_pending_swap_proposals_for_listing_item(db, listing_item_id)
    return [p for p in proposals if p.id != exclude_proposal_id]


# --- Public organizer directory ----------------------------------------------
# Every query is batched over the organizer's circles or their terms, so the
# page's statement count does not grow with the number of circles. `now` is
# always a bound parameter (server-local naive time), never `func.now()`.


def _qualifying_owner_circles(owner_party_id: uuid.UUID) -> Select[tuple[uuid.UUID]]:
    """Ids of the PUBLIC circles the owner currently leads: an active
    `Leadership` from the owner's active ORGANIZATOR `GroupRole`."""
    return (
        select(Group.id)
        .join(Leadership, and_(Leadership.to_group_id == Group.id, Leadership.valid_to.is_(None)))
        .join(
            GroupRole,
            and_(
                GroupRole.id == Leadership.from_role_id,
                GroupRole.role_type == GroupRoleType.ORGANIZATOR,
                GroupRole.party_id == owner_party_id,
                GroupRole.valid_to.is_(None),
            ),
        )
        .where(Group.visibility == GroupVisibility.PUBLIC, Group.deleted_at.is_(None))
    )


async def party_leads_public_circle(db: AsyncSession, party_id: uuid.UUID) -> bool:
    result = await db.execute(select(exists(_qualifying_owner_circles(party_id))))
    return bool(result.scalar())


async def list_owner_public_circles(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    now: datetime,
    window_end: datetime,
    limit: int = 30,
) -> list[Row[tuple[uuid.UUID, str, GroupLayoutMode, uuid.UUID | None, datetime | None, int]]]:
    """`(group_id, name, layout_mode, next_term_id, next_occurs_on,
    window_term_count)` for `_qualifying_owner_circles`.
    The next term comes from a per-circle LATERAL lookup and the window count
    from a correlated subquery, both served by `ix_terms_circle_group_id_occurs_on`."""
    next_term = (
        select(Term.id.label("term_id"), Term.occurs_on.label("occurs_on"))
        .where(Term.circle_group_id == Group.id, Term.occurs_on >= now)
        .order_by(Term.occurs_on, Term.id)
        .limit(1)
        .lateral("next_term")
    )
    window_term_count = (
        select(func.count())
        .select_from(Term)
        .where(
            Term.circle_group_id == Group.id,
            Term.occurs_on >= now,
            Term.occurs_on < window_end,
        )
        .scalar_subquery()
    )
    result = await db.execute(
        select(
            Group.id,
            Group.name,
            Group.layout_mode,
            next_term.c.term_id,
            next_term.c.occurs_on,
            window_term_count,
        )
        .outerjoin(next_term, true())
        .where(Group.id.in_(_qualifying_owner_circles(owner_party_id)))
        .order_by(next_term.c.occurs_on.asc().nulls_last(), Group.name, Group.id)
        .limit(limit)
    )
    return list(result.all())


def _owner_public_terms_select(
    owner_party_id: uuid.UUID, now: datetime, group_id: uuid.UUID | None
) -> Select[tuple[uuid.UUID, uuid.UUID, str, datetime, str | None]]:
    """`(term_id, group_id, group_name, occurs_on, description)` of every
    upcoming term in `_qualifying_owner_circles`, optionally narrowed to
    `group_id`. Unordered: the count and the page build on it."""
    query = (
        select(Term.id, Term.circle_group_id, Group.name, Term.occurs_on, Term.description)
        .join(Group, Group.id == Term.circle_group_id)
        .where(
            Term.circle_group_id.in_(_qualifying_owner_circles(owner_party_id)),
            Term.occurs_on >= now,
        )
    )
    if group_id is not None:
        query = query.where(Term.circle_group_id == group_id)
    return query


async def count_owner_public_terms(
    db: AsyncSession, owner_party_id: uuid.UUID, now: datetime, group_id: uuid.UUID | None
) -> int:
    terms = _owner_public_terms_select(owner_party_id, now, group_id).subquery()
    return (await db.execute(select(func.count()).select_from(terms))).scalar_one()


async def list_owner_public_terms_page(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    now: datetime,
    group_id: uuid.UUID | None,
    offset: int,
    limit: int,
) -> list[Row[tuple[uuid.UUID, uuid.UUID, str, datetime, str | None]]]:
    """One page of `_owner_public_terms_select`, soonest first."""
    result = await db.execute(
        _owner_public_terms_select(owner_party_id, now, group_id)
        .order_by(Term.occurs_on, Term.id)
        .offset(offset)
        .limit(limit)
    )
    return list(result.all())


async def list_upcoming_terms_for_groups(
    db: AsyncSession,
    group_ids: list[uuid.UUID],
    now: datetime,
    window_end: datetime,
    limit: int = 10,
) -> list[Row[tuple[uuid.UUID, uuid.UUID, str, datetime, str | None]]]:
    """`(term_id, group_id, group_name, occurs_on, description)` of the
    window's terms, soonest first."""
    result = await db.execute(
        select(Term.id, Term.circle_group_id, Group.name, Term.occurs_on, Term.description)
        .join(Group, Group.id == Term.circle_group_id)
        .where(
            Term.circle_group_id.in_(group_ids),
            Term.occurs_on >= now,
            Term.occurs_on < window_end,
        )
        .order_by(Term.occurs_on, Term.id)
        .limit(limit)
    )
    return list(result.all())


async def count_member_families_for_groups(
    db: AsyncSession, group_ids: list[uuid.UUID], exclude_party_id: uuid.UUID
) -> int:
    """Distinct families (any family role) of the parties holding an active
    `Membership` in `group_ids`, leaving out every family `exclude_party_id`
    belongs to."""
    excluded_families = (
        select(FamilyMembership.to_family_id)
        .join(FamilyRole, FamilyRole.id == FamilyMembership.from_role_id)
        .where(
            FamilyRole.party_id == exclude_party_id,
            FamilyRole.valid_to.is_(None),
            FamilyMembership.valid_to.is_(None),
        )
    )
    count = await db.scalar(
        select(func.count(func.distinct(FamilyMembership.to_family_id)))
        .select_from(Membership)
        .join(GroupRole, GroupRole.id == Membership.from_role_id)
        .join(
            FamilyRole,
            and_(FamilyRole.party_id == GroupRole.party_id, FamilyRole.valid_to.is_(None)),
        )
        .join(
            FamilyMembership,
            and_(
                FamilyMembership.from_role_id == FamilyRole.id,
                FamilyMembership.valid_to.is_(None),
            ),
        )
        .where(
            Membership.to_group_id.in_(group_ids),
            Membership.valid_to.is_(None),
            FamilyMembership.to_family_id.not_in(excluded_families),
        )
    )
    return int(count or 0)


async def list_needed_items_for_terms(
    db: AsyncSession, term_ids: list[uuid.UUID], limit: int
) -> list[Row[tuple[uuid.UUID, uuid.UUID, uuid.UUID, str, bool]]]:
    """`(needed_item_id, term_id, group_id, name, claimed)` for the
    first `limit` live needs of `term_ids`, soonest term first; `claimed`
    uses the same rule as the term page (a pledge that is not WITHDRAWN).
    Never carries the pledger."""
    claimed = exists().where(
        Pledge.needed_item_id == NeededItem.id, Pledge.status != PledgeStatus.WITHDRAWN
    )
    result = await db.execute(
        select(
            NeededItem.id,
            NeededItem.term_id,
            Term.circle_group_id,
            NeededItem.name,
            claimed.label("claimed"),
        )
        .join(Term, Term.id == NeededItem.term_id)
        .where(NeededItem.term_id.in_(term_ids), NeededItem.deleted_at.is_(None))
        .order_by(Term.occurs_on, NeededItem.name, NeededItem.id)
        .limit(limit)
    )
    return list(result.all())


def _exchange_candidates(
    owner_party_id: uuid.UUID,
    term_ids: list[uuid.UUID],
    listed_items: Select[Any],
) -> Subquery:
    """`(item_id, mode, product_id, product_name, condition, occurs_on,
    term_id, group_id, balance_status, reserved_by_user_id,
    proposer_party_id)`: one row per PUBLIC item of `listed_items` (a
    `with_pending_proposer` select) listed by a party eligible on some term
    of `term_ids` (the owner on every one, an attendee on those they hold a
    non-withdrawn RSVP for, as on the term page), placed on that party's
    nearest such term, ties broken by term id."""
    lister_terms = union_all(
        select(
            literal(owner_party_id, postgresql.UUID(as_uuid=True)).label("party_id"),
            Term.id.label("term_id"),
            Term.occurs_on.label("occurs_on"),
            Term.circle_group_id.label("group_id"),
        ).where(Term.id.in_(term_ids)),
        select(TermAttendance.party_id, Term.id, Term.occurs_on, Term.circle_group_id)
        .join(Term, Term.id == TermAttendance.term_id)
        .where(TermAttendance.term_id.in_(term_ids), TermAttendance.withdrawn_at.is_(None)),
    ).subquery("lister_terms")
    nearest_term = (
        select(lister_terms)
        .distinct(lister_terms.c.party_id)
        .order_by(lister_terms.c.party_id, lister_terms.c.occurs_on, lister_terms.c.term_id)
        .subquery("nearest_term")
    )
    listed = listed_items.subquery("listed_items")
    return (
        select(
            ItemListingPreference.item_id,
            ItemListingPreference.mode,
            listed.c.product_id,
            listed.c.product_name,
            listed.c.condition,
            nearest_term.c.occurs_on,
            nearest_term.c.term_id,
            nearest_term.c.group_id,
            listed.c.balance_status,
            listed.c.reserved_by_user_id,
            listed.c.proposer_party_id,
        )
        .join(nearest_term, nearest_term.c.party_id == ItemListingPreference.owner_party_id)
        .join(listed, listed.c.item_id == ItemListingPreference.item_id)
        .where(ItemListingPreference.visibility == ItemVisibility.PUBLIC)
        .subquery("exchange_candidates")
    )


async def count_exchange_items(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    term_ids: list[uuid.UUID],
    listed_items: Select[Any],
) -> dict[str, int]:
    """`_exchange_candidates` counted per bucket: `RESERVED` for the
    reserved ones, else their listing mode (`GIFT`/`SWAP`)."""
    candidates = _exchange_candidates(owner_party_id, term_ids, listed_items)
    bucket = case((_is_reserved(candidates), literal("RESERVED")), else_=candidates.c.mode)
    result = await db.execute(select(bucket, func.count()).group_by(bucket))
    return {name: count for name, count in result.all()}


async def list_nearest_exchange_items(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    term_ids: list[uuid.UUID],
    listed_items: Select[Any],
    limit: int,
) -> list[Row[Any]]:
    """The first `limit` `_exchange_candidates` by term date, then product
    name in code-point order (`COLLATE "C"`), then item id."""
    candidates = _exchange_candidates(owner_party_id, term_ids, listed_items)
    result = await db.execute(
        select(candidates)
        .order_by(
            candidates.c.occurs_on,
            candidates.c.product_name.collate("C"),
            candidates.c.item_id,
        )
        .limit(limit)
    )
    return list(result.all())


# --- Owner items page ------------------------------------------------------------
# One owner's listed items (a listing preference on a live AVAILABLE,
# RESERVED or IN_TRANSIT item; the preference exists exactly while the item's
# `listing_status` is ACTIVE) and the owner's nearest public term. Counts,
# page and nearest term are one statement each, whatever the number of items.


def _owner_listed_items(owner_party_id: uuid.UUID, listed_items: Select[Any]) -> Subquery:
    """`(item_id, mode, created_at, product_id, product_name, condition,
    balance_status, reserved_by_user_id, proposer_party_id)`, from a
    `with_pending_proposer` select."""
    preferences = item_listing_preferences_select([owner_party_id]).subquery("preferences")
    listed = listed_items.subquery("listed_items")
    return (
        select(
            preferences.c.item_id,
            preferences.c.mode,
            preferences.c.created_at,
            listed.c.product_id,
            listed.c.product_name,
            listed.c.condition,
            listed.c.balance_status,
            listed.c.reserved_by_user_id,
            listed.c.proposer_party_id,
        )
        .join(listed, listed.c.item_id == preferences.c.item_id)
        .subquery("owner_listed_items")
    )


async def count_owner_listed_items_by_mode(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    listed_items: Select[Any],
) -> dict[str, int]:
    """Listing mode -> number of the owner's listed items, reserved ones
    included."""
    listed = _owner_listed_items(owner_party_id, listed_items)
    result = await db.execute(select(listed.c.mode, func.count()).group_by(listed.c.mode))
    return {mode: count for mode, count in result.all()}


async def list_owner_listed_items_page(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    listed_items: Select[Any],
    mode: str | None,
    offset: int,
    limit: int,
) -> list[Row[Any]]:
    """One page of the owner's listed items, optionally of one `mode`,
    newest preference first, then item id."""
    listed = _owner_listed_items(owner_party_id, listed_items)
    query = select(listed).order_by(listed.c.created_at.desc(), listed.c.item_id)
    if mode is not None:
        query = query.where(listed.c.mode == mode)
    result = await db.execute(query.offset(offset).limit(limit))
    return list(result.all())


async def list_upcoming_public_terms_for_party(
    db: AsyncSession, party_id: uuid.UUID, now: datetime, limit: int
) -> Sequence[Row[tuple[uuid.UUID, uuid.UUID, str, datetime, uuid.UUID | None, int]]]:
    """`(term_id, group_id, group_name, occurs_on, location_id,
    attendee_count)` of the `limit` earliest terms at or after `now` in a
    PUBLIC, non-deleted circle the party currently leads or holds a
    non-withdrawn RSVP for, earliest first."""
    attending = exists().where(
        TermAttendance.term_id == Term.id,
        TermAttendance.party_id == party_id,
        TermAttendance.withdrawn_at.is_(None),
    )
    attendee_count = (
        select(func.count())
        .where(TermAttendance.term_id == Term.id, TermAttendance.withdrawn_at.is_(None))
        .correlate(Term)
        .scalar_subquery()
    )
    result = await db.execute(
        select(
            Term.id,
            Term.circle_group_id,
            Group.name,
            Term.occurs_on,
            Term.location_id,
            attendee_count,
        )
        .join(Group, Group.id == Term.circle_group_id)
        .where(
            Group.visibility == GroupVisibility.PUBLIC,
            Group.deleted_at.is_(None),
            Term.occurs_on >= now,
            or_(Term.circle_group_id.in_(_qualifying_owner_circles(party_id)), attending),
        )
        .order_by(Term.occurs_on, Term.id)
        .limit(limit)
    )
    return result.all()


def _leads_term_circle(party_id: uuid.UUID) -> Any:
    """`Term`'s circle is currently led by `party_id` — the SQL twin of
    `attendance._is_term_organizer` (active `Leadership` -> `GroupRole`)."""
    return exists().where(
        Leadership.to_group_id == Term.circle_group_id,
        Leadership.valid_to.is_(None),
        GroupRole.id == Leadership.from_role_id,
        GroupRole.party_id == party_id,
    )


def _attends_term(party_id: uuid.UUID) -> Any:
    return exists().where(
        TermAttendance.term_id == Term.id,
        TermAttendance.party_id == party_id,
        TermAttendance.withdrawn_at.is_(None),
    )


async def list_upcoming_owner_terms_for_viewer(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    viewer_party_id: uuid.UUID | None,
    now: datetime,
    limit: int = 5,
    *,
    private_only: bool = False,
) -> list[Row[tuple[uuid.UUID, uuid.UUID, str, GroupVisibility, datetime, uuid.UUID | None, bool]]]:
    """`(term_id, group_id, group_name, visibility, occurs_on, location_id,
    viewer_eligible)` of the terms at or after `now` in a non-deleted circle
    the owner leads or holds a non-withdrawn RSVP for — the write path's
    `_require_term_eligibility` — that the viewer may see: a PUBLIC circle,
    or one where the viewer passes that same rule (`viewer_eligible`).
    `private_only` (a PRIVATE item) keeps PRIVATE circles the owner is a
    standing member or organizer of, never one they only RSVP to
    (`can_view_item`). The filters
    run before `ORDER BY occurs_on LIMIT`, in one statement; an anonymous
    viewer is never eligible."""
    viewer_eligible: Any = (
        literal(False)
        if viewer_party_id is None
        else or_(_leads_term_circle(viewer_party_id), _attends_term(viewer_party_id))
    )
    result = await db.execute(
        select(
            Term.id,
            Term.circle_group_id.label("group_id"),
            Group.name,
            Group.visibility,
            Term.occurs_on,
            Term.location_id,
            viewer_eligible.label("viewer_eligible"),
        )
        .join(Group, Group.id == Term.circle_group_id)
        .where(
            Group.deleted_at.is_(None),
            Term.occurs_on >= now,
            or_(_leads_term_circle(owner_party_id), _attends_term(owner_party_id)),
            or_(Group.visibility == GroupVisibility.PUBLIC, viewer_eligible),
            (
                and_(Group.visibility == GroupVisibility.PRIVATE, _circle_ids_of(owner_party_id))
                if private_only
                else true()
            ),
        )
        .order_by(Term.occurs_on, Term.id)
        .limit(limit)
    )
    return list(result.all())
