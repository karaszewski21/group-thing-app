"""Term-scoped (not Circle-scoped) attendance primitives: `_require_term_eligibility`
— the guard `application/term_item_listings.py` gates every listing/browse/
take use case on — and `withdraw_attendance`, the one new mutation this
guard makes meaningful (`TermAttendance` had no soft-marker/withdraw path
before this module). Mirrors how `pledges.py` co-locates
`_require_pledging_party` with `withdraw_pledge`."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.users.service import get_profile_by_principal

from ..infrastructure import repository
from ..models import TermAttendance
from .circles import _group_role_party_id, get_current_leadership


async def _is_term_organizer(db: AsyncSession, term_circle_group_id: int, party_id: int) -> bool:
    """Whether `party_id` is the current organizer of the Circle that owns
    this Term — the organizer never RSVPs to their own Term (no
    `TermAttendance` row), so exchange-mechanism visibility for their own
    items needs this as an alternative to attendance, not a replacement."""
    leadership = await get_current_leadership(db, term_circle_group_id)
    if leadership is None:
        return False
    organizer_party_id = await _group_role_party_id(db, leadership.from_role_id)
    return organizer_party_id == party_id


async def _require_term_eligibility(
    db: AsyncSession, term_id: int, term_circle_group_id: int, party_id: int
) -> None:
    """Raises `AccessDeniedException` unless `party_id` has active
    `TermAttendance` for `term_id` **or** is the Term's Circle organizer —
    the exchange mechanism's actual visibility gate (broader than plain
    attendance, per the organizer-sharing requirement)."""
    attendance = await repository.get_active_attendance(db, term_id, party_id)
    if attendance is not None:
        return
    if await _is_term_organizer(db, term_circle_group_id, party_id):
        return
    raise AccessDeniedException


async def withdraw_attendance(
    db: AsyncSession, principal: Principal, attendance_id: int
) -> TermAttendance:
    """Idempotent: a second call on an already-withdrawn row leaves
    `withdrawn_at` at its first-set value and does not raise. Ownership
    shape mirrors `pledges._require_pledging_party`/`withdraw_pledge`
    exactly."""
    attendance = await repository.get_attendance(db, attendance_id)
    if attendance is None:
        raise EntityNotFoundException("TermAttendance", attendance_id)

    profile = await get_profile_by_principal(db, principal)
    if attendance.party_id != profile.party_id:
        raise AccessDeniedException

    if attendance.withdrawn_at is None:
        attendance.withdrawn_at = datetime.utcnow()

    await db.commit()
    await db.refresh(attendance)
    return attendance
