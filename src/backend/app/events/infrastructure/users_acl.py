"""Anti-corruption layer over `app.users`: the events "guest identity"
facade and the ONLY `app.events` module that reaches the users, party and
families contexts. It resolves the caller's profile, lists display names,
creates guest profiles and re-exports the storage-disabled message. It must not import
`..schemas`."""

from __future__ import annotations

import uuid
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException
from app.party.models import PartyType
from app.party.service import create_party
from app.users.models import UserProfile
from app.users.service import AVATAR_UPLOAD_DISABLED_MESSAGE
from app.users.service import get_profile_by_principal as get_caller_profile
from app.users.service import list_chat_profiles_by_party_ids as list_display_names

__all__ = [
    "AVATAR_UPLOAD_DISABLED_MESSAGE",
    "create_guest_profile",
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


async def create_guest_profile(db: AsyncSession, name: str) -> UserProfile:
    """A new party with an account-less profile and its solo family, the
    same three steps as the Term RSVP guest path. Flushes only."""
    party = await create_party(db, PartyType.PERSON)
    party_id = cast(uuid.UUID, party.id)
    profile = UserProfile(party_id=party_id, account_user_id=None, display_name=name, email=None)
    db.add(profile)
    await db.flush()

    # Deferred like `create_rsvp`'s: app.families imports app.users.service.
    from app.families.service import create_solo_family_for_party

    await create_solo_family_for_party(db, party_id, name)
    return profile
