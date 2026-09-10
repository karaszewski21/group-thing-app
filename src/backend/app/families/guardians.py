"""Guardian management: adding guardians, building guardian response
rows, renaming a Family, and removing a member. The guardian-ownership
check is co-located with the mutations it guards, per
`standards/backend/security.md`."""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.users.service import create_account_and_profile, get_profile_by_party

from .models import Family, FamilyMembership, FamilyRole, FamilyRoleType
from .repository import get_family
from .schemas import AddGuardianRequest, GuardianResponse


async def add_guardian(db: AsyncSession, family_id: int, data: AddGuardianRequest) -> int:
    await get_family(db, family_id)
    _party, profile = await create_account_and_profile(
        db, data.username, data.password, data.display_name, data.email
    )
    role = FamilyRole(
        party_id=profile.party_id,
        role_type=FamilyRoleType.GUARDIAN,
        valid_from=date.today(),
        valid_to=None,
    )
    db.add(role)
    await db.flush()
    membership = FamilyMembership(
        from_role_id=cast(int, role.id),
        to_family_id=family_id,
        is_primary_contact=False,
        valid_from=date.today(),
        valid_to=None,
    )
    db.add(membership)
    await db.commit()
    return cast(int, profile.id)


async def build_guardian_responses(
    db: AsyncSession, memberships: list[FamilyMembership]
) -> list[GuardianResponse]:
    responses = []
    for membership in memberships:
        role = await db.get(FamilyRole, membership.from_role_id)
        if role is None:
            raise EntityNotFoundException("FamilyRole", membership.from_role_id)
        profile = await get_profile_by_party(db, role.party_id)
        responses.append(
            GuardianResponse(
                family_membership_id=cast(int, membership.id),
                party_id=role.party_id,
                user_profile_id=cast(int, profile.id),
                display_name=profile.display_name,
                email=profile.email,
                is_primary_contact=membership.is_primary_contact,
                valid_from=membership.valid_from,
                valid_to=membership.valid_to,
            )
        )
    return responses


async def _require_family_guardian(db: AsyncSession, family_id: int, caller_party_id: int) -> None:
    """Verbatim body of the guardian-authz check shared by `rename_family`
    and `remove_family_member`: the caller must hold an active GUARDIAN
    role bound to this Family, else `AccessDeniedException` (-> 403)."""
    guardian = (
        await db.execute(
            select(FamilyRole.id)
            .join(FamilyMembership, FamilyMembership.from_role_id == FamilyRole.id)
            .where(
                FamilyRole.party_id == caller_party_id,
                FamilyRole.role_type == FamilyRoleType.GUARDIAN,
                FamilyMembership.to_family_id == family_id,
                FamilyMembership.valid_to.is_(None),
            )
        )
    ).first()
    if guardian is None:
        raise AccessDeniedException("You do not guard this Family")


async def rename_family(
    db: AsyncSession, family_id: int, caller_party_id: int, name: str
) -> Family:
    """In-place rename, guardian-only — enforced here, not by the coarse
    matrix (mirrors `update_organization`). Any current GUARDIAN of the
    family may rename it (not only the primary contact)."""
    family = await get_family(db, family_id)
    await _require_family_guardian(db, family_id, caller_party_id)
    family.name = name
    await db.commit()
    await db.refresh(family)
    return family


async def remove_family_member(
    db: AsyncSession, family_id: int, family_membership_id: int, caller_party_id: int
) -> None:
    """Soft-closes one member's `FamilyMembership` (sets `valid_to` to
    today) — the temporal "preserve row, don't delete" pattern also used by
    `make_primary_contact`/`end_membership`. The standing `FamilyRole` is
    left untouched (it's a capacity that other families/roles may bind).
    Guardian-only, enforced here (not the coarse matrix), mirroring
    `rename_family`. The last active GUARDIAN of a family cannot be
    removed (409); CHILD members have no such guard."""
    await get_family(db, family_id)
    await _require_family_guardian(db, family_id, caller_party_id)

    membership = await db.get(FamilyMembership, family_membership_id)
    if (
        membership is None
        or membership.to_family_id != family_id
        or membership.valid_to is not None
    ):
        raise EntityNotFoundException("FamilyMembership", family_membership_id)

    role = await db.get(FamilyRole, membership.from_role_id)
    if role is not None and role.role_type == FamilyRoleType.GUARDIAN:
        active_guardians = (
            await db.execute(
                select(func.count())
                .select_from(FamilyMembership)
                .join(FamilyRole, FamilyMembership.from_role_id == FamilyRole.id)
                .where(
                    FamilyMembership.to_family_id == family_id,
                    FamilyMembership.valid_to.is_(None),
                    FamilyRole.role_type == FamilyRoleType.GUARDIAN,
                )
            )
        ).scalar_one()
        if int(active_guardians) <= 1:
            raise BusinessConflictException("Nie można usunąć jedynego opiekuna rodziny")

    membership.valid_to = date.today()
    await db.commit()
