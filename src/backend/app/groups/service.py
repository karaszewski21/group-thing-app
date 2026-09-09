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

import hashlib
from datetime import date, datetime
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.circulation import service as circulation_service
from app.circulation.models import ReservationStatus
from app.core.auth_deps import Principal
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.organizations import service as organizations_service
from app.party.models import PartyType
from app.party.service import create_party
from app.users.models import UserProfile
from app.users.service import (
    AlreadyMergedException,
    DuplicateEmailException,
    create_account,
    derive_username_from_email,
    get_profile,
    get_profile_by_party,
    get_profile_by_principal,
)

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
    TermAttendance,
)
from .schemas import (
    CreateCircleRequest,
    CreateMembershipRequest,
    CreateNeededItemRequest,
    CreateTermRequest,
    FulfillPledgeRequest,
    MyAttendanceResponse,
    PublicCircleResponse,
    PublicGuardianResponse,
    PublicNeededItemResponse,
    PublicTermResponse,
    RsvpResponse,
    UpdateNeededItemRequest,
    UpdateTermRequest,
)

# --- Groups (Circles) ---------------------------------------------------------


async def create_circle(db: AsyncSession, data: CreateCircleRequest) -> Group:
    party = await create_party(db, PartyType.ORGANIZATION)
    group = Group(party_id=cast(int, party.id), name=data.name)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


async def get_own_circle(db: AsyncSession, organizer_party_id: int) -> Group | None:
    """`None` (not an exception) when the caller doesn't currently lead any
    Circle — mirrors `app.organizations.service.get_own_organization`'s
    resolve-or-None shape. Resolves via `list_active_leaderships_for_party`
    (already exists) rather than a new query — a party's "own circle" is
    whichever circle they currently, actively lead."""
    leaderships = await list_active_leaderships_for_party(db, organizer_party_id)
    if not leaderships:
        return None
    return await get_group(db, leaderships[0].to_group_id)


async def create_own_circle(db: AsyncSession, organizer_party_id: int, circle_name: str) -> Group:
    """Self-service 'become an Organizer': creates a brand-new Circle and
    assigns `organizer_party_id` as its leader in one call. Idempotent by
    design (mirrors `create_own_organization`) — a caller who already leads
    a Circle gets that same Circle back rather than a second one, so
    repeat/retry calls from the "Dodaj pierwszy termin" flow never create
    duplicate Group/Leadership rows. Callers must always derive
    `organizer_party_id` from the authenticated `Principal` (via
    `app.users.service.get_profile_by_principal`) — never from
    caller-supplied input — since `assign_leadership` itself performs no
    ownership check on who it's assigning."""
    existing = await get_own_circle(db, organizer_party_id)
    if existing is not None:
        return existing

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


async def update_group(
    db: AsyncSession, group_id: int, caller_party_id: int, name: str
) -> Group:
    """In-place circle rename. Only the Circle's currently active organizer
    may rename it — enforced here, not by the coarse matrix."""
    group = await get_group(db, group_id)
    await _require_active_organizer(db, group_id, caller_party_id)
    group.name = name
    await db.commit()
    await db.refresh(group)
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


async def update_term(
    db: AsyncSession, term_id: int, caller_party_id: int, data: UpdateTermRequest
) -> Term:
    """Partial in-place term edit. Only the parent Circle's currently active
    organizer may edit — enforced here, not by the coarse matrix."""
    term = await get_term(db, term_id)
    await _require_active_organizer(db, term.circle_group_id, caller_party_id)

    if data.occurs_on is not None:
        term.occurs_on = data.occurs_on
    if data.description is not None:
        term.description = data.description

    await db.commit()
    await db.refresh(term)
    return term


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
    if needed_item.deleted_at is not None:
        raise EntityNotFoundException("NeededItem", needed_item_id)
    return needed_item


async def list_needed_items(db: AsyncSession, term_id: int) -> list[NeededItem]:
    result = await db.execute(
        select(NeededItem)
        .where(NeededItem.term_id == term_id, NeededItem.deleted_at.is_(None))
        .order_by(NeededItem.id)
    )
    return list(result.scalars().all())


async def _require_needed_item_organizer(
    db: AsyncSession, needed_item_id: int, caller_party_id: int
) -> NeededItem:
    needed_item = await get_needed_item(db, needed_item_id)
    term = await get_term(db, needed_item.term_id)
    await _require_active_organizer(db, term.circle_group_id, caller_party_id)
    return needed_item


async def update_needed_item(
    db: AsyncSession,
    needed_item_id: int,
    caller_party_id: int,
    data: UpdateNeededItemRequest,
) -> NeededItem:
    """Partial in-place needed-item edit, gated on the parent term's Circle
    organizer. A soft-deleted item is a 404 (via `get_needed_item`)."""
    needed_item = await _require_needed_item_organizer(db, needed_item_id, caller_party_id)

    if data.category is not None:
        needed_item.category = data.category
    if data.description is not None:
        needed_item.description = data.description

    await db.commit()
    await db.refresh(needed_item)
    return needed_item


def _withdraw_pledge_row(pledge: Pledge) -> None:
    # TODO: notify pledger that the organizer no longer needs this item
    pledge.status = PledgeStatus.WITHDRAWN


async def soft_delete_needed_item(
    db: AsyncSession, needed_item_id: int, caller_party_id: int
) -> None:
    """Soft-delete a needed item in one transaction. Blocked (409) if any
    pledge is already FULFILLED; otherwise every OPEN/CLAIMED pledge is
    transitioned to WITHDRAWN and `deleted_at` is stamped."""
    needed_item = await _require_needed_item_organizer(db, needed_item_id, caller_party_id)

    pledges = list(
        (
            await db.execute(select(Pledge).where(Pledge.needed_item_id == needed_item.id))
        ).scalars()
    )

    if any(
        pledge.status == PledgeStatus.FULFILLED or pledge.resolved_reservation_id is not None
        for pledge in pledges
    ):
        raise BusinessConflictException("Nie można usunąć — rzecz została już dostarczona")

    for pledge in pledges:
        if pledge.status in (PledgeStatus.OPEN, PledgeStatus.CLAIMED):
            _withdraw_pledge_row(pledge)

    needed_item.deleted_at = datetime.utcnow()
    await db.commit()


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
    await get_needed_item(db, needed_item_id)
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


# --- Public circle-view (unauthenticated) ---------------------------------------


async def list_attendances_for_term(db: AsyncSession, term_id: int) -> list[TermAttendance]:
    """Row-level `TermAttendance` list for a Term, ordered by creation —
    used to build the public guardian list's `display_name`s via a join in
    `get_public_circle_view` (no N+1: one query resolves every attendance's
    party's profile)."""
    result = await db.execute(
        select(TermAttendance)
        .where(TermAttendance.term_id == term_id)
        .order_by(TermAttendance.created_at)
    )
    return list(result.scalars().all())


def _fallback_organizer_slug(seed: str) -> str:
    """A stable, URL-safe pseudo-slug for the `/<slug>/grupa/<id>/term/<id>`
    public URL when the organizer has not created an `Organization`. Keyed on
    the organizer's party id so every Circle that person leads shares one
    prefix, exactly as a real Organization slug would.

    Not a secret: the slug segment is cosmetic (the backend fetches by
    `group_id` + `term_id` and never validates it) and `group_id`/`term_id`
    are already in the URL — so a plain digest, no pepper, is enough.
    """
    return "k-" + hashlib.blake2s(seed.encode("utf-8"), digest_size=6).hexdigest()


async def resolve_organizer_slug(db: AsyncSession, group_id: int) -> str:
    """The Circle's public-URL slug: the organizer's own `Organization` slug
    when they have one, otherwise a stable hash (`_fallback_organizer_slug`)
    so an organizer who does not want an Organization can still share
    per-term links. Never `None` — every Circle always has a usable slug.

    Cross-bounded-context read via a plain function call into
    `app.organizations.service` + FK-id chaining (active `Leadership` ->
    organizer party -> owned `Organization`) — no shared model, no ORM
    relationship crossing the boundary, per `standards/backend/models.md`.
    """
    leadership = await get_current_leadership(db, group_id)
    if leadership is None:
        return _fallback_organizer_slug(f"group:{group_id}")
    party_id = await _group_role_party_id(db, leadership.from_role_id)
    organization = await organizations_service.get_own_organization(db, party_id)
    if organization is not None:
        return organization.slug
    return _fallback_organizer_slug(f"party:{party_id}")


async def _resolve_organizer(db: AsyncSession, group_id: int) -> tuple[str | None, str]:
    """`(display_name, slug)` for a Circle's active organizer, resolving the
    active `Leadership` -> `GroupRole` party id chain ONCE and deriving both
    from it — instead of `_resolve_organizer_display_name` and
    `resolve_organizer_slug` each re-running that chain per circle in
    `list_my_attendances`.

    `display_name` is `None` when the Circle has no active `Leadership` OR the
    organizer party has no `UserProfile` — a missing organizer profile must
    degrade gracefully, not 500 the whole attendances response (mirrors how
    `create_rsvp` catches `EntityNotFoundException` for
    `get_profile_by_principal`). `slug` is never `None` (`_fallback_organizer_slug`).

    `resolve_organizer_slug` is kept as-is for its other callers; the slug
    derivation here is deliberately identical."""
    leadership = await get_current_leadership(db, group_id)
    if leadership is None:
        return None, _fallback_organizer_slug(f"group:{group_id}")

    organizer_party_id = await _group_role_party_id(db, leadership.from_role_id)

    display_name: str | None = None
    try:
        organizer_profile = await get_profile_by_party(db, organizer_party_id)
        display_name = organizer_profile.display_name
    except EntityNotFoundException:
        display_name = None

    organization = await organizations_service.get_own_organization(db, organizer_party_id)
    slug = (
        organization.slug
        if organization is not None
        else _fallback_organizer_slug(f"party:{organizer_party_id}")
    )
    return display_name, slug


async def list_my_attendances(db: AsyncSession, party_id: int) -> list[MyAttendanceResponse]:
    """The caller's own Term RSVPs, newest class last.

    One joined `select(TermAttendance, Term, Group)` (these entities carry no
    ORM `relationship()` — `lazy="raise"` + cross-BC FK-id only, per
    `standards/backend/models.md` — so an explicit multi-entity join is the
    correct eager form, not `joinedload`), with SQL-level ordering per
    `standards/backend/queries.md` (no in-Python sort). Chosen ordering (A4):
    chronological ascending by `Term.occurs_on`, then `TermAttendance.id` —
    deterministic and consistent with `list_terms`.

    Organizer `display_name` + `slug` are resolved once per DISTINCT circle in
    the result (a caller typically attends 1-3 circles) — the same bounded-loop
    precedent as `list_group_memberships_for_family`, not an N+1 over rows.
    """
    result = await db.execute(
        select(TermAttendance, Term, Group)
        .join(Term, TermAttendance.term_id == Term.id)
        .join(Group, Term.circle_group_id == Group.id)
        .where(TermAttendance.party_id == party_id)
        .order_by(Term.occurs_on.asc(), TermAttendance.id.asc())
    )
    rows = result.all()

    distinct_group_ids = {cast(int, group.id) for _attendance, _term, group in rows}
    organizer_info: dict[int, tuple[str | None, str]] = {
        group_id: await _resolve_organizer(db, group_id) for group_id in distinct_group_ids
    }

    responses: list[MyAttendanceResponse] = []
    for attendance, term, group in rows:
        display_name, slug = organizer_info[cast(int, group.id)]
        responses.append(
            MyAttendanceResponse(
                attendance_id=cast(int, attendance.id),
                term_id=cast(int, term.id),
                occurs_on=term.occurs_on,
                child_count=attendance.child_count,
                group_id=cast(int, group.id),
                group_name=group.name,
                organizer_display_name=display_name,
                organizer_slug=slug,
            )
        )
    return responses


async def get_public_circle_view(
    db: AsyncSession, group_id: int, term_id: int | None = None
) -> PublicCircleResponse:
    """Unauthenticated read assembled server-side in one call: organizer
    name (via the active `Leadership`, `None` if the Circle currently has
    no organizer), the organizer's Organization slug, one Term, its needed
    items, and the RSVP'd guardians' display names. Never reads or returns
    anything about children beyond each guardian's own aggregate
    `child_count` — there is no per-attendee child data anywhere in the
    schema to leak.

    `term_id` given: that exact Term drives the view — `EntityNotFoundException`
    (-> 404) when it does not exist or belongs to another Circle. `term_id`
    absent: the next upcoming Term is picked (falling back to the most
    recent past Term so the page is never empty; `None` when the Circle has
    zero Terms)."""
    group = await get_group(db, group_id)

    organizer_display_name: str | None = None
    leadership = await get_current_leadership(db, group_id)
    if leadership is not None:
        organizer_party_id = await _group_role_party_id(db, leadership.from_role_id)
        organizer_profile = await get_profile_by_party(db, organizer_party_id)
        organizer_display_name = organizer_profile.display_name

    organizer_slug = await resolve_organizer_slug(db, group_id)

    next_term: Term | None = None
    if term_id is not None:
        term = await get_term(db, term_id)
        if term.circle_group_id != group_id:
            raise EntityNotFoundException("Term", term_id)
        next_term = term
    else:
        terms = await list_terms(db, group_id)
        if terms:
            upcoming = [term for term in terms if term.occurs_on >= date.today()]
            next_term = min(upcoming, key=lambda term: term.occurs_on) if upcoming else terms[0]

    next_term_response: PublicTermResponse | None = None
    guardians: list[PublicGuardianResponse] = []
    if next_term is not None:
        needed_items = await list_needed_items(db, cast(int, next_term.id))
        next_term_response = PublicTermResponse(
            id=cast(int, next_term.id),
            occurs_on=next_term.occurs_on,
            description=next_term.description,
            needed_items=[
                PublicNeededItemResponse(
                    id=cast(int, item.id), category=item.category, description=item.description
                )
                for item in needed_items
            ],
        )

        attendances = await list_attendances_for_term(db, cast(int, next_term.id))
        if attendances:
            party_ids = [attendance.party_id for attendance in attendances]
            profile_rows = (
                await db.execute(
                    select(UserProfile.party_id, UserProfile.display_name).where(
                        UserProfile.party_id.in_(party_ids)
                    )
                )
            ).all()
            names_by_party_id = {row.party_id: row.display_name for row in profile_rows}
            guardians = [
                PublicGuardianResponse(display_name=names_by_party_id[attendance.party_id])
                for attendance in attendances
                if attendance.party_id in names_by_party_id
            ]

    return PublicCircleResponse(
        id=cast(int, group.id),
        name=group.name,
        organizer_display_name=organizer_display_name,
        organizer_slug=organizer_slug,
        next_term=next_term_response,
        guardians=guardians,
    )


async def create_rsvp(
    db: AsyncSession,
    group_id: int,
    term_id: int,
    guardian_name: str,
    child_count: int,
    principal: Principal | None = None,
) -> RsvpResponse:
    """Public RSVP. Anonymous (no / invalid / expired token, `principal`
    unresolvable): mirrors `create_lightweight_family_member`'s four-step
    Party->UserProfile->attendance-row shape exactly, `attached_to_account`
    False. Logged-in (`principal` resolves to a real account-backed
    `UserProfile`): attaches a `TermAttendance` to that profile's existing
    party — no new Party/UserProfile — idempotent per `(party, term.id)`
    (an existing row's `child_count` is refreshed in place), the request
    `guardian_name` is ignored in favour of the profile `display_name`,
    `attached_to_account` True. The ownership check
    (`term.circle_group_id == group_id`) guards both paths. This route
    never 401s and never 500s on a bad token."""
    term = await get_term(db, term_id)
    if term.circle_group_id != group_id:
        raise EntityNotFoundException("Term", term_id)

    profile: UserProfile | None = None
    if principal is not None:
        try:
            profile = await get_profile_by_principal(db, principal)
        except EntityNotFoundException:
            profile = None

    # A principal that resolves only to an unmerged anonymous profile
    # (`account_user_id is None`) deliberately falls through to the anonymous
    # branch below rather than attaching here — the attach path requires a real
    # account-backed profile.
    if profile is not None and profile.account_user_id is not None:
        existing = (
            await db.execute(
                select(TermAttendance).where(
                    TermAttendance.term_id == term.id,
                    TermAttendance.party_id == profile.party_id,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            existing.child_count = child_count
            attendance = existing
        else:
            attendance = TermAttendance(
                term_id=cast(int, term.id),
                party_id=cast(int, profile.party_id),
                child_count=child_count,
            )
            db.add(attendance)
        await db.commit()
        await db.refresh(attendance)
        return RsvpResponse(
            id=cast(int, attendance.id),
            term_id=cast(int, term.id),
            user_profile_id=cast(int, profile.id),
            guardian_name=profile.display_name,
            child_count=child_count,
            attached_to_account=True,
        )

    party = await create_party(db, PartyType.PERSON)
    profile = UserProfile(
        party_id=cast(int, party.id),
        account_user_id=None,
        display_name=guardian_name,
        email=None,
    )
    db.add(profile)
    await db.flush()

    attendance = TermAttendance(
        term_id=cast(int, term.id), party_id=cast(int, party.id), child_count=child_count
    )
    db.add(attendance)
    await db.commit()
    await db.refresh(attendance)

    return RsvpResponse(
        id=cast(int, attendance.id),
        term_id=cast(int, term.id),
        user_profile_id=cast(int, profile.id),
        guardian_name=guardian_name,
        child_count=child_count,
        attached_to_account=False,
    )


# --- Account-merge (unauthenticated) --------------------------------------------


async def merge_anonymous_profile(
    db: AsyncSession, user_profile_id: int, email: str, password: str
) -> tuple[User, UserProfile]:
    """Merges an anonymous RSVP's `UserProfile` into a newly-created
    account: **updates the existing row's `account_user_id`/`email` in
    place** — never creates a second Party/UserProfile. `party_id`, the
    row's `id`, `display_name`, and every `TermAttendance` row referencing
    its `party_id` are untouched. Ownership/identity conflict checks
    (`AlreadyMergedException`, `DuplicateEmailException`) live here, not the
    router, per `standards/backend/security.md`."""
    profile = await get_profile(db, user_profile_id)
    if profile.account_user_id is not None:
        raise AlreadyMergedException()

    # Postgres advisory lock keyed by the target email, held for the rest of
    # this transaction: closes the check-then-act race where two concurrent
    # merge calls for the same email could otherwise both pass the
    # `existing is None` check below before either commits. Auto-released on
    # commit/rollback — no separate unlock call needed, no schema change.
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext(email))))

    existing = (
        await db.execute(select(UserProfile).where(UserProfile.email == email))
    ).scalar_one_or_none()
    if existing is not None:
        raise DuplicateEmailException()

    username = await derive_username_from_email(db, email)
    user = await create_account(db, username, password)

    profile.account_user_id = user.id
    profile.email = email
    await db.commit()
    await db.refresh(profile)
    return user, profile
