"""`app.groups.models.ItemListingPreference` (standing per-item lending/
exchange mode) and `TermAttendance.withdrawn_at` (nullable column) — DB-layer
round trips only, no HTTP client, no `relationship()` traversal (none
declared on either model, per `standards/backend/models.md`)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.groups.models import Group, ItemListingPreference, Term, TermAttendance
from app.party.models import Party, PartyType


async def _create_party(db_session: AsyncSession) -> int:
    party = Party(party_type=PartyType.PERSON)
    db_session.add(party)
    await db_session.flush()
    return party.id


async def _create_term(db_session: AsyncSession) -> int:
    organizer_party_id = await _create_party(db_session)
    group = Group(party_id=organizer_party_id, name="Test Circle")
    db_session.add(group)
    await db_session.flush()
    term = Term(circle_group_id=group.id, occurs_on=datetime.utcnow())
    db_session.add(term)
    await db_session.flush()
    return term.id


async def test_itemListingPreference_roundTripsAllColumns_viaRawInsertAndSelect(
    db_session: AsyncSession,
) -> None:
    owner_party_id = await _create_party(db_session)
    now = datetime.utcnow()

    await db_session.execute(
        insert(ItemListingPreference.__table__).values(
            item_id=4242,
            owner_party_id=owner_party_id,
            mode="LEND",
            created_at=now,
            updated_at=now,
        )
    )
    await db_session.commit()

    row = (
        await db_session.execute(
            select(ItemListingPreference).where(ItemListingPreference.item_id == 4242)
        )
    ).scalar_one()

    assert row.item_id == 4242
    assert row.owner_party_id == owner_party_id
    assert row.mode == "LEND"


async def test_itemListingPreference_mode_persistsAsString(db_session: AsyncSession) -> None:
    owner_party_id = await _create_party(db_session)

    preference = ItemListingPreference(item_id=1, owner_party_id=owner_party_id, mode="SWAP")
    db_session.add(preference)
    await db_session.commit()

    row = (
        await db_session.execute(
            select(ItemListingPreference).where(ItemListingPreference.id == preference.id)
        )
    ).scalar_one()

    assert type(row.mode) is str
    assert row.mode == "SWAP"


async def test_termAttendance_withdrawnAt_defaultsNullOnInsert(db_session: AsyncSession) -> None:
    term_id = await _create_term(db_session)
    party_id = await _create_party(db_session)

    attendance = TermAttendance(term_id=term_id, party_id=party_id, child_count=1)
    db_session.add(attendance)
    await db_session.commit()

    row = (
        await db_session.execute(select(TermAttendance).where(TermAttendance.id == attendance.id))
    ).scalar_one()
    assert row.withdrawn_at is None


async def test_termAttendance_withdrawnAt_acceptsDatetimeAndRoundTrips(
    db_session: AsyncSession,
) -> None:
    term_id = await _create_term(db_session)
    party_id = await _create_party(db_session)
    withdrawn_at = datetime.utcnow().replace(microsecond=0)

    attendance = TermAttendance(
        term_id=term_id, party_id=party_id, child_count=0, withdrawn_at=withdrawn_at
    )
    db_session.add(attendance)
    await db_session.commit()

    row = (
        await db_session.execute(select(TermAttendance).where(TermAttendance.id == attendance.id))
    ).scalar_one()
    assert row.withdrawn_at == withdrawn_at
