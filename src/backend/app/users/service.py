"""`app.users` business logic: account+profile bootstrapping and the
`UserRole` lifecycle. `register()` orchestrates `app.families`/`app.groups`
too (via deferred, in-function imports — `app.groups`/`app.families` both
import this module at module level for their own needs, so importing them
back at module level here would cycle)."""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Permission, User, user_permissions
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.core.security import hash_password
from app.party.models import Party, PartyType
from app.party.service import create_party

from .models import UserProfile, UserRole, UserRoleType
from .schemas import RegisterRequest


async def create_account(db: AsyncSession, username: str, password: str) -> User:
    user = User(username=username, password_hash=hash_password(password))
    db.add(user)
    await db.flush()
    for permission in (Permission.READ, Permission.EDIT):
        await db.execute(
            user_permissions.insert().values(user_id=user.id, permission=permission.value)
        )
    return user


async def create_account_and_profile(
    db: AsyncSession, username: str, password: str, display_name: str, email: str | None
) -> tuple[Party, UserProfile]:
    """Bootstraps a brand-new login + `Party(PERSON)` + `UserProfile` +
    the always-granted `UserRole(USER)`, in one flushed (uncommitted) unit
    — the caller (`register`, `app.families.service.create_family`) owns
    the transaction boundary."""
    user = await create_account(db, username, password)
    party = await create_party(db, PartyType.PERSON)
    profile = UserProfile(
        party_id=cast(int, party.id),
        account_user_id=cast(int, user.id),
        display_name=display_name,
        email=email,
    )
    db.add(profile)
    role = UserRole(
        party_id=cast(int, party.id),
        role_type=UserRoleType.USER,
        valid_from=date.today(),
        valid_to=None,
    )
    db.add(role)
    await db.flush()
    return party, profile


async def get_profile_by_principal(db: AsyncSession, principal: Principal) -> UserProfile:
    user = (
        await db.execute(select(User).where(User.username == principal.username))
    ).scalar_one_or_none()
    if user is None:
        raise EntityNotFoundException("User", principal.username)
    profile = (
        await db.execute(select(UserProfile).where(UserProfile.account_user_id == user.id))
    ).scalar_one_or_none()
    if profile is None:
        raise EntityNotFoundException("UserProfile", principal.username)
    return profile


async def get_profile(db: AsyncSession, user_profile_id: int) -> UserProfile:
    profile = await db.get(UserProfile, user_profile_id)
    if profile is None:
        raise EntityNotFoundException("UserProfile", user_profile_id)
    return profile


async def get_profile_by_party(db: AsyncSession, party_id: int) -> UserProfile:
    profile = (
        await db.execute(select(UserProfile).where(UserProfile.party_id == party_id))
    ).scalar_one_or_none()
    if profile is None:
        raise EntityNotFoundException("UserProfile", party_id)
    return profile


async def get_or_create_active_user_role(
    db: AsyncSession, party_id: int, role_type: UserRoleType
) -> UserRole:
    """The same active role instance is reused across repeat grants for the
    same party — a role is a standing capacity, not a per-event record."""
    existing = (
        await db.execute(
            select(UserRole).where(
                UserRole.party_id == party_id,
                UserRole.role_type == role_type,
                UserRole.valid_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    role = UserRole(party_id=party_id, role_type=role_type, valid_from=date.today(), valid_to=None)
    db.add(role)
    await db.flush()
    return role


async def register(db: AsyncSession, data: RegisterRequest) -> User:
    from app.families.service import bootstrap_family_for_party
    from app.groups.service import create_own_circle

    party, profile = await create_account_and_profile(
        db, data.username, data.password, data.display_name, data.email
    )
    await bootstrap_family_for_party(db, data.family_name, cast(int, party.id))
    if data.role == "ORGANIZER":
        await get_or_create_active_user_role(db, cast(int, party.id), UserRoleType.ORGANIZATOR)
        await create_own_circle(db, cast(int, party.id), cast(str, data.circle_name))

    await db.commit()
    user = await db.get(User, profile.account_user_id)
    if user is None:
        raise EntityNotFoundException("User", profile.account_user_id)
    return user
