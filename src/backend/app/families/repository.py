"""Read-side queries for `app.families`: Family / FamilyRole /
FamilyMembership lookups and aggregates. Never commits or flushes."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFoundException
from app.groups.models import Membership
from app.groups.service import list_memberships_for_party

from .models import Family, FamilyMembership, FamilyRole, FamilyRoleType


async def get_family(db: AsyncSession, family_id: int) -> Family:
    family = await db.get(Family, family_id)
    if family is None:
        raise EntityNotFoundException("Family", family_id)
    return family


async def list_families_for_guardian_party(db: AsyncSession, party_id: int) -> list[Family]:
    """Resolves a guardian's own Family/Families — the capability that used
    to be a flat `Person.family_group_id` field, now derived through
    `FamilyRole`/`FamilyMembership` since family membership is a role +
    relationship, not a direct FK. A party is expected to guard exactly one
    Family in this codebase's current features (registration only ever
    bootstraps one), but this returns a list since nothing in the model
    actually forbids more than one."""
    role_ids = (
        (await db.execute(select(FamilyRole.id).where(FamilyRole.party_id == party_id)))
        .scalars()
        .all()
    )
    if not role_ids:
        return []
    memberships = (
        (
            await db.execute(
                select(FamilyMembership).where(
                    FamilyMembership.from_role_id.in_(role_ids), FamilyMembership.valid_to.is_(None)
                )
            )
        )
        .scalars()
        .all()
    )
    family_ids = {membership.to_family_id for membership in memberships}
    if not family_ids:
        return []
    families = (await db.execute(select(Family).where(Family.id.in_(family_ids)))).scalars().all()
    return list(families)


async def count_active_child_members(db: AsyncSession, family_id: int) -> int:
    """Active CHILD-role member count for one Family. Per
    `standards/backend/queries.md`: a single aggregate query (no per-member
    loop) — joins `FamilyMembership` to its `FamilyRole`, keeps only
    still-open memberships (`valid_to IS NULL`) whose role is `CHILD`, so
    GUARDIANs and soft-closed memberships are both excluded."""
    result = await db.execute(
        select(func.count())
        .select_from(FamilyMembership)
        .join(FamilyRole, FamilyMembership.from_role_id == FamilyRole.id)
        .where(
            FamilyMembership.to_family_id == family_id,
            FamilyMembership.valid_to.is_(None),
            FamilyRole.role_type == FamilyRoleType.CHILD,
        )
    )
    return int(result.scalar_one())


async def list_guardian_memberships(db: AsyncSession, family_id: int) -> list[FamilyMembership]:
    result = await db.execute(
        select(FamilyMembership)
        .where(FamilyMembership.to_family_id == family_id, FamilyMembership.valid_to.is_(None))
        .order_by(FamilyMembership.valid_from)
    )
    return list(result.scalars().all())


async def list_group_memberships_for_family(db: AsyncSession, family_id: int) -> list[Membership]:
    """Aggregates active Circle memberships across every guardian/child in
    this Family (decision: each family member joins a Circle individually,
    not the Family as a whole — see `app.groups.models.Membership`'s
    docstring). Bounded by family size (a handful of guardians/children),
    not a general N+1 risk at this domain's scale."""
    guardian_memberships = await list_guardian_memberships(db, family_id)
    memberships: list[Membership] = []
    for guardian_membership in guardian_memberships:
        role = await db.get(FamilyRole, guardian_membership.from_role_id)
        if role is None:
            continue
        memberships.extend(await list_memberships_for_party(db, role.party_id))
    return memberships
