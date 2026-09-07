"""`app.users` business logic: account+profile bootstrapping and the
`UserRole` lifecycle."""

from __future__ import annotations

import re
from datetime import date
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Permission, User, user_permissions
from app.core.auth_deps import Principal
from app.core.errors import BusinessConflictException, EntityNotFoundException
from app.core.security import hash_password
from app.party.models import Party, PartyType
from app.party.service import create_party

from .models import UserProfile, UserRole, UserRoleType
from .schemas import RegisterRequest

_USERNAME_MAX_LENGTH = 50
# Anything outside this set is stripped from the email local-part before
# it's used as a `users.username` value (a `String(50)`, no format
# constraint of its own beyond length/uniqueness).
_USERNAME_SANITIZE_PATTERN = re.compile(r"[^a-zA-Z0-9._-]")


class DuplicateEmailException(BusinessConflictException):
    """Raised when `RegisterRequest.email` already belongs to an existing
    `UserProfile` — rendered by the frontend as spec.md's fixed duplicate-
    email message (Core Requirement 7)."""

    def __init__(self) -> None:
        super().__init__("Ten email jest już zarejestrowany, zaloguj się")


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


async def _derive_username(db: AsyncSession, email: str) -> str:
    """Email local-part, lowercased and sanitized to fit `String(50)`,
    collision-checked against `User.username` with numeric suffixes
    (`jan.kowalski`, `jan.kowalski2`, `jan.kowalski3`, ...)."""
    local_part = email.split("@", 1)[0].lower()
    base = _USERNAME_SANITIZE_PATTERN.sub("", local_part)[:_USERNAME_MAX_LENGTH] or "user"

    candidate = base
    suffix = 2
    while True:
        existing = (
            await db.execute(select(User).where(User.username == candidate))
        ).scalar_one_or_none()
        if existing is None:
            return candidate
        suffix_str = str(suffix)
        candidate = base[: _USERNAME_MAX_LENGTH - len(suffix_str)] + suffix_str
        suffix += 1


def _derive_display_name(email: str) -> str:
    """Email local-part, title-cased with separators turned into spaces
    (e.g. `jan.kowalski@example.com` -> `Jan Kowalski`)."""
    local_part = email.split("@", 1)[0]
    return re.sub(r"[._-]+", " ", local_part).strip().title() or local_part


async def register(db: AsyncSession, data: RegisterRequest) -> tuple[User, int]:
    """Returns `(user, party_id)` so the router can build the enriched
    `RegisterResponse`. No longer calls `bootstrap_family_for_party` or
    `create_own_circle` under any role (spec.md Core Requirements 3-4) —
    ORGANIZER registration only grants the `UserRole(ORGANIZATOR)`
    capacity; circle creation moves to the onboarding wizard's
    `POST /api/groups/mine` step."""
    existing_profile = (
        await db.execute(select(UserProfile).where(UserProfile.email == data.email))
    ).scalar_one_or_none()
    if existing_profile is not None:
        raise DuplicateEmailException()

    username = await _derive_username(db, data.email)
    display_name = _derive_display_name(data.email)

    party, profile = await create_account_and_profile(
        db, username, data.password, display_name, data.email
    )
    if data.role == "ORGANIZER":
        await get_or_create_active_user_role(db, cast(int, party.id), UserRoleType.ORGANIZATOR)

    await db.commit()
    user = await db.get(User, profile.account_user_id)
    if user is None:
        raise EntityNotFoundException("User", profile.account_user_id)
    return user, cast(int, party.id)
