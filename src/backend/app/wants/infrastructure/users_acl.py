"""Anti-corruption layer over `app.users`: the ONLY `app.wants` module that
imports the users vertical. It resolves the caller's profile. It must not
import `..schemas`."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import AuthenticationRequiredException, Principal
from app.core.errors import EntityNotFoundException
from app.users.service import get_profile_by_principal

__all__ = ["CallerProfile", "get_caller_profile"]


@dataclass(frozen=True)
class CallerProfile:
    party_id: uuid.UUID
    account_user_id: uuid.UUID


async def get_caller_profile(db: AsyncSession, principal: Principal) -> CallerProfile:
    """A token whose account has no `UserProfile` is treated as not
    authenticated (401), not as a missing resource."""
    try:
        profile = await get_profile_by_principal(db, principal)
    except EntityNotFoundException:
        raise AuthenticationRequiredException from None
    if profile.account_user_id is None:
        raise AuthenticationRequiredException
    return CallerProfile(party_id=profile.party_id, account_user_id=profile.account_user_id)
