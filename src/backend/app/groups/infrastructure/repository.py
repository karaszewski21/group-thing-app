"""Read-side queries for `app.groups`: every `select()` / `db.get()` for
`Group` / `GroupRole` / `Leadership` / `Membership` / `Term` /
`NeededItem` / `Pledge` / `TermAttendance` and the public-view
`UserProfile` join, relocated verbatim into named functions. Eager-loading
and ordering options are preserved exactly per `standards/backend/queries.md`.
Never commits or flushes; `EntityNotFoundException` raising stays in the
`application/` getter wrappers."""

from __future__ import annotations

from sqlalchemy import Row, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.product.models import Product, ProductCategory
from app.users.models import UserProfile

from ..models import (
    Group,
    GroupRole,
    GroupRoleType,
    Leadership,
    Membership,
    NeededItem,
    Pledge,
    Term,
    TermAttendance,
)

# --- Group -------------------------------------------------------------------


async def list_groups(db: AsyncSession) -> list[Group]:
    result = await db.execute(select(Group).order_by(Group.created_at.desc()))
    return list(result.scalars().all())


async def get_group(db: AsyncSession, group_id: int) -> Group | None:
    return await db.get(Group, group_id)


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
) -> Row[tuple[NeededItem, str, ProductCategory]] | None:
    """`NeededItem` + its product's name/category via an explicit join
    scoped to this one read (`standards/backend/models.md` cross-module
    rule — no `relationship()` into `app.product`)."""
    result = await db.execute(
        select(NeededItem, Product.name, Product.category)
        .join(Product, NeededItem.product_id == Product.id)
        .where(NeededItem.id == needed_item_id)
    )
    return result.one_or_none()


async def list_needed_items_with_product_for_term(
    db: AsyncSession, term_id: int
) -> list[Row[tuple[NeededItem, str, ProductCategory]]]:
    result = await db.execute(
        select(NeededItem, Product.name, Product.category)
        .join(Product, NeededItem.product_id == Product.id)
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


# --- Public circle-view -------------------------------------------------------


async def list_attendances_for_term(db: AsyncSession, term_id: int) -> list[TermAttendance]:
    result = await db.execute(
        select(TermAttendance)
        .where(TermAttendance.term_id == term_id)
        .order_by(TermAttendance.created_at)
    )
    return list(result.scalars().all())


async def list_my_attendances_joined(
    db: AsyncSession, party_id: int
) -> list[Row[tuple[TermAttendance, Term, Group]]]:
    result = await db.execute(
        select(TermAttendance, Term, Group)
        .join(Term, TermAttendance.term_id == Term.id)
        .join(Group, Term.circle_group_id == Group.id)
        .where(TermAttendance.party_id == party_id)
        .order_by(Term.occurs_on.asc(), TermAttendance.id.asc())
    )
    return list(result.all())


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
