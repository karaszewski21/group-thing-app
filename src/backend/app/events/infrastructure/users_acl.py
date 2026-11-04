"""Anti-corruption layer over `app.users`: the ONLY `app.events` module
that reaches the users context. It resolves the caller's profile, lists
display names and re-exports the storage-disabled message. It must not import
`..schemas`."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.users.models import UserProfile
from app.users.service import AVATAR_UPLOAD_DISABLED_MESSAGE
from app.users.service import get_profile_by_principal as get_caller_profile
from app.users.service import list_chat_profiles_by_party_ids as list_display_names

__all__ = [
    "AVATAR_UPLOAD_DISABLED_MESSAGE",
    "find_caller_profile",
    "get_caller_profile",
    "list_display_names",
]


async def find_caller_profile(db: AsyncSession, principal: Principal | None) -> UserProfile | None:
    """The caller's profile, or `None` with no token or no profile behind it
    (never an error: public routes degrade to the anonymous view)."""
    if principal is None:
        return None
    try:
        return await get_caller_profile(db, principal)
    except EntityNotFoundException:
        return None
