"""Lightweight family members: people with no login of their own, added
in a batch against the calling guardian's Family."""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.party.models import PartyType
from app.party.service import create_party
from app.users.models import UserProfile
from app.users.service import get_profile_by_party

from .bootstrap import bootstrap_family_for_party
from .models import Family, FamilyMembership, FamilyRole, FamilyRoleType
from .repository import list_families_for_guardian_party
from .schemas import CreateLightweightMemberRequest


async def create_lightweight_family_member(
    db: AsyncSession, family_id: int, name: str, role_type: FamilyRoleType
) -> UserProfile:
    """A family member with no login of their own — no `auth.User` row, so
    `UserProfile.account_user_id` is left `None` (see
    `0011_user_profiles_account_user_id_nullable.py`). Flushes, doesn't
    commit — the caller (`create_lightweight_members_batch`) owns the
    transaction boundary."""
    party = await create_party(db, PartyType.PERSON)
    profile = UserProfile(
        party_id=cast(int, party.id),
        account_user_id=None,
        display_name=name,
        email=None,
    )
    db.add(profile)
    role = FamilyRole(
        party_id=cast(int, party.id),
        role_type=role_type,
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
    await db.flush()
    return profile


async def create_lightweight_members_batch(
    db: AsyncSession, guardian_party_id: int, members: list[CreateLightweightMemberRequest]
) -> Family:
    """Resolves the calling guardian's own Family, bootstrapping one on the
    first call (server-generated name `f"Rodzina {display_name}"` — the
    frontend's typed draft family name is intentionally never sent to the
    backend), then creates every batch entry against it in one commit."""
    families = await list_families_for_guardian_party(db, guardian_party_id)
    if families:
        family = families[0]
    else:
        guardian_profile = await get_profile_by_party(db, guardian_party_id)
        family = await bootstrap_family_for_party(
            db, f"Rodzina {guardian_profile.display_name}", guardian_party_id
        )

    for member in members:
        await create_lightweight_family_member(
            db, cast(int, family.id), member.name, FamilyRoleType(member.role_type)
        )

    await db.commit()
    await db.refresh(family)
    return family
