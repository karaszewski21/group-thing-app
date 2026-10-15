"""Service-level group soft delete: `soft_delete_group` / `restore_group`
and the deleted-aware getters, called directly with `db_session`. Cases
already pinned over HTTP live in `test_group_soft_delete.py`."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.errors import (
    AccessDeniedException,
    BusinessConflictException,
    EntityNotFoundException,
)
from app.groups import service
from app.groups.application.circles import get_group_including_deleted
from app.groups.application.terms import get_term_any
from app.groups.models import Group, Term, TermAttendance
from app.party.models import Party, PartyType

NOW = datetime(2026, 10, 14, 12, 0)


async def _create_party(db: AsyncSession) -> uuid.UUID:
    party = Party(party_type=PartyType.PERSON, active=True)
    db.add(party)
    await db.flush()
    return cast(uuid.UUID, party.id)


async def _create_led_group(db: AsyncSession, name: str) -> tuple[Group, uuid.UUID]:
    organizer_party_id = await _create_party(db)
    group = await service.create_additional_circle(db, organizer_party_id, name)
    return group, organizer_party_id


async def _add_term_with_attendance(
    db: AsyncSession, group: Group, occurs_on: datetime, *, withdrawn: bool = False
) -> Term:
    term = Term(circle_group_id=group.id, occurs_on=occurs_on, description=None)
    db.add(term)
    await db.flush()
    attendance = TermAttendance(term_id=term.id, party_id=await _create_party(db), child_count=1)
    if withdrawn:
        attendance.withdrawn_at = datetime.utcnow()
    db.add(attendance)
    await db.commit()
    return term


async def test_softDeleteGroup_activeOrganizer_stampsDeletedAtAndActorAndKeepsLeadership(
    db_session: AsyncSession,
) -> None:
    group, organizer_party_id = await _create_led_group(db_session, "Krąg do usunięcia")
    group_id = cast(uuid.UUID, group.id)

    await service.soft_delete_group(db_session, group_id, organizer_party_id, is_admin=False)

    stored = await get_group_including_deleted(db_session, group_id)
    assert stored.deleted_at is not None
    assert stored.deleted_by_party_id == organizer_party_id
    leadership = await service.get_current_leadership(db_session, group_id)
    assert leadership is not None
    assert leadership.valid_to is None


async def test_softDeleteGroup_nonAdminWithoutParty_raisesAccessDenied(
    db_session: AsyncSession,
) -> None:
    group, _organizer_party_id = await _create_led_group(db_session, "Cudzy krąg")

    with pytest.raises(AccessDeniedException):
        await service.soft_delete_group(db_session, cast(uuid.UUID, group.id), None, is_admin=False)

    assert (await service.get_group(db_session, cast(uuid.UUID, group.id))).deleted_at is None


async def test_softDeleteGroup_upcomingTermWithActiveRsvp_raisesConflictWithNearestDate(
    db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    freeze_local_now(NOW)
    group, organizer_party_id = await _create_led_group(db_session, "Krąg z zapisami")
    nearest = await _add_term_with_attendance(
        db_session, group, clock.local_now() + timedelta(days=7)
    )
    await _add_term_with_attendance(db_session, group, clock.local_now() + timedelta(days=14))

    with pytest.raises(BusinessConflictException) as exc_info:
        await service.soft_delete_group(
            db_session, cast(uuid.UUID, group.id), organizer_party_id, is_admin=True
        )

    assert str(exc_info.value) == (
        f"Grupy nie można usunąć — na termin {clock.format_term_day(nearest.occurs_on)} są zapisy. "
        "Spróbuj po tym terminie albo gdy uczestnicy się wypiszą."
    )
    assert (await service.get_group(db_session, cast(uuid.UUID, group.id))).deleted_at is None


async def test_softDeleteGroup_withdrawnRsvpOrPastTerm_doesNotBlock(
    db_session: AsyncSession, freeze_local_now: Callable[[datetime], None]
) -> None:
    freeze_local_now(NOW)
    group, organizer_party_id = await _create_led_group(db_session, "Krąg bez zapisów")
    await _add_term_with_attendance(
        db_session, group, clock.local_now() + timedelta(days=3), withdrawn=True
    )
    await _add_term_with_attendance(db_session, group, clock.local_now() - timedelta(days=3))

    await service.soft_delete_group(
        db_session, cast(uuid.UUID, group.id), organizer_party_id, is_admin=False
    )

    stored = await get_group_including_deleted(db_session, cast(uuid.UUID, group.id))
    assert stored.deleted_at is not None


async def test_getGroup_deletedGroup_raisesEntityNotFound_butIncludingDeletedReturnsIt(
    db_session: AsyncSession,
) -> None:
    group, organizer_party_id = await _create_led_group(db_session, "Krąg ukryty")
    group_id = cast(uuid.UUID, group.id)
    term = Term(circle_group_id=group_id, occurs_on=NOW, description=None)
    db_session.add(term)
    await db_session.commit()
    term_id = cast(uuid.UUID, term.id)

    await service.soft_delete_group(db_session, group_id, organizer_party_id, is_admin=False)

    with pytest.raises(EntityNotFoundException):
        await service.get_group(db_session, group_id)
    with pytest.raises(EntityNotFoundException):
        await service.get_term(db_session, term_id)
    with pytest.raises(EntityNotFoundException):
        await service.soft_delete_group(db_session, group_id, organizer_party_id, is_admin=False)
    assert (await get_group_including_deleted(db_session, group_id)).id == group_id
    assert (await get_term_any(db_session, term_id)).id == term_id
    with pytest.raises(EntityNotFoundException):
        await get_group_including_deleted(db_session, uuid.uuid4())


async def test_restoreGroup_liveGroup_raisesConflict(db_session: AsyncSession) -> None:
    group, organizer_party_id = await _create_led_group(db_session, "Krąg do przywrócenia")
    group_id = cast(uuid.UUID, group.id)

    with pytest.raises(BusinessConflictException, match="^Grupa nie jest usunięta$"):
        await service.restore_group(db_session, group_id)

    await service.soft_delete_group(db_session, group_id, organizer_party_id, is_admin=False)
    await service.restore_group(db_session, group_id)

    restored = await service.get_group(db_session, group_id)
    assert restored.deleted_at is None
    assert restored.deleted_by_party_id is None
    with pytest.raises(EntityNotFoundException):
        await service.restore_group(db_session, uuid.uuid4())
