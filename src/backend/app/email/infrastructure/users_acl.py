"""Anti-corruption layer over `app.party`, `app.users` and `app.auth`: the ONLY
`app.email` module that reads parties and profiles. It reads their tables
only; it must not import `..schemas` or a service."""

from __future__ import annotations

import uuid
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.party.models import Party, PartyType
from app.users.models import UserProfile

__all__ = ["OwnAddress", "Recipient", "find_own_address", "get_recipients_by_party_ids"]


@dataclass(frozen=True)
class Recipient:
    """`email` is None without a profile or an address; `email_verified` is
    False then too."""

    party_id: uuid.UUID
    is_organization: bool
    email: str | None
    email_verified: bool
    display_name: str | None


async def get_recipients_by_party_ids(
    db: AsyncSession, party_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, Recipient]:
    """The recipient of every existing party in `party_ids`, in one statement."""
    if not party_ids:
        return {}
    rows = await db.execute(
        select(
            Party.id,
            Party.party_type,
            UserProfile.email,
            UserProfile.email_verified_at,
            UserProfile.display_name,
        )
        .outerjoin(UserProfile, UserProfile.party_id == Party.id)
        .where(Party.id.in_(set(party_ids)))
    )
    return {
        row.id: Recipient(
            party_id=row.id,
            is_organization=row.party_type == PartyType.ORGANIZATION,
            email=row.email or None,
            email_verified=row.email is not None and row.email_verified_at is not None,
            display_name=row.display_name,
        )
        for row in rows
    }


@dataclass(frozen=True)
class OwnAddress:
    """The caller's party and profile email; `email_verified_at` is the raw
    column, the route applies the `/me` rule."""

    party_id: uuid.UUID
    email: str | None
    email_verified_at: datetime | None


async def find_own_address(db: AsyncSession, username: str) -> OwnAddress | None:
    """The caller's party with its address in one statement, `None` without
    a profile."""
    row = (
        await db.execute(
            select(UserProfile.party_id, UserProfile.email, UserProfile.email_verified_at)
            .join(User, User.id == UserProfile.account_user_id)
            .where(User.username == username)
        )
    ).one_or_none()
    if row is None:
        return None
    return OwnAddress(
        party_id=row.party_id, email=row.email or None, email_verified_at=row.email_verified_at
    )
