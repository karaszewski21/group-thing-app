"""Party root service: create/deactivate the global identity anchor.

No public router sits on this module — `Party` rows are created internally
by `app.users`/`app.groups`/`app.families` whenever they create a
UserProfile/Group/Family, never directly by a client (no evidence of a
standalone "create a bare Party" use case today)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from .models import Party, PartyType


async def create_party(db: AsyncSession, party_type: PartyType) -> Party:
    """Flushes (not commits) — always called as one step of a larger,
    caller-owned transaction (e.g. `app.users.service.register`)."""
    party = Party(party_type=party_type, active=True)
    db.add(party)
    await db.flush()
    return party


async def deactivate_party(db: AsyncSession, party: Party) -> None:
    party.active = False
    await db.flush()
