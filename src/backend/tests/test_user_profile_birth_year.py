"""`app.users.models.UserProfile.birth_year` DB-layer round trips (no HTTP
client). The column lives only in migration 0044, so these tests exercise
the real schema."""

from __future__ import annotations

import uuid

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

import app.auth.models  # noqa: F401  (registers `users`, the target of UserProfile's FK)
from app.party.models import Party, PartyType
from app.users.models import UserProfile


async def _create_profile(db_session: AsyncSession, **fields: object) -> uuid.UUID:
    party = Party(party_type=PartyType.PERSON, active=True)
    db_session.add(party)
    await db_session.flush()
    profile = UserProfile(party_id=party.id, display_name="Zosia", **fields)
    db_session.add(profile)
    await db_session.commit()
    profile_id = profile.id
    db_session.expunge_all()
    return profile_id


async def test_saveUserProfile_withBirthYear_persistsSmallInt(db_session: AsyncSession) -> None:
    profile_id = await _create_profile(db_session, birth_year=2018)

    row = (
        await db_session.execute(select(UserProfile).where(UserProfile.id == profile_id))
    ).scalar_one()
    assert row.birth_year == 2018

    column_type = (
        await db_session.execute(
            text(
                "SELECT data_type FROM information_schema.columns "
                "WHERE table_name = 'user_profiles' AND column_name = 'birth_year'"
            )
        )
    ).scalar_one()
    assert column_type == "smallint"


async def test_saveUserProfile_withoutBirthYear_defaultsNull(db_session: AsyncSession) -> None:
    profile_id = await _create_profile(db_session)

    row = (
        await db_session.execute(select(UserProfile).where(UserProfile.id == profile_id))
    ).scalar_one()
    assert row.birth_year is None
