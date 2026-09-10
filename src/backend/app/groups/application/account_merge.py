"""Account-merge (unauthenticated) use case: fold an anonymous RSVP's
`UserProfile` into a newly-created account. Identity-conflict checks live
here, not the router (per `standards/backend/security.md`)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.users.models import UserProfile
from app.users.service import (
    AlreadyMergedException,
    DuplicateEmailException,
    create_account,
    derive_username_from_email,
    get_profile,
)

from ..infrastructure import repository


async def merge_anonymous_profile(
    db: AsyncSession, user_profile_id: int, email: str, password: str
) -> tuple[User, UserProfile]:
    """Merges an anonymous RSVP's `UserProfile` into a newly-created
    account: **updates the existing row's `account_user_id`/`email` in
    place** — never creates a second Party/UserProfile. `party_id`, the
    row's `id`, `display_name`, and every `TermAttendance` row referencing
    its `party_id` are untouched. Ownership/identity conflict checks
    (`AlreadyMergedException`, `DuplicateEmailException`) live here, not the
    router, per `standards/backend/security.md`."""
    profile = await get_profile(db, user_profile_id)
    if profile.account_user_id is not None:
        raise AlreadyMergedException()

    # Postgres advisory lock keyed by the target email, held for the rest of
    # this transaction: closes the check-then-act race where two concurrent
    # merge calls for the same email could otherwise both pass the
    # `existing is None` check below before either commits. Auto-released on
    # commit/rollback — no separate unlock call needed, no schema change.
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext(email))))

    existing = await repository.find_profile_by_email(db, email)
    if existing is not None:
        raise DuplicateEmailException()

    username = await derive_username_from_email(db, email)
    user = await create_account(db, username, password)

    profile.account_user_id = user.id
    profile.email = email
    await db.commit()
    await db.refresh(profile)
    return user, profile
