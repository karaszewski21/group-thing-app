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
from collections.abc import Collection
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Row,
    Select,
    Subquery,
    and_,
    exists,
    func,
    literal,
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
    result = await db.execute(
        select(Leadership.to_group_id)
        .join(GroupRole, GroupRole.id == Leadership.from_role_id)
        .where(
            GroupRole.party_id == party_id,
            GroupRole.role_type == GroupRoleType.ORGANIZATOR,
            Leadership.valid_to.is_(None),
        )
    )
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


async def list_item_listing_preferences_for_party(
    db: AsyncSession, party_id: uuid.UUID
) -> list[ItemListingPreference]:
    result = await db.execute(
        select(ItemListingPreference)
        .where(ItemListingPreference.owner_party_id == party_id)
        .order_by(ItemListingPreference.id)
    )
    return list(result.scalars().all())


async def list_item_listing_preferences_for_parties(
    db: AsyncSession, party_ids: set[uuid.UUID]
) -> list[ItemListingPreference]:
    if not party_ids:
        return []
    result = await db.execute(
        select(ItemListingPreference)
        .where(ItemListingPreference.owner_party_id.in_(party_ids))
        .order_by(ItemListingPreference.id)
    )
    return list(result.scalars().all())


# --- SwapProposal -----------------------------------------------------------


async def get_swap_proposal(db: AsyncSession, proposal_id: uuid.UUID) -> SwapProposal | None:
    return await db.get(SwapProposal, proposal_id)


async def get_active_swap_proposal_for_listing_item(
    db: AsyncSession, listing_item_id: uuid.UUID
) -> SwapProposal | None:
    """The latest not-yet-`REJECTED` `SwapProposal` targeting this listing
    item, if any — used by `_resolve_listing_status`'s fallback to
    recognize a `PROPOSED` swap (which, unlike an accepted one, leaves no
    `Reservation` on the listing item itself yet, so the reservation-history
    scan alone would otherwise miss it)."""
    result = await db.execute(
        select(SwapProposal)
        .where(
            SwapProposal.listing_item_id == listing_item_id,
            SwapProposal.status.in_((SwapProposalStatus.PROPOSED, SwapProposalStatus.ACCEPTED)),
        )
        .order_by(SwapProposal.created_at.desc(), SwapProposal.id.desc())
    )
    return result.scalars().first()


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
    available_items: Select[tuple[uuid.UUID, uuid.UUID, str, Any]],
) -> Subquery:
    """`(item_id, mode, product_id, product_name, condition, occurs_on,
    term_id, group_id)`: one row per item of `available_items` listed by a
    party eligible on some term of `term_ids` (the owner on every one, an
    attendee on those they hold a non-withdrawn RSVP for, as on the term
    page), placed on that party's nearest such term, ties broken by term id."""
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
    available = available_items.subquery("available_items")
    return (
        select(
            ItemListingPreference.item_id,
            ItemListingPreference.mode,
            available.c.product_id,
            available.c.product_name,
            available.c.condition,
            nearest_term.c.occurs_on,
            nearest_term.c.term_id,
            nearest_term.c.group_id,
        )
        .join(nearest_term, nearest_term.c.party_id == ItemListingPreference.owner_party_id)
        .join(available, available.c.item_id == ItemListingPreference.item_id)
        .subquery("exchange_candidates")
    )


async def count_exchange_items_by_mode(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    term_ids: list[uuid.UUID],
    available_items: Select[tuple[uuid.UUID, uuid.UUID, str, Any]],
) -> dict[str, int]:
    """Listing mode -> number of `_exchange_candidates`."""
    candidates = _exchange_candidates(owner_party_id, term_ids, available_items)
    result = await db.execute(select(candidates.c.mode, func.count()).group_by(candidates.c.mode))
    return {mode: count for mode, count in result.all()}


async def list_nearest_exchange_items(
    db: AsyncSession,
    owner_party_id: uuid.UUID,
    term_ids: list[uuid.UUID],
    available_items: Select[tuple[uuid.UUID, uuid.UUID, str, Any]],
    limit: int,
) -> list[Row[tuple[uuid.UUID, str, uuid.UUID, str, str, datetime, uuid.UUID, uuid.UUID]]]:
    """The first `limit` `_exchange_candidates` by term date, then product
    name in code-point order (`COLLATE "C"`), then item id."""
    candidates = _exchange_candidates(owner_party_id, term_ids, available_items)
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
