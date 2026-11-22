"""Read-only ACL over `app.families`: the family rule of the exchange
awards (same query shape as `groups.repository.list_family_party_ids`)."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.families.models import FamilyMembership, FamilyRole


async def share_active_family(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    """Whether `a` and `b` both hold an active membership, in any role, in
    the same family."""
    families_of_a = (
        select(FamilyMembership.to_family_id)
        .join(FamilyRole, FamilyRole.id == FamilyMembership.from_role_id)
        .where(FamilyRole.party_id == a, FamilyMembership.valid_to.is_(None))
    )
    membership_of_b = (
        select(FamilyMembership.id)
        .join(FamilyRole, FamilyRole.id == FamilyMembership.from_role_id)
        .where(
            FamilyRole.party_id == b,
            FamilyMembership.valid_to.is_(None),
            FamilyMembership.to_family_id.in_(families_of_a),
        )
    )
    return bool(await db.scalar(select(membership_of_b.exists())))
