"""`app.users` business logic: account+profile bootstrapping and the
`UserRole` lifecycle."""

from __future__ import annotations

import asyncio
import uuid

import re
from datetime import date
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Permission, User, user_permissions
from app.core.auth_deps import Principal
from app.core.errors import BusinessConflictException, EntityNotFoundException
from app.config import settings
from app.core.security import hash_password
from app.moderation.status import ModerationStatus
from app.moderation.text_guard import TextField, check_text
from app.party.models import Party, PartyType
from app.outbox import service as outbox_service
from app.party.service import create_party
from app.product import images
from app.storage.outbox_listener import OBJECTS_DELETE
from app.storage.service import ObjectStorage

from .models import ProfileAvatar, UserProfile, UserRole, UserRoleType
from .schemas import AvatarResponse, RegisterRequest, UpdateMyProfileRequest

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


class AlreadyMergedException(BusinessConflictException):
    """Raised when `app.groups.service.merge_anonymous_profile` is called
    for a `UserProfile` that already has a non-null `account_user_id` — a
    retry after a successful merge, or a stale/tampered `guest_profile_id`.
    Co-located next to `DuplicateEmailException` since both are
    `UserProfile`-identity conflicts (409)."""

    def __init__(self) -> None:
        super().__init__("Ten profil ma już powiązane konto — zaloguj się")


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
        party_id=cast(uuid.UUID, party.id),
        account_user_id=cast(uuid.UUID, user.id),
        display_name=display_name,
        email=email,
    )
    db.add(profile)
    role = UserRole(
        party_id=cast(uuid.UUID, party.id),
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


async def update_my_profile(
    db: AsyncSession, principal: Principal, data: UpdateMyProfileRequest
) -> UserProfile:
    """The caller's own name and "O mnie", both text-moderated like every
    other user-written text."""
    profile = await get_profile_by_principal(db, principal)
    bio = data.bio or None
    await check_text(TextField.PROFILE_NAME, data.display_name, profile.display_name)
    await check_text(TextField.PROFILE_BIO, bio, profile.bio)
    profile.display_name = data.display_name
    profile.bio = bio
    await db.commit()
    await db.refresh(profile)
    return profile


AVATAR_UPLOAD_DISABLED_MESSAGE = "Dodawanie zdjęć jest chwilowo niedostępne"


async def get_avatar(db: AsyncSession, user_profile_id: uuid.UUID) -> ProfileAvatar | None:
    return (
        await db.execute(
            select(ProfileAvatar).where(ProfileAvatar.user_profile_id == user_profile_id)
        )
    ).scalar_one_or_none()


def avatar_response(avatar: ProfileAvatar, storage: ObjectStorage) -> AvatarResponse:
    link = (
        storage.public_url if avatar.status == ModerationStatus.APPROVED else storage.presigned_url
    )
    return AvatarResponse(url=link(avatar.thumb_key), status=avatar.status)


async def _stage_avatar_files_delete(db: AsyncSession, avatar: ProfileAvatar) -> None:
    await outbox_service.append(
        db, event_type=OBJECTS_DELETE, payload={"keys": [avatar.large_key, avatar.thumb_key]}
    )


async def set_my_avatar(
    db: AsyncSession, principal: Principal, data: bytes, storage: ObjectStorage | None
) -> ProfileAvatar:
    """Sanitizes the upload like a product photo and replaces the caller's
    avatar. With image moderation on, the new avatar is PENDING and private
    until VPS B's cron approves it. The previous avatar's files are deleted
    through the outbox; on any failure the new files are deleted instead."""
    if storage is None:
        raise BusinessConflictException(AVATAR_UPLOAD_DISABLED_MESSAGE)
    processed = await asyncio.to_thread(images.process_upload, data)
    profile = await get_profile_by_principal(db, principal)
    previous = (
        await db.execute(
            select(ProfileAvatar)
            .where(ProfileAvatar.user_profile_id == profile.id)
            .with_for_update()
        )
    ).scalar_one_or_none()

    avatar_id = uuid.uuid4()
    approved = not settings.moderation_image_enabled
    avatar = ProfileAvatar(
        id=avatar_id,
        user_profile_id=profile.id,
        storage_key=f"avatars/{profile.id}/{avatar_id}",
        size_bytes=len(processed.large),
        content_sha256=processed.sha256,
        status=ModerationStatus.APPROVED if approved else ModerationStatus.PENDING,
    )
    await storage.put(avatar.large_key, processed.large, "image/webp", public=approved)
    await storage.put(avatar.thumb_key, processed.thumb, "image/webp", public=approved)
    try:
        if previous is not None:
            await db.delete(previous)
            # The one-avatar-per-profile constraint needs the delete first.
            await db.flush()
            await _stage_avatar_files_delete(db, previous)
        db.add(avatar)
        await db.commit()
    except Exception:
        await db.rollback()
        await storage.delete([avatar.large_key, avatar.thumb_key])
        raise
    return avatar


async def delete_avatar_as_admin(db: AsyncSession, avatar_id: uuid.UUID) -> None:
    avatar = await db.get(ProfileAvatar, avatar_id, with_for_update=True)
    if avatar is None:
        raise EntityNotFoundException("ProfileAvatar", avatar_id)
    await db.delete(avatar)
    await _stage_avatar_files_delete(db, avatar)
    await db.commit()


async def remove_my_avatar(db: AsyncSession, principal: Principal) -> None:
    profile = await get_profile_by_principal(db, principal)
    avatar = await get_avatar(db, cast(uuid.UUID, profile.id))
    if avatar is None:
        raise EntityNotFoundException("ProfileAvatar", profile.id)
    await db.delete(avatar)
    await _stage_avatar_files_delete(db, avatar)
    await db.commit()


async def get_profile(db: AsyncSession, user_profile_id: uuid.UUID) -> UserProfile:
    profile = await db.get(UserProfile, user_profile_id)
    if profile is None:
        raise EntityNotFoundException("UserProfile", user_profile_id)
    return profile


async def get_profile_by_party(db: AsyncSession, party_id: uuid.UUID) -> UserProfile:
    profile = (
        await db.execute(select(UserProfile).where(UserProfile.party_id == party_id))
    ).scalar_one_or_none()
    if profile is None:
        raise EntityNotFoundException("UserProfile", party_id)
    return profile


async def get_profile_by_account_user_id(
    db: AsyncSession, account_user_id: uuid.UUID
) -> UserProfile:
    """The inverse of `UserProfile.account_user_id` — used by
    `app.groups.application.term_item_listings` to map a `circulation.
    Reservation.reserved_by_user_id` (an account `users.id`) back to the
    taking party for display, since that reservation is the only place the
    taker is recorded once listings became fully derived."""
    profile = (
        await db.execute(select(UserProfile).where(UserProfile.account_user_id == account_user_id))
    ).scalar_one_or_none()
    if profile is None:
        raise EntityNotFoundException("UserProfile", account_user_id)
    return profile


async def get_or_create_active_user_role(
    db: AsyncSession, party_id: uuid.UUID, role_type: UserRoleType
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


async def is_active_organizer(db: AsyncSession, party_id: uuid.UUID) -> bool:
    """Whether `party_id` currently holds an active `UserRole(ORGANIZATOR)`
    grant — independent of whether they've created/lead any Circle yet.
    Registration grants this role on its own (see `register()`'s ORGANIZER
    branch); frontend organizer-view gating must check this directly rather
    than inferring it from Circle/Leadership ownership, or a freshly
    registered organizer who hasn't created a circle yet (e.g. skipped
    onboarding) would incorrectly see the guest view."""
    existing = (
        await db.execute(
            select(UserRole).where(
                UserRole.party_id == party_id,
                UserRole.role_type == UserRoleType.ORGANIZATOR,
                UserRole.valid_to.is_(None),
            )
        )
    ).scalar_one_or_none()
    return existing is not None


async def derive_username_from_email(db: AsyncSession, email: str) -> str:
    """Email local-part, lowercased and sanitized to fit `String(50)`,
    collision-checked against `User.username` with numeric suffixes
    (`jan.kowalski`, `jan.kowalski2`, `jan.kowalski3`, ...). Public (renamed
    from `_derive_username`) so both `register()` and
    `app.groups.service.merge_anonymous_profile` share this logic rather
    than duplicating it."""
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


async def register(db: AsyncSession, data: RegisterRequest) -> tuple[User, uuid.UUID]:
    """Returns `(user, party_id)` so the router can build the enriched
    `RegisterResponse`. No longer calls `bootstrap_family_for_party` or
    `create_own_circle` under any role (spec.md Core Requirements 3-4) —
    ORGANIZER registration only grants the `UserRole(ORGANIZATOR)`
    capacity; circle creation moves to the onboarding wizard's
    `POST /api/groups/mine` step. It does, unconditionally for every role,
    ensure the new party has a resolvable solo Family (spec.md Core
    Requirements 3-4) — distinct from the removed organizer-role-triggered
    bootstrap, this one is not role-gated and exists purely so the party
    renders correctly in a group's family-orbit visualization."""
    existing_profile = (
        await db.execute(select(UserProfile).where(UserProfile.email == data.email))
    ).scalar_one_or_none()
    if existing_profile is not None:
        raise DuplicateEmailException()

    username = await derive_username_from_email(db, data.email)
    display_name = _derive_display_name(data.email)

    party, profile = await create_account_and_profile(
        db, username, data.password, display_name, data.email
    )
    if data.role == "ORGANIZER":
        await get_or_create_active_user_role(
            db, cast(uuid.UUID, party.id), UserRoleType.ORGANIZATOR
        )

    # Deferred import: app.families.bootstrap imports create_account_and_profile
    # from this module at module load time, so a top-level import here would
    # trigger a circular-import ImportError while this module is still
    # mid-initialization.
    from app.families.service import create_solo_family_for_party

    await create_solo_family_for_party(db, cast(uuid.UUID, party.id), display_name)

    await db.commit()
    user = await db.get(User, profile.account_user_id)
    if user is None:
        raise EntityNotFoundException("User", profile.account_user_id)
    return user, cast(uuid.UUID, party.id)
