"""`app.groups` business logic: Circle CRUD, leadership transfer (strictly
1:N), membership join/leave (N:N, per individual `GroupRole`), Term/
NeededItem/Pledge, and the Pledge->Reservation bridge into
`app.circulation` (one-directional dependency only).

Ownership checks the coarse `AUTHORIZATION_MATRIX` can't express (only the
active organizer of a Circle may create its Terms, only the pledging party
may withdraw/fulfill their own Pledge, ...) live here, raising
`AccessDeniedException` — per `standards/backend/security.md`'s guidance.
"""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.circulation import service as circulation_service
from app.circulation.models import ReservationStatus
from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.party.models import PartyType
from app.party.service import create_party
from app.users.service import get_profile_by_party, get_profile_by_principal

from .models import (
    Group,
    GroupRole,
    GroupRoleType,
    Leadership,
    Membership,
    NeededItem,
    Pledge,
    PledgeStatus,
    Term,
)
from .schemas import (
    CreateCircleRequest,
    CreateMembershipRequest,
    CreateNeededItemRequest,
    CreateTermRequest,
    FulfillPledgeRequest,
)

# --- Groups (Circles) ---------------------------------------------------------


async def create_circle(db: AsyncSession, data: CreateCircleRequest) -> Group:
    party = await create_party(db, PartyType.ORGANIZATION)
    group = Group(party_id=cast(int, party.id), name=data.name)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


async def create_own_circle(db: AsyncSession, organizer_party_id: int, circle_name: str) -> Group:
    """Self-service 'become an Organizer': creates a brand-new Circle and
    assigns `organizer_party_id` as its leader in one call. Callers must
    always derive `organizer_party_id` from the authenticated `Principal`
    (via `app.users.service.get_profile_by_principal`) — never from
    caller-supplied input — since `assign_leadership` itself performs no
    ownership check on who it's assigning."""
    circle = await create_circle(db, CreateCircleRequest(name=circle_name))
    role = await get_or_create_active_group_role(db, organizer_party_id, GroupRoleType.ORGANIZATOR)
    leadership = Leadership(
        from_role_id=cast(int, role.id),
        to_group_id=cast(int, circle.id),
        valid_from=date.today(),
        valid_to=None,
    )
    db.add(leadership)
    await db.commit()
    return circle


async def list_groups(db: AsyncSession) -> list[Group]:
    result = await db.execute(select(Group).order_by(Group.created_at.desc()))
    return list(result.scalars().all())


async def get_group(db: AsyncSession, group_id: int) -> Group:
    group = await db.get(Group, group_id)
    if group is None:
        raise EntityNotFoundException("Group", group_id)
    return group


# --- GroupRole -----------------------------------------------------------------


async def get_or_create_active_group_role(
    db: AsyncSession, party_id: int, role_type: GroupRoleType
) -> GroupRole:
    """The same active role instance is reused across repeat grants for the
    same party (e.g. a person leading several Circles shares one
    `ORGANIZATOR` `GroupRole` row) — a role is a standing capacity, not a
    per-Circle record; the specific Circle binding lives on
    `Leadership`/`Membership`."""
    existing = (
        await db.execute(
            select(GroupRole).where(
                GroupRole.party_id == party_id,
                GroupRole.role_type == role_type,
                GroupRole.valid_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    role = GroupRole(party_id=party_id, role_type=role_type, valid_from=date.today(), valid_to=None)
    db.add(role)
    await db.flush()
    return role


async def end_group_role(db: AsyncSession, group_role_id: int, valid_to: date) -> GroupRole:
    """Ends this Role and cascades: every currently-active `Leadership`/
    `Membership` built on it closes in the same transaction, so a Role
    never outlives the Relationships it backs (a person's `ORGANIZATOR`
    capacity ending immediately ends every Circle they lead)."""
    role = await db.get(GroupRole, group_role_id)
    if role is None:
        raise EntityNotFoundException("GroupRole", group_role_id)
    role.valid_to = valid_to

    for leadership in (
        await db.execute(
            select(Leadership).where(
                Leadership.from_role_id == group_role_id, Leadership.valid_to.is_(None)
            )
        )
    ).scalars():
        leadership.valid_to = valid_to
    for membership in (
        await db.execute(
            select(Membership).where(
                Membership.from_role_id == group_role_id, Membership.valid_to.is_(None)
            )
        )
    ).scalars():
        membership.valid_to = valid_to

    await db.commit()
    await db.refresh(role)
    return role


# --- Leadership (GroupRole(ORGANIZATOR) -> Group, strictly 1:N) ----------------


async def _group_role_party_id(db: AsyncSession, group_role_id: int) -> int:
    role = await db.get(GroupRole, group_role_id)
    if role is None:
        raise EntityNotFoundException("GroupRole", group_role_id)
    return role.party_id


async def assign_leadership(
    db: AsyncSession, group_id: int, organizer_party_id: int, valid_from: date
) -> Leadership:
    await get_group(db, group_id)

    current = await get_current_leadership(db, group_id)
    if current is not None:
        current.valid_to = valid_from

    role = await get_or_create_active_group_role(db, organizer_party_id, GroupRoleType.ORGANIZATOR)
    leadership = Leadership(
        from_role_id=cast(int, role.id), to_group_id=group_id, valid_from=valid_from, valid_to=None
    )
    db.add(leadership)
    await db.commit()
    await db.refresh(leadership)
    return leadership


async def remove_leadership(db: AsyncSession, leadership_id: int, valid_to: date) -> Leadership:
    leadership = await db.get(Leadership, leadership_id)
    if leadership is None:
        raise EntityNotFoundException("Leadership", leadership_id)
    leadership.valid_to = valid_to
    await db.commit()
    await db.refresh(leadership)
    return leadership


async def build_leadership_responses(
    db: AsyncSession, leaderships: list[Leadership]
) -> list[dict[str, object]]:
    rows = []
    for leadership in leaderships:
        party_id = await _group_role_party_id(db, leadership.from_role_id)
        rows.append(
            {
                "id": leadership.id,
                "from_role_id": leadership.from_role_id,
                "to_group_id": leadership.to_group_id,
                "organizer_party_id": party_id,
                "valid_from": leadership.valid_from,
                "valid_to": leadership.valid_to,
            }
        )
    return rows


async def get_current_leadership(db: AsyncSession, group_id: int) -> Leadership | None:
    result = await db.execute(
        select(Leadership).where(Leadership.to_group_id == group_id, Leadership.valid_to.is_(None))
    )
    return result.scalar_one_or_none()


async def list_leaderships(db: AsyncSession, group_id: int) -> list[Leadership]:
    result = await db.execute(
        select(Leadership)
        .where(Leadership.to_group_id == group_id)
        .order_by(Leadership.valid_from.desc())
    )
    return list(result.scalars().all())


async def list_active_leaderships_for_party(db: AsyncSession, party_id: int) -> list[Leadership]:
    """Every Circle `party_id` currently, actively leads."""
    role_ids = (
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
    if not role_ids:
        return []
    result = await db.execute(
        select(Leadership).where(
            Leadership.from_role_id.in_(role_ids), Leadership.valid_to.is_(None)
        )
    )
    return list(result.scalars().all())


async def _require_active_organizer(db: AsyncSession, group_id: int, party_id: int) -> None:
    current = await get_current_leadership(db, group_id)
    if current is None or await _group_role_party_id(db, current.from_role_id) != party_id:
        raise AccessDeniedException


# --- Membership (GroupRole(MEMBER) -> Group, N:N) ------------------------------


async def create_membership(
    db: AsyncSession, principal: Principal, data: CreateMembershipRequest
) -> Membership:
    profile = await get_profile_by_principal(db, principal)
    await get_group(db, data.group_id)

    role = await get_or_create_active_group_role(db, profile.party_id, GroupRoleType.MEMBER)
    membership = Membership(
        from_role_id=cast(int, role.id),
        to_group_id=data.group_id,
        valid_from=data.valid_from,
        valid_to=None,
    )
    db.add(membership)
    await db.commit()
    await db.refresh(membership)
    return membership


async def end_membership(
    db: AsyncSession, principal: Principal, membership_id: int, valid_to: date
) -> Membership:
    membership = await db.get(Membership, membership_id)
    if membership is None:
        raise EntityNotFoundException("Membership", membership_id)
    profile = await get_profile_by_principal(db, principal)
    if await _group_role_party_id(db, membership.from_role_id) != profile.party_id:
        raise AccessDeniedException

    membership.valid_to = valid_to
    await db.commit()
    await db.refresh(membership)
    return membership


async def list_memberships_for_circle(db: AsyncSession, circle_group_id: int) -> list[Membership]:
    result = await db.execute(
        select(Membership)
        .where(Membership.to_group_id == circle_group_id, Membership.valid_to.is_(None))
        .order_by(Membership.valid_from.desc())
    )
    return list(result.scalars().all())


async def list_memberships_for_party(db: AsyncSession, party_id: int) -> list[Membership]:
    role_ids = (
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
    if not role_ids:
        return []
    result = await db.execute(
        select(Membership).where(
            Membership.from_role_id.in_(role_ids), Membership.valid_to.is_(None)
        )
    )
    return list(result.scalars().all())


async def build_membership_responses(
    db: AsyncSession, memberships: list[Membership]
) -> list[dict[str, object]]:
    rows = []
    for membership in memberships:
        party_id = await _group_role_party_id(db, membership.from_role_id)
        rows.append(
            {
                "id": membership.id,
                "from_role_id": membership.from_role_id,
                "to_group_id": membership.to_group_id,
                "member_party_id": party_id,
                "valid_from": membership.valid_from,
                "valid_to": membership.valid_to,
            }
        )
    return rows


# --- Term / NeededItem ----------------------------------------------------------


async def create_term(db: AsyncSession, principal: Principal, data: CreateTermRequest) -> Term:
    profile = await get_profile_by_principal(db, principal)
    await get_group(db, data.circle_group_id)
    await _require_active_organizer(db, data.circle_group_id, profile.party_id)

    term = Term(
        circle_group_id=data.circle_group_id, occurs_on=data.occurs_on, description=data.description
    )
    db.add(term)
    await db.commit()
    await db.refresh(term)
    return term


async def get_term(db: AsyncSession, term_id: int) -> Term:
    term = await db.get(Term, term_id)
    if term is None:
        raise EntityNotFoundException("Term", term_id)
    return term


async def list_terms(db: AsyncSession, circle_group_id: int) -> list[Term]:
    result = await db.execute(
        select(Term).where(Term.circle_group_id == circle_group_id).order_by(Term.occurs_on.desc())
    )
    return list(result.scalars().all())


async def create_needed_item(
    db: AsyncSession, principal: Principal, data: CreateNeededItemRequest
) -> NeededItem:
    profile = await get_profile_by_principal(db, principal)
    term = await get_term(db, data.term_id)
    await _require_active_organizer(db, term.circle_group_id, profile.party_id)

    needed_item = NeededItem(
        term_id=data.term_id, category=data.category, description=data.description
    )
    db.add(needed_item)
    await db.commit()
    await db.refresh(needed_item)
    return needed_item


async def get_needed_item(db: AsyncSession, needed_item_id: int) -> NeededItem:
    needed_item = await db.get(NeededItem, needed_item_id)
    if needed_item is None:
        raise EntityNotFoundException("NeededItem", needed_item_id)
    return needed_item


async def list_needed_items(db: AsyncSession, term_id: int) -> list[NeededItem]:
    result = await db.execute(select(NeededItem).where(NeededItem.term_id == term_id))
    return list(result.scalars().all())


# --- Pledge + Pledge->Reservation bridge ----------------------------------------


async def create_pledge(db: AsyncSession, principal: Principal, needed_item_id: int) -> Pledge:
    profile = await get_profile_by_principal(db, principal)
    await get_needed_item(db, needed_item_id)

    pledge = Pledge(
        needed_item_id=needed_item_id,
        pledged_by_party_id=profile.party_id,
        status=PledgeStatus.CLAIMED,
    )
    db.add(pledge)
    await db.commit()
    await db.refresh(pledge)
    return pledge


async def get_pledge(db: AsyncSession, pledge_id: int) -> Pledge:
    pledge = await db.get(Pledge, pledge_id)
    if pledge is None:
        raise EntityNotFoundException("Pledge", pledge_id)
    return pledge


async def list_pledges(db: AsyncSession, needed_item_id: int) -> list[Pledge]:
    result = await db.execute(select(Pledge).where(Pledge.needed_item_id == needed_item_id))
    return list(result.scalars().all())


def _require_pledging_party(pledge: Pledge, party_id: int) -> None:
    if pledge.pledged_by_party_id != party_id:
        raise AccessDeniedException


async def withdraw_pledge(db: AsyncSession, principal: Principal, pledge_id: int) -> Pledge:
    pledge = await get_pledge(db, pledge_id)
    profile = await get_profile_by_principal(db, principal)
    _require_pledging_party(pledge, profile.party_id)

    pledge.status = PledgeStatus.WITHDRAWN
    await db.commit()
    await db.refresh(pledge)
    return pledge


async def fulfill_pledge(
    db: AsyncSession, principal: Principal, pledge_id: int, data: FulfillPledgeRequest
) -> Pledge:
    """Registers the concrete item the pledging guardian brings and opens
    the bridging `Reservation`: `reservedBy` = the Term's currently active
    Organizer (they physically receive the item at the class)."""
    pledge = await get_pledge(db, pledge_id)
    profile = await get_profile_by_principal(db, principal)
    _require_pledging_party(pledge, profile.party_id)

    needed_item = await get_needed_item(db, pledge.needed_item_id)
    term = await get_term(db, needed_item.term_id)
    leadership = await get_current_leadership(db, term.circle_group_id)
    if leadership is None:
        raise EntityNotFoundException("Leadership", term.circle_group_id)
    organizer_party_id = await _group_role_party_id(db, leadership.from_role_id)
    organizer_profile = await get_profile_by_party(db, organizer_party_id)

    inventory = await circulation_service.get_or_create_personal_inventory(
        db, profile.account_user_id
    )
    item = await circulation_service.register_item(
        db, cast(int, inventory.id), data.product_id, data.condition.value
    )
    reservation = await circulation_service.create_lend_reservation(
        db, item_id=cast(int, item.id), reserved_by_user_id=organizer_profile.account_user_id
    )

    pledge.resolved_reservation_id = reservation.id
    await db.commit()
    await db.refresh(pledge)
    return pledge


async def sync_pledge_fulfillment(db: AsyncSession, pledge_id: int) -> Pledge:
    pledge = await get_pledge(db, pledge_id)
    if pledge.resolved_reservation_id is None:
        raise AccessDeniedException
    reservation = await circulation_service.get_reservation(db, pledge.resolved_reservation_id)
    if reservation.status == ReservationStatus.FULFILLED:
        pledge.status = PledgeStatus.FULFILLED
        await db.commit()
        await db.refresh(pledge)
    return pledge
