"""Read-only ACL over `app.users`, `app.auth` and `app.party`: which login
users are persons who may earn points, the caller's own party, and the names
shown in the points history, and the caller's user id for owner checks."""

from __future__ import annotations

import uuid
from collections.abc import Collection

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.auth_deps import Principal
from app.party.models import Party, PartyType
from app.users.models import UserProfile


async def eligible_party_ids(
    db: AsyncSession, user_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, uuid.UUID]:
    """`{user_id: party_id}` of the users whose profile is a PERSON party;
    any other user is missing from the result."""
    if not user_ids:
        return {}
    rows = (
        await db.execute(
            select(UserProfile.account_user_id, UserProfile.party_id)
            .join(Party, Party.id == UserProfile.party_id)
            .where(
                UserProfile.account_user_id.in_(set(user_ids)),
                Party.party_type == PartyType.PERSON,
            )
        )
    ).tuples()
    return {user_id: party_id for user_id, party_id in rows if user_id is not None}


async def caller_party_id(db: AsyncSession, principal: Principal) -> uuid.UUID | None:
    """The caller's party when it is a PERSON, the only kind that holds a
    point account; `None` otherwise or without a profile."""
    return (
        await db.execute(
            select(UserProfile.party_id)
            .join(User, User.id == UserProfile.account_user_id)
            .join(Party, Party.id == UserProfile.party_id)
            .where(User.username == principal.username, Party.party_type == PartyType.PERSON)
        )
    ).scalar_one_or_none()


async def caller_user_id(db: AsyncSession, principal: Principal) -> uuid.UUID | None:
    return (
        await db.execute(select(User.id).where(User.username == principal.username))
    ).scalar_one_or_none()


async def display_names(db: AsyncSession, party_ids: Collection[uuid.UUID]) -> dict[uuid.UUID, str]:
    if not party_ids:
        return {}
    rows = (
        await db.execute(
            select(UserProfile.party_id, UserProfile.display_name).where(
                UserProfile.party_id.in_(set(party_ids))
            )
        )
    ).tuples()
    return dict(rows.all())


async def eligible_persons(db: AsyncSession, party_ids: Collection[uuid.UUID]) -> set[uuid.UUID]:
    """The parties of `party_ids` that are PERSON parties with a login."""
    if not party_ids:
        return set()
    rows = await db.execute(
        select(UserProfile.party_id)
        .join(Party, Party.id == UserProfile.party_id)
        .where(
            UserProfile.party_id.in_(set(party_ids)),
            UserProfile.account_user_id.is_not(None),
            Party.party_type == PartyType.PERSON,
        )
    )
    return set(rows.scalars().all())
