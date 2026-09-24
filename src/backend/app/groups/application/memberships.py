"""`Membership` (GroupRole(MEMBER) -> Group, N:N) use cases."""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.families.models import Family, FamilyMembership, FamilyRole
from app.users.service import get_profile_by_principal

from ..infrastructure import repository
from ..models import Group, GroupRoleType, Membership
from ..schemas import TermAttendeeResponse
from .circles import _group_role_party_id, _require_active_organizer, get_group
from .group_roles import get_or_create_active_group_role


async def add_active_membership(db: AsyncSession, group_id: int, party_id: int) -> Membership:
    """Flushes (never commits) a new active `Membership` of `party_id` in
    `group_id`. The caller checks "already a member" and owns the commit."""
    role = await get_or_create_active_group_role(db, party_id, GroupRoleType.MEMBER)
    membership = Membership(
        from_role_id=cast(int, role.id),
        to_group_id=group_id,
        valid_from=date.today(),
        valid_to=None,
    )
    db.add(membership)
    await db.flush()
    return membership


async def end_membership(
    db: AsyncSession, principal: Principal, membership_id: int, valid_to: date
) -> Membership:
    membership = await repository.get_membership(db, membership_id)
    if membership is None:
        raise EntityNotFoundException("Membership", membership_id)
    profile = await get_profile_by_principal(db, principal)
    if await _group_role_party_id(db, membership.from_role_id) != profile.party_id:
        raise AccessDeniedException

    membership.valid_to = valid_to
    await db.commit()
    await db.refresh(membership)
    return membership


async def _is_active_member(db: AsyncSession, group_id: int, party_id: int) -> bool:
    """Non-raising: does `party_id` have a currently-active `Membership` in
    `group_id`? Used to gate `PRIVATE`-group RSVP alongside
    `circles._is_active_organizer` (an organizer need not also be a member)."""
    memberships = await list_memberships_for_party(db, party_id)
    return any(m.to_group_id == group_id for m in memberships)


async def _resolve_party_families(
    db: AsyncSession, party_ids: list[int]
) -> dict[int, tuple[int, str]]:
    """Batched `party_id -> (family_id, family_name)` lookup — mirrors
    `application/exchange_summary.py`'s `_resolve_family_guardians` query
    shape, but flat/per-party rather than grouped-by-family, since callers
    here (formalization candidate listing) need one row per attendee, not
    per family. Imports `app.families.models` directly, never
    `app.families.repository`/`.service` — those already import
    `app.groups.service`, so importing them back here would create a
    `groups -> families -> groups` cycle."""
    if not party_ids:
        return {}
    rows = await db.execute(
        select(FamilyRole.party_id, Family.id, Family.name)
        .join(FamilyMembership, FamilyMembership.from_role_id == FamilyRole.id)
        .join(Family, Family.id == FamilyMembership.to_family_id)
        .where(FamilyRole.party_id.in_(party_ids), FamilyMembership.valid_to.is_(None))
    )
    result: dict[int, tuple[int, str]] = {}
    for party_id, family_id, family_name in rows.all():
        result.setdefault(party_id, (family_id, family_name))
    return result


async def list_term_attendees_for_formalization(
    db: AsyncSession, principal: Principal, group_id: int, term_id: int
) -> list[TermAttendeeResponse]:
    """Candidate list for the "formalize standing members" picker — active
    (non-withdrawn) RSVPs on `term_id`, annotated with the attendee's
    resolved family (if any) and whether they're already a standing member
    of `group_id`. Organizer-only, same gate as `formalize_group_from_term`
    itself."""
    profile = await get_profile_by_principal(db, principal)
    await _require_active_organizer(db, group_id, profile.party_id)

    attendances = await repository.list_active_attendances_for_term(db, term_id)
    party_ids = [a.party_id for a in attendances]
    families = await _resolve_party_families(db, party_ids)
    profile_rows = await repository.list_profile_names_by_party_ids(db, party_ids)
    names = {row.party_id: row.display_name for row in profile_rows}
    active_memberships = await repository.list_active_memberships_for_group(db, group_id)
    member_party_ids = {
        await _group_role_party_id(db, m.from_role_id) for m in active_memberships
    }

    return [
        TermAttendeeResponse(
            party_id=attendance.party_id,
            display_name=names.get(attendance.party_id, ""),
            child_count=attendance.child_count,
            family_id=families.get(attendance.party_id, (None, None))[0],
            family_name=families.get(attendance.party_id, (None, None))[1],
            already_member=attendance.party_id in member_party_ids,
        )
        for attendance in attendances
    ]


async def formalize_group_from_term(
    db: AsyncSession, principal: Principal, group_id: int, term_id: int, party_ids: list[int]
) -> Group:
    """Turns the selected, still-attending `party_id`s from a term's RSVP
    list into standing `Membership`s. Independent of `Group.visibility` —
    never reads or mutates it; a `PUBLIC` group stays `PUBLIC`. Idempotent
    per selected attendee: only those with an active `TermAttendance` on
    `term_id` and not already an active member become members, regardless
    of family resolution; the rest are silently skipped rather than
    erroring, so a stale/partial selection (including a re-submit of an
    already-promoted attendee) from the UI never aborts the whole batch
    or creates a duplicate `Membership`."""
    profile = await get_profile_by_principal(db, principal)
    group = await get_group(db, group_id)
    await _require_active_organizer(db, group_id, profile.party_id)

    attendances = await repository.list_active_attendances_for_term(db, term_id)
    eligible_party_ids = {a.party_id for a in attendances if a.term_id == term_id}
    active_memberships = await repository.list_active_memberships_for_group(db, group_id)
    already_member_party_ids = {
        await _group_role_party_id(db, m.from_role_id) for m in active_memberships
    }
    selected_party_ids = (eligible_party_ids & set(party_ids)) - already_member_party_ids

    for party_id in selected_party_ids:
        await add_active_membership(db, group_id, party_id)

    await db.commit()
    await db.refresh(group)
    return group


async def list_memberships_for_circle(db: AsyncSession, circle_group_id: int) -> list[Membership]:
    return await repository.list_active_memberships_for_group(db, circle_group_id)


async def list_memberships_for_party(db: AsyncSession, party_id: int) -> list[Membership]:
    role_ids = await repository.list_member_role_ids_for_party(db, party_id)
    if not role_ids:
        return []
    return await repository.list_active_memberships_for_role_ids(db, role_ids)


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
