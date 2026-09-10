"""Family bootstrapping: creating a Family for an existing Party and the
two account-creating entry points (`create_family`, `create_own_family`)."""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.party.models import PartyType
from app.party.service import create_party
from app.users.service import create_account_and_profile

from .models import Family, FamilyMembership, FamilyRole, FamilyRoleType
from .repository import list_families_for_guardian_party
from .schemas import CreateFamilyRequest


async def bootstrap_family_for_party(
    db: AsyncSession, family_name: str, guardian_party_id: int
) -> Family:
    """Creates a brand-new Family for an *already-existing* Party (used by
    both `create_family`, right after it bootstraps a fresh account, and
    `app.users.service.register`, whose caller already has a Party)."""
    family_party = await create_party(db, PartyType.ORGANIZATION)
    family = Family(party_id=cast(int, family_party.id), name=family_name)
    db.add(family)
    await db.flush()

    role = FamilyRole(
        party_id=guardian_party_id,
        role_type=FamilyRoleType.GUARDIAN,
        valid_from=date.today(),
        valid_to=None,
    )
    db.add(role)
    await db.flush()

    membership = FamilyMembership(
        from_role_id=cast(int, role.id),
        to_family_id=cast(int, family.id),
        is_primary_contact=True,
        valid_from=date.today(),
        valid_to=None,
    )
    db.add(membership)
    await db.flush()
    return family


async def create_family(db: AsyncSession, data: CreateFamilyRequest) -> tuple[Family, int]:
    """Returns the new Family plus the bootstrapped guardian's
    `UserProfile.id` (the router needs it to build the first
    `GuardianResponse`)."""
    _party, profile = await create_account_and_profile(
        db, data.username, data.password, data.display_name, data.email
    )
    family = await bootstrap_family_for_party(db, data.family_name, profile.party_id)
    await db.commit()
    await db.refresh(family)
    return family, cast(int, profile.id)


async def create_own_family(db: AsyncSession, guardian_party_id: int, name: str) -> Family:
    """Self-service "create my family": idempotent create-own (mirrors
    `create_own_organization`) — a caller who already guards a Family gets
    that same Family back unchanged (never a rename, never a second row);
    otherwise a fresh Family is bootstrapped with the caller as sole
    GUARDIAN / primary contact."""
    families = await list_families_for_guardian_party(db, guardian_party_id)
    if families:
        return families[0]
    family = await bootstrap_family_for_party(db, name, guardian_party_id)
    await db.commit()
    await db.refresh(family)
    return family
