"""`app.families` business logic: Family bootstrapping, guardian
management, and the `is_primary_contact` lifecycle — the identity bridge
`app.groups.service.fulfill_pledge` ultimately resolves through
`app.users.service.get_profile_by_party`.

Ownership checks the coarse `AUTHORIZATION_MATRIX` can't express (only a
family's own guardians may add another guardian) live here."""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import EntityNotFoundException
from app.groups.models import Membership
from app.groups.service import list_memberships_for_party
from app.party.models import PartyType
from app.party.service import create_party
from app.users.models import UserProfile
from app.users.service import create_account_and_profile, get_profile_by_party

from .models import Family, FamilyMembership, FamilyRole, FamilyRoleType
from .schemas import (
    AddGuardianRequest,
    CreateFamilyRequest,
    CreateLightweightMemberRequest,
    GuardianResponse,
)


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


async def list_guardian_memberships(db: AsyncSession, family_id: int) -> list[FamilyMembership]:
    result = await db.execute(
        select(FamilyMembership)
        .where(FamilyMembership.to_family_id == family_id, FamilyMembership.valid_to.is_(None))
        .order_by(FamilyMembership.valid_from)
    )
    return list(result.scalars().all())


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


async def make_primary_contact(db: AsyncSession, family_id: int, family_membership_id: int) -> None:
    """Ends the current primary contact's membership row and opens a new
    one for `family_membership_id`'s guardian, both dated today — "preserve
    row with validTo set, don't delete", never an in-place flip of
    `is_primary_contact` on an existing row."""
    new_primary = await db.get(FamilyMembership, family_membership_id)
    if new_primary is None or new_primary.to_family_id != family_id:
        raise EntityNotFoundException("FamilyMembership", family_membership_id)
    if new_primary.is_primary_contact and new_primary.valid_to is None:
        return

    today = date.today()
    current_primary = (
        await db.execute(
            select(FamilyMembership).where(
                FamilyMembership.to_family_id == family_id,
                FamilyMembership.is_primary_contact.is_(True),
                FamilyMembership.valid_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if current_primary is not None:
        current_primary.valid_to = today
        demoted = FamilyMembership(
            from_role_id=current_primary.from_role_id,
            to_family_id=family_id,
            is_primary_contact=False,
            valid_from=today,
            valid_to=None,
        )
        db.add(demoted)

    new_primary.valid_to = today
    replacement = FamilyMembership(
        from_role_id=new_primary.from_role_id,
        to_family_id=family_id,
        is_primary_contact=True,
        valid_from=today,
        valid_to=None,
    )
    db.add(replacement)
    await db.commit()
