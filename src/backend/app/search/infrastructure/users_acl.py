"""Anti-corruption layer over `app.users`: the ONLY `app.search` module that
imports the users vertical. It resolves the caller's party in one statement
and loads the display names of person organizers and authors in one
statement. It must not import `..schemas`."""

from __future__ import annotations

import uuid
from collections.abc import Collection

from sqlalchemy.ext.asyncio import AsyncSession

from app.users.service import find_party_id_by_principal, list_chat_profiles_by_party_ids

__all__ = ["find_party_id_by_principal", "load_display_names"]


async def load_display_names(
    db: AsyncSession, party_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, str]:
    """`{party_id: display_name}` of the parties with a profile."""
    profiles = await list_chat_profiles_by_party_ids(db, party_ids)
    return {party_id: name for party_id, (name, _) in profiles.items()}
