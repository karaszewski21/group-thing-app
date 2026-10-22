"""PRIVATE-Circle join codes: the active organizer reads (lazily creating)
or regenerates the Circle's 6-digit code, and any account-backed caller
redeems it for an active `Membership`.

Ownership checks live here, raising `AccessDeniedException` — the matrix
only gates the routes, per `standards/backend/security.md`. The code is
never logged and appears only in `JoinCodeResponse`.
"""

from __future__ import annotations

import logging
import secrets
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from app.core.auth_deps import AuthenticationRequiredException, Principal
from app.core.errors import (
    BusinessConflictException,
    EntityNotFoundException,
    TooManyAttemptsException,
)
from app.users.service import get_profile_by_principal

from ..models import Group, GroupVisibility
from .circles import _require_active_organizer, get_group, is_active_group_organizer
from .join_code_limiter import limiter
from .memberships import _is_active_member, add_active_membership

logger = logging.getLogger(__name__)

_PUBLIC_GROUP_MESSAGE = "Grupa jest publiczna — kod dostępu nie jest potrzebny"
_WRONG_CODE_MESSAGE = "Nieprawidłowy kod dostępu — sprawdź i spróbuj ponownie"


async def _get_caller_party_id(db: AsyncSession, principal: Principal) -> uuid.UUID:
    """A token whose account has no `UserProfile` is treated as not
    authenticated (401), not as a missing resource."""
    try:
        profile = await get_profile_by_principal(db, principal)
    except EntityNotFoundException:
        raise AuthenticationRequiredException from None
    return profile.party_id


async def _get_private_group(db: AsyncSession, group_id: uuid.UUID) -> Group:
    group = await get_group(db, group_id)
    if group.visibility != GroupVisibility.PRIVATE:
        raise EntityNotFoundException("Group", group_id)
    return group


def _generate_code() -> str:
    return f"{secrets.randbelow(10**6):06d}"


def _require_private(group: Group) -> None:
    if group.visibility != GroupVisibility.PRIVATE:
        raise BusinessConflictException(_PUBLIC_GROUP_MESSAGE)


async def _get_organizer_private_group(
    db: AsyncSession, principal: Principal, group_id: uuid.UUID
) -> Group:
    """404 unknown/soft-deleted → 403 not the active organizer → 409 PUBLIC."""
    group = await get_group(db, group_id)
    party_id = await _get_caller_party_id(db, principal)
    await _require_active_organizer(db, group_id, party_id)
    _require_private(group)
    return group


async def get_join_code(db: AsyncSession, principal: Principal, group_id: uuid.UUID) -> str:
    """Returns the Circle's code, generating it on first read. A concurrent
    write to the Circle (any `updated_at` bump) fails the lazy commit with
    `StaleDataError`; the group is then re-read and re-decided once, and a
    second race propagates to the global 409 handler."""
    group = await _get_organizer_private_group(db, principal, group_id)
    if group.join_code is not None:
        return group.join_code
    code = _generate_code()
    group.join_code = code
    try:
        await db.commit()
    except StaleDataError:
        await db.rollback()
    else:
        return code

    # The pre-rollback instance is expired; only the re-read one is used.
    group = await get_group(db, group_id)
    _require_private(group)
    if group.join_code is not None:
        return group.join_code
    code = _generate_code()
    group.join_code = code
    await db.commit()
    return code


async def regenerate_join_code(db: AsyncSession, principal: Principal, group_id: uuid.UUID) -> str:
    group = await _get_organizer_private_group(db, principal, group_id)
    code = _generate_code()
    group.join_code = code
    await db.commit()
    return code


async def redeem_join_code(
    db: AsyncSession, principal: Principal, group_id: uuid.UUID, code: str
) -> bool:
    """Returns whether a `Membership` was created. Order: 401 → 404
    (unknown, soft-deleted or PUBLIC) → 429 → 409 (missing or wrong code,
    one message for both) → `False` for the organizer or an active member →
    `True` after adding the membership. Every correct-code path clears the
    caller's limiter key; the group key is never cleared."""
    party_id = await _get_caller_party_id(db, principal)
    group = await _get_private_group(db, group_id)
    try:
        limiter.check(party_id, group_id)
    except TooManyAttemptsException as exc:
        logger.warning(
            "Join code redeem blocked group_id=%s party_id=%s retry_after_seconds=%s",
            group_id,
            party_id,
            exc.retry_after_seconds,
        )
        raise

    stored = group.join_code
    if stored is None or not secrets.compare_digest(stored, code):
        limiter.record_failure(party_id, group_id)
        raise BusinessConflictException(_WRONG_CODE_MESSAGE)

    if await is_active_group_organizer(db, group_id, party_id) or await _is_active_member(
        db, group_id, party_id
    ):
        limiter.clear(party_id, group_id)
        _log_redeemed(group_id, party_id, created=False)
        return False

    await add_active_membership(db, group_id, party_id)
    await db.commit()
    limiter.clear(party_id, group_id)
    _log_redeemed(group_id, party_id, created=True)
    return True


def _log_redeemed(group_id: uuid.UUID, party_id: uuid.UUID, *, created: bool) -> None:
    logger.info(
        "Join code redeemed group_id=%s party_id=%s created=%s", group_id, party_id, created
    )
