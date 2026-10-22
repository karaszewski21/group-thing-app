"""Anti-corruption layer over `app.users`: the ONLY `app.messaging` module
that imports the users context. Must not import `..schemas` (cycle)."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import AuthenticationRequiredException, Principal
from app.core.errors import EntityNotFoundException
from app.users.service import (
    get_profile_by_account_user_id,
    get_profile_by_principal,
    list_chat_profiles_by_party_ids,
)

__all__ = [
    "get_caller_party_id",
    "get_party_id_by_account_user_id",
    "list_chat_profiles_by_party_ids",
]


async def get_caller_party_id(db: AsyncSession, principal: Principal) -> uuid.UUID:
    """A token whose account has no `UserProfile` is treated as not
    authenticated (401), not as a missing resource."""
    try:
        profile = await get_profile_by_principal(db, principal)
    except EntityNotFoundException:
        raise AuthenticationRequiredException from None
    return profile.party_id


async def get_party_id_by_account_user_id(
    db: AsyncSession, account_user_id: uuid.UUID
) -> uuid.UUID:
    profile = await get_profile_by_account_user_id(db, account_user_id)
    return profile.party_id
