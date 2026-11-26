"""`app.auth` business logic shared by the login, register and Google
sign-in routes."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import cast

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import (
    EntityNotFoundException,
    ModerationUnavailable,
    TextModerationRejected,
)
from app.moderation.text_guard import TextField, check_text
from app.users import service as users_service
from app.users.models import UserProfile

from .google import GoogleClaims
from .models import IdentityProvider, User, UserIdentity, user_permissions

_DISPLAY_NAME_MAX_LENGTH = 255


async def load_permissions(db: AsyncSession, user_id: uuid.UUID) -> list[str]:
    """The account's `user_permissions` rows, the `permissions` claim of its
    login token."""
    result = await db.execute(
        select(user_permissions.c.permission).where(user_permissions.c.user_id == user_id)
    )
    return [row[0] for row in result]


class GoogleEmailTaken(Exception):
    """The Google email already belongs to a profile; accounts are never
    linked by email. 409."""


class GoogleEmailUnverified(Exception):
    """An unlinked Google account whose email Google has not verified. 403."""


class GoogleSignInFailed(Exception):
    """The account bootstrap hit an unclassified conflict twice. 401."""


@dataclass(frozen=True)
class GoogleSignIn:
    user: User
    party_id: uuid.UUID
    created: bool


async def find_identity(db: AsyncSession, subject: str) -> UserIdentity | None:
    return (
        await db.execute(
            select(UserIdentity).where(
                UserIdentity.provider == IdentityProvider.GOOGLE,
                UserIdentity.subject == subject,
            )
        )
    ).scalar_one_or_none()


async def _log_in_linked(
    db: AsyncSession, identity: UserIdentity, claims: GoogleClaims
) -> GoogleSignIn:
    """Refreshes the identity's email snapshot and commits; a concurrent
    refresh of the same row raises `StaleDataError`."""
    identity.email = claims.email
    identity.email_verified = claims.email_verified
    await db.commit()
    user = await db.get(User, identity.user_id)
    if user is None:
        raise EntityNotFoundException("User", identity.user_id)
    party_id = (
        await db.execute(select(UserProfile.party_id).where(UserProfile.account_user_id == user.id))
    ).scalar_one()
    return GoogleSignIn(user=user, party_id=party_id, created=False)


async def _google_display_name(name: str | None, email: str) -> str:
    """The Google name, moderated; the email-derived name when it is blank,
    rejected or moderation is unavailable, so sign-in never fails on it."""
    collapsed = " ".join((name or "").split())[:_DISPLAY_NAME_MAX_LENGTH].strip()
    if collapsed:
        try:
            await check_text(TextField.PROFILE_NAME, collapsed)
            return collapsed
        except (TextModerationRejected, ModerationUnavailable):
            pass
    return users_service.derive_display_name(email)


async def _bootstrap_google_account(
    db: AsyncSession, claims: GoogleClaims, display_name: str
) -> tuple[User, uuid.UUID]:
    async with db.begin_nested():
        user, party = await users_service.bootstrap_person_account(
            db, email=claims.email, password=None, display_name=display_name
        )
        db.add(
            UserIdentity(
                user_id=cast(uuid.UUID, user.id),
                provider=IdentityProvider.GOOGLE,
                subject=claims.subject,
                email=claims.email,
                email_verified=claims.email_verified,
            )
        )
        await db.flush()
    return user, cast(uuid.UUID, party.id)


async def sign_in_with_google(db: AsyncSession, claims: GoogleClaims) -> GoogleSignIn:
    """A linked identity logs in; otherwise an unverified email is a 403, a
    registered email a 409, and anything else a new GUEST account with the
    identity. An insert race is re-read (identity: log in, email: 409), else
    retried once; a second unclassified failure raises `GoogleSignInFailed`."""
    identity = await find_identity(db, claims.subject)
    if identity is not None:
        return await _log_in_linked(db, identity, claims)
    if not claims.email_verified:
        raise GoogleEmailUnverified()
    if await users_service.is_email_registered(db, claims.email):
        raise GoogleEmailTaken()

    display_name = await _google_display_name(claims.name, claims.email)
    for _attempt in range(2):
        try:
            user, party_id = await _bootstrap_google_account(db, claims, display_name)
        except IntegrityError:
            identity = await find_identity(db, claims.subject)
            if identity is not None:
                return await _log_in_linked(db, identity, claims)
            if await users_service.is_email_registered(db, claims.email):
                raise GoogleEmailTaken() from None
            continue
        await db.commit()
        return GoogleSignIn(user=user, party_id=party_id, created=True)
    raise GoogleSignInFailed()
