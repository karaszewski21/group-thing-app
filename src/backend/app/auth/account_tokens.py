"""One-time account tokens: e-mail verification and password reset.

Only the SHA-256 hex of a token is stored; the raw token lives in the link
and in the queued mail's payload. Both confirms claim the token with one
`UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING`, so of two
concurrent confirms exactly one wins and the other is gone (410).

Imports only `app.auth.models`, `app.users.models`, `app.users.schemas`,
`app.core`, `app.config` and the auth email ACL, never `auth.service` or
`users.service`, so `users.service` can call `issue_verification` without an
import cycle."""

from __future__ import annotations

import asyncio
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import cast

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.infrastructure import email_acl
from app.auth.models import AccountToken, AccountTokenPurpose, User
from app.config import settings
from app.core.auth_deps import Principal
from app.core.security import hash_password
from app.users.models import UserProfile
from app.users.schemas import normalize_email

__all__ = [
    "AccountTokenNotFound",
    "AccountTokenGone",
    "issue_verification",
    "request_verification",
    "request_password_reset",
    "lookup",
    "confirm_verification",
    "confirm_password_reset",
]

_TOKEN_BYTES = 32


class AccountTokenNotFound(Exception):
    """No token of the purpose has this hash (404)."""


class AccountTokenGone(Exception):
    """The token expired, was used, or no longer matches the profile (410)."""


@dataclass(frozen=True)
class _Claimed:
    id: uuid.UUID
    user_id: uuid.UUID
    email: str


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _rate_limited(
    db: AsyncSession, user_id: uuid.UUID, purpose: AccountTokenPurpose, now: datetime
) -> bool:
    """Fewer than one token in the last minute and at most five in the last
    hour per user and purpose."""
    last_minute, last_hour = (
        await db.execute(
            select(
                func.count().filter(
                    AccountToken.created_at > now - email_acl.TOKEN_REQUEST_MIN_INTERVAL
                ),
                func.count().filter(AccountToken.created_at > now - timedelta(hours=1)),
            ).where(AccountToken.user_id == user_id, AccountToken.purpose == purpose)
        )
    ).one()
    return bool(last_minute > 0 or last_hour >= email_acl.TOKEN_REQUESTS_PER_HOUR)


async def _issue(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    purpose: AccountTokenPurpose,
    email: str,
    ttl: timedelta,
    now: datetime,
) -> tuple[uuid.UUID, str, datetime]:
    """Marks the user's earlier unused tokens of the purpose used and adds a
    new one. Returns `(token_id, raw_token, expires_at)`."""
    await db.execute(
        update(AccountToken)
        .where(
            AccountToken.user_id == user_id,
            AccountToken.purpose == purpose,
            AccountToken.used_at.is_(None),
        )
        .values(used_at=now, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    token = AccountToken(
        id=uuid.uuid4(),
        user_id=user_id,
        purpose=purpose,
        token_hash=_hash(raw),
        email=normalize_email(email),
        expires_at=now + ttl,
    )
    db.add(token)
    return cast(uuid.UUID, token.id), raw, token.expires_at


async def issue_verification(
    db: AsyncSession, *, user_id: uuid.UUID, party_id: uuid.UUID, email: str
) -> None:
    """Issues a verification token and stages its mail in the caller's
    transaction, without committing. A no-op while email is off."""
    if not settings.email_enabled:
        return
    token_id, raw, expires_at = await _issue(
        db,
        user_id=user_id,
        purpose=AccountTokenPurpose.VERIFY_EMAIL,
        email=email,
        ttl=email_acl.VERIFY_TOKEN_TTL,
        now=datetime.utcnow(),
    )
    await email_acl.enqueue_verify_email(
        db, token_id=token_id, party_id=party_id, token=raw, expires_at=expires_at
    )


async def request_verification(db: AsyncSession, principal: Principal) -> None:
    """A resend to the caller's own address, also when it is already
    verified. Silent without an address or over the rate limit."""
    row = (
        await db.execute(
            select(User.id, UserProfile.party_id, UserProfile.email)
            .join(UserProfile, UserProfile.account_user_id == User.id)
            .where(User.username == principal.username)
        )
    ).first()
    if row is None or row.email is None:
        return
    if await _rate_limited(db, row.id, AccountTokenPurpose.VERIFY_EMAIL, datetime.utcnow()):
        return
    await issue_verification(db, user_id=row.id, party_id=row.party_id, email=row.email)
    await db.commit()


async def request_password_reset(db: AsyncSession, email: str) -> None:
    """Silent without an account for the address or over the rate limit, so
    the caller's reply never reveals an account."""
    row = (
        await db.execute(
            select(
                User.id,
                User.password_hash.is_(None).label("google_only"),
                UserProfile.party_id,
                UserProfile.email,
            )
            .join(UserProfile, UserProfile.account_user_id == User.id)
            .where(func.lower(UserProfile.email) == normalize_email(email))
            .limit(1)
        )
    ).first()
    if row is None or row.email is None:
        return
    now = datetime.utcnow()
    if await _rate_limited(db, row.id, AccountTokenPurpose.PASSWORD_RESET, now):
        return
    token_id, raw, expires_at = await _issue(
        db,
        user_id=row.id,
        purpose=AccountTokenPurpose.PASSWORD_RESET,
        email=row.email,
        ttl=email_acl.RESET_TOKEN_TTL,
        now=now,
    )
    await email_acl.enqueue_password_reset(
        db,
        token_id=token_id,
        party_id=row.party_id,
        token=raw,
        expires_at=expires_at,
        google_only=bool(row.google_only),
    )
    await db.commit()


async def lookup(db: AsyncSession, token: str, purpose: AccountTokenPurpose) -> str:
    """The token's email snapshot; a plain read that claims nothing."""
    row = (
        await db.execute(
            select(AccountToken.email, AccountToken.used_at, AccountToken.expires_at).where(
                AccountToken.token_hash == _hash(token), AccountToken.purpose == purpose
            )
        )
    ).first()
    if row is None:
        raise AccountTokenNotFound()
    if row.used_at is not None or row.expires_at <= datetime.utcnow():
        raise AccountTokenGone()
    return str(row.email)


async def _claim(
    db: AsyncSession, token: str, purpose: AccountTokenPurpose, now: datetime
) -> _Claimed:
    token_hash = _hash(token)
    row = (
        await db.execute(
            update(AccountToken)
            .where(
                AccountToken.token_hash == token_hash,
                AccountToken.purpose == purpose,
                AccountToken.used_at.is_(None),
                AccountToken.expires_at > now,
            )
            .values(used_at=now, updated_at=now)
            .returning(AccountToken.id, AccountToken.user_id, AccountToken.email)
            .execution_options(synchronize_session=False)
        )
    ).first()
    if row is not None:
        return _Claimed(id=row.id, user_id=row.user_id, email=row.email)
    known = (
        await db.execute(
            select(AccountToken.id).where(
                AccountToken.token_hash == token_hash, AccountToken.purpose == purpose
            )
        )
    ).first()
    raise AccountTokenGone() if known is not None else AccountTokenNotFound()


@dataclass(frozen=True)
class _Profile:
    id: uuid.UUID
    party_id: uuid.UUID
    email: str | None
    email_verified_at: datetime | None

    def matches(self, snapshot: str) -> bool:
        return self.email is not None and normalize_email(self.email) == snapshot


async def _profile_of(db: AsyncSession, user_id: uuid.UUID) -> _Profile | None:
    row = (
        await db.execute(
            select(
                UserProfile.id,
                UserProfile.party_id,
                UserProfile.email,
                UserProfile.email_verified_at,
            ).where(UserProfile.account_user_id == user_id)
        )
    ).first()
    if row is None:
        return None
    return _Profile(
        id=row.id, party_id=row.party_id, email=row.email, email_verified_at=row.email_verified_at
    )


async def _mark_verified(db: AsyncSession, profile_id: uuid.UUID, now: datetime) -> None:
    await db.execute(
        update(UserProfile)
        .where(UserProfile.id == profile_id)
        .values(email_verified_at=func.coalesce(UserProfile.email_verified_at, now), updated_at=now)
        .execution_options(synchronize_session="fetch")
    )


async def confirm_verification(db: AsyncSession, token: str) -> None:
    """Verifies the profile email the token was issued for and lifts a
    BOUNCE suppression of it. A changed address is gone (410), rolled back."""
    now = datetime.utcnow()
    claimed = await _claim(db, token, AccountTokenPurpose.VERIFY_EMAIL, now)
    profile = await _profile_of(db, claimed.user_id)
    if profile is None or not profile.matches(claimed.email):
        await db.rollback()
        raise AccountTokenGone()
    await _mark_verified(db, profile.id, now)
    await email_acl.clear_bounce_suppression(db, claimed.email)
    await db.commit()


async def confirm_password_reset(db: AsyncSession, token: str, password: str) -> None:
    """Sets the password (also of an account that had none), invalidates the
    user's other reset tokens and stages the password-changed mail. While the
    snapshot still matches the profile email it verifies it (I-6) and lifts a
    BOUNCE suppression of it, as a verification does: the reset mail reached
    it. The token is claimed before the bcrypt hash, which runs off the event
    loop, so an unknown token costs no hash."""
    now = datetime.utcnow()
    claimed = await _claim(db, token, AccountTokenPurpose.PASSWORD_RESET, now)
    password_hash = await asyncio.to_thread(hash_password, password)
    await db.execute(
        update(User)
        .where(User.id == claimed.user_id)
        .values(password_hash=password_hash, updated_at=now)
    )
    await db.execute(
        update(AccountToken)
        .where(
            AccountToken.user_id == claimed.user_id,
            AccountToken.purpose == AccountTokenPurpose.PASSWORD_RESET,
            AccountToken.used_at.is_(None),
        )
        .values(used_at=now, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    profile = await _profile_of(db, claimed.user_id)
    if profile is not None:
        if profile.matches(claimed.email):
            if profile.email_verified_at is None:
                await _mark_verified(db, profile.id, now)
            await email_acl.clear_bounce_suppression(db, claimed.email)
        await email_acl.enqueue_password_changed(
            db, token_id=claimed.id, party_id=profile.party_id, changed_at=now
        )
    await db.commit()
