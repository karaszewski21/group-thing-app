"""Read-side queries for `app.groups`: every `select()` / `db.get()` for
`Group` / `GroupRole` / `Leadership` / `Membership` / `Term` /
`NeededItem` / `Pledge` / `TermAttendance` and the public-view
`UserProfile` join, relocated verbatim into named functions. Eager-loading
and ordering options are preserved exactly per `standards/backend/queries.md`.
Never commits or flushes; `EntityNotFoundException` raising stays in the
`application/` getter wrappers."""

from __future__ import annotations

from sqlalchemy import Row, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.category.models import Category
from app.product.models import Product
from app.users.models import UserProfile

from ..models import (
    Group,
    GroupRole,
    GroupRoleType,
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
    result = await db.execute(select(Group).order_by(Group.created_at.desc()))
    return list(result.scalars().all())


async def get_group(db: AsyncSession, group_id: int) -> Group | None:
    return await db.get(Group, group_id)


async def list_groups_for_moderation(
    db: AsyncSession,
) -> list[Row[tuple[Group, str | None, str | None, int, int]]]:
    """One aggregated query — `LEFT JOIN`/`GROUP BY` subqueries for member
    and term counts plus the current organizer's `UserProfile`, per
    `standards/backend/queries.md` (mirrors `app.category.service.
    list_categories`'s product-count pattern). Never one query per Circle."""
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
    result = await db.execute(
        select(
            Group,
            organizers.c.display_name,
            organizers.c.email,
            func.coalesce(member_counts.c.member_count, 0),
            func.coalesce(term_counts.c.term_count, 0),
        )
        .outerjoin(member_counts, member_counts.c.to_group_id == Group.id)
        .outerjoin(term_counts, term_counts.c.circle_group_id == Group.id)
        .outerjoin(organizers, organizers.c.to_group_id == Group.id)
        .order_by(Group.created_at.desc())
    )
    return list(result.all())


# --- GroupRole -------------------------------------------------------------------


async def find_active_group_role(
    db: AsyncSession, party_id: int, role_type: GroupRoleType
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


async def get_group_role(db: AsyncSession, group_role_id: int) -> GroupRole | None:
    return await db.get(GroupRole, group_role_id)


# --- Leadership -------------------------------------------------------------------


async def get_leadership(db: AsyncSession, leadership_id: int) -> Leadership | None:
    return await db.get(Leadership, leadership_id)


async def find_current_leadership(db: AsyncSession, group_id: int) -> Leadership | None:
    result = await db.execute(
        select(Leadership).where(Leadership.to_group_id == group_id, Leadership.valid_to.is_(None))
    )
    return result.scalar_one_or_none()


async def list_leaderships_for_group(db: AsyncSession, group_id: int) -> list[Leadership]:
    result = await db.execute(
        select(Leadership)
        .where(Leadership.to_group_id == group_id)
        .order_by(Leadership.valid_from.desc())
    )
    return list(result.scalars().all())


async def list_organizer_role_ids_for_party(db: AsyncSession, party_id: int) -> list[int]:
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
    db: AsyncSession, role_ids: list[int]
) -> list[Leadership]:
    result = await db.execute(
        select(Leadership).where(
            Leadership.from_role_id.in_(role_ids), Leadership.valid_to.is_(None)
        )
    )
    return list(result.scalars().all())


# --- Membership -------------------------------------------------------------------


async def get_membership(db: AsyncSession, membership_id: int) -> Membership | None:
    return await db.get(Membership, membership_id)


async def list_active_memberships_for_group(
    db: AsyncSession, circle_group_id: int
) -> list[Membership]:
    result = await db.execute(
        select(Membership)
        .where(Membership.to_group_id == circle_group_id, Membership.valid_to.is_(None))
        .order_by(Membership.valid_from.desc())
    )
    return list(result.scalars().all())


async def list_member_role_ids_for_party(db: AsyncSession, party_id: int) -> list[int]:
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
    db: AsyncSession, role_ids: list[int]
) -> list[Membership]:
    result = await db.execute(
        select(Membership).where(
            Membership.from_role_id.in_(role_ids), Membership.valid_to.is_(None)
        )
    )
    return list(result.scalars().all())


# --- Term / NeededItem ----------------------------------------------------------


async def get_term(db: AsyncSession, term_id: int) -> Term | None:
    return await db.get(Term, term_id)


async def list_terms_for_group(db: AsyncSession, circle_group_id: int) -> list[Term]:
    result = await db.execute(
        select(Term).where(Term.circle_group_id == circle_group_id).order_by(Term.occurs_on.desc())
    )
    return list(result.scalars().all())


async def get_needed_item(db: AsyncSession, needed_item_id: int) -> NeededItem | None:
    return await db.get(NeededItem, needed_item_id)


async def list_needed_items_for_term(db: AsyncSession, term_id: int) -> list[NeededItem]:
    result = await db.execute(
        select(NeededItem)
        .where(NeededItem.term_id == term_id, NeededItem.deleted_at.is_(None))
        .order_by(NeededItem.id)
    )
    return list(result.scalars().all())


async def get_needed_item_with_product(
    db: AsyncSession, needed_item_id: int
) -> Row[tuple[NeededItem, str, int, str]] | None:
    """`NeededItem` + its product's name/category via an explicit join
    scoped to this one read (`standards/backend/models.md` cross-module
    rule — no `relationship()` into `app.product` or `app.category`)."""
    result = await db.execute(
        select(NeededItem, Product.name, Category.id, Category.name)
        .join(Product, NeededItem.product_id == Product.id)
        .join(Category, Product.category_id == Category.id)
        .where(NeededItem.id == needed_item_id)
    )
    return result.one_or_none()


async def list_needed_items_with_product_for_term(
    db: AsyncSession, term_id: int
) -> list[Row[tuple[NeededItem, str, int, str]]]:
    result = await db.execute(
        select(NeededItem, Product.name, Category.id, Category.name)
        .join(Product, NeededItem.product_id == Product.id)
        .join(Category, Product.category_id == Category.id)
        .where(NeededItem.term_id == term_id, NeededItem.deleted_at.is_(None))
        .order_by(NeededItem.id)
    )
    return list(result.all())


# --- Pledge -------------------------------------------------------------------


async def get_pledge(db: AsyncSession, pledge_id: int) -> Pledge | None:
    return await db.get(Pledge, pledge_id)


async def list_pledges_for_needed_item(db: AsyncSession, needed_item_id: int) -> list[Pledge]:
    result = await db.execute(select(Pledge).where(Pledge.needed_item_id == needed_item_id))
    return list(result.scalars().all())


async def list_active_pledges_for_term(
    db: AsyncSession, term_id: int
) -> list[Row[tuple[int, str, int]]]:
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
    db: AsyncSession, party_id: int
) -> list[Row[tuple[Pledge, str, str | None, Term, Group]]]:
    """The caller's own non-withdrawn pledges + the product name / need
    refinement / term / circle, one explicit multi-entity join (these
    entities carry no `relationship()` — same form as
    `list_my_attendances_joined`). Live needs only (`deleted_at IS NULL`),
    SQL-level ordering by class date."""
    result = await db.execute(
        select(Pledge, Product.name, NeededItem.description, Term, Group)
        .join(NeededItem, Pledge.needed_item_id == NeededItem.id)
        .join(Product, NeededItem.product_id == Product.id)
        .join(Term, NeededItem.term_id == Term.id)
        .join(Group, Term.circle_group_id == Group.id)
        .where(
            Pledge.pledged_by_party_id == party_id,
            Pledge.status != PledgeStatus.WITHDRAWN,
            NeededItem.deleted_at.is_(None),
        )
        .order_by(Term.occurs_on.asc(), Pledge.id.asc())
    )
    return list(result.all())


# --- Public circle-view -------------------------------------------------------


async def list_attendances_for_term(db: AsyncSession, term_id: int) -> list[TermAttendance]:
    result = await db.execute(
        select(TermAttendance)
        .where(TermAttendance.term_id == term_id)
        .order_by(TermAttendance.created_at)
    )
    return list(result.scalars().all())


async def list_active_attendances_for_term(db: AsyncSession, term_id: int) -> list[TermAttendance]:
    """Unlike `list_attendances_for_term` (public-view attendee list, keeps
    withdrawn rows), excludes withdrawn RSVPs — used to find who's currently
    eligible to browse/offer exchange-mechanism listings for this Term."""
    result = await db.execute(
        select(TermAttendance)
        .where(TermAttendance.term_id == term_id, TermAttendance.withdrawn_at.is_(None))
        .order_by(TermAttendance.created_at)
    )
    return list(result.scalars().all())


async def list_my_attendances_joined(
    db: AsyncSession, party_id: int
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
        .where(TermAttendance.party_id == party_id, TermAttendance.withdrawn_at.is_(None))
        .order_by(Term.occurs_on.asc(), TermAttendance.id.asc())
    )
    return list(result.all())


async def get_attendance(db: AsyncSession, attendance_id: int) -> TermAttendance | None:
    return await db.get(TermAttendance, attendance_id)


async def get_active_attendance(
    db: AsyncSession, term_id: int, party_id: int
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
    db: AsyncSession, party_ids: list[int]
) -> list[Row[tuple[int, str]]]:
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
    db: AsyncSession, item_id: int
) -> ItemListingPreference | None:
    result = await db.execute(
        select(ItemListingPreference).where(ItemListingPreference.item_id == item_id)
    )
    return result.scalar_one_or_none()


async def list_item_listing_preferences_for_party(
    db: AsyncSession, party_id: int
) -> list[ItemListingPreference]:
    result = await db.execute(
        select(ItemListingPreference)
        .where(ItemListingPreference.owner_party_id == party_id)
        .order_by(ItemListingPreference.id)
    )
    return list(result.scalars().all())


async def list_item_listing_preferences_for_parties(
    db: AsyncSession, party_ids: set[int]
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


async def get_swap_proposal(db: AsyncSession, proposal_id: int) -> SwapProposal | None:
    return await db.get(SwapProposal, proposal_id)


async def get_active_swap_proposal_for_listing_item(
    db: AsyncSession, listing_item_id: int
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
        .order_by(SwapProposal.id.desc())
    )
    return result.scalars().first()


async def get_swap_proposal_for_item(db: AsyncSession, item_id: int) -> SwapProposal | None:
    """The most recent `SwapProposal` (of either status) touching
    `item_id` as either its listing leg or its offered leg — used by
    `confirm_transaction` to identify which stable party (listing owner vs
    proposer) originally held a given SWAP reservation's item, since the
    item's *current* physical owner is no longer meaningful once a leg has
    already been fulfilled (permanent change of possession)."""
    result = await db.execute(
        select(SwapProposal)
        .where(
            or_(SwapProposal.listing_item_id == item_id, SwapProposal.offered_item_id == item_id)
        )
        .order_by(SwapProposal.id.desc())
    )
    return result.scalars().first()
