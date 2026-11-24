"""The organizer's attendance list of a Term: the derived state, the read,
the presence ticks, the close and the auto-close job. Separate from
`attendance.py`, which holds the RSVP eligibility guard and withdrawal used
by every take/browse path."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import clock
from app.core.auth_deps import Principal
from app.core.errors import BusinessConflictException, EntityNotFoundException
from app.db import TRANSACTION_CONFLICTS, mapped_transaction_conflicts
from app.users.service import get_profile_by_principal

from ..infrastructure import points_acl, repository
from ..models import PaymentStatus, Term, TermAttendance
from ..schemas import TermAttendanceResponse, TermAttendanceState
from .circles import _require_active_organizer
from .memberships import _require_term_in_group

NOT_STARTED_MESSAGE = "Obecność zaznaczysz od rozpoczęcia terminu."
CLOSED_MESSAGE = "Obecność jest już zatwierdzona."
# The most terms one auto-close run takes on; the rest wait for the next run.
CLOSE_BATCH_SIZE = 100

logger = logging.getLogger(__name__)


def attendance_state(term: Term) -> TermAttendanceState:
    if term.attendance_closed_at is not None:
        return TermAttendanceState.CLOSED
    if clock.local_now() < term.occurs_on:
        return TermAttendanceState.NOT_STARTED
    return TermAttendanceState.OPEN


def _not_an_organizer(group_id: uuid.UUID) -> ColumnElement[bool]:
    """The attendance's party does not lead `group_id`, soft-deleted or not:
    organizers neither earn attendance points nor count toward the minimum."""
    return ~repository.holds_active_leadership(TermAttendance.party_id, group_id)


async def _organizer_term(
    db: AsyncSession, principal: Principal, group_id: uuid.UUID, term_id: uuid.UUID
) -> Term:
    """403 for anyone but the group's active organizer, then 404 for a term
    of another group — both before any state check."""
    profile = await get_profile_by_principal(db, principal)
    await _require_active_organizer(db, group_id, profile.party_id)
    return await _require_term_in_group(db, group_id, term_id)


async def get_attendance(
    db: AsyncSession, principal: Principal, group_id: uuid.UUID, term_id: uuid.UUID
) -> TermAttendanceResponse:
    term = await _organizer_term(db, principal, group_id, term_id)
    rules = await points_acl.attendance_rules(db)
    state = attendance_state(term)
    closed = state is TermAttendanceState.CLOSED
    # A closed list counts the rows active at the close, as the attendee list shows them.
    active = (
        TermAttendance.term_id == term_id,
        or_(
            TermAttendance.withdrawn_at.is_(None),
            TermAttendance.withdrawn_at > term.attendance_closed_at,
        )
        if closed
        else TermAttendance.withdrawn_at.is_(None),
    )
    attendee_count, present_count = (
        await db.execute(
            select(
                func.count(),
                func.count().filter(
                    TermAttendance.present_marked_at.is_not(None), _not_an_organizer(group_id)
                ),
            ).where(*active)
        )
    ).one()
    auto_close_on: datetime | None = (
        None if closed else term.occurs_on + timedelta(days=rules.auto_close_days)
    )
    return TermAttendanceResponse(
        state=state,
        attendance_points=term.attendance_points,
        allowed_levels=rules.levels,
        attendee_count=attendee_count,
        present_count=term.attendance_present_count if closed else present_count,
        min_present=term.attendance_min_present if closed else rules.min_present,
        auto_close_on=auto_close_on,
        closed_at=term.attendance_closed_at,
        rewarded=term.attendance_rewarded,
    )


async def set_presence(
    db: AsyncSession,
    principal: Principal,
    group_id: uuid.UUID,
    term_id: uuid.UUID,
    party_id: uuid.UUID,
    present: bool,
) -> None:
    """Ticks or unticks `party_id`'s active RSVP while the list is OPEN;
    idempotent. The term row lock serializes it with the close."""
    await _organizer_term(db, principal, group_id, term_id)
    async with mapped_transaction_conflicts(db):
        term = (
            await db.execute(
                select(Term)
                .where(Term.id == term_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        state = attendance_state(term)
        if state is not TermAttendanceState.OPEN:
            await db.rollback()
            raise BusinessConflictException(
                CLOSED_MESSAGE if state is TermAttendanceState.CLOSED else NOT_STARTED_MESSAGE
            )
        attendance = (
            await db.execute(
                select(TermAttendance).where(
                    TermAttendance.term_id == term_id,
                    TermAttendance.party_id == party_id,
                    TermAttendance.withdrawn_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if attendance is None:
            await db.rollback()
            raise EntityNotFoundException("TermAttendance", party_id)
        if present and attendance.present_marked_at is None:
            attendance.present_marked_at = datetime.utcnow()
        elif not present and attendance.present_marked_at is not None:
            attendance.present_marked_at = None
        await db.commit()


async def set_payment_status(
    db: AsyncSession,
    principal: Principal,
    group_id: uuid.UUID,
    term_id: uuid.UUID,
    party_id: uuid.UUID,
    paid: bool,
) -> None:
    """Marks or unmarks `party_id`'s row as paid in any attendance state;
    idempotent. 403 for anyone but the group's active organizer, then 404 for
    a term of another group, then 404 for a row the organizer list does not
    show (`repository.listed_attendance_condition`)."""
    profile = await get_profile_by_principal(db, principal)
    await _require_active_organizer(db, group_id, profile.party_id)
    term = await _require_term_in_group(db, group_id, term_id)
    async with mapped_transaction_conflicts(db):
        attendance = (
            await db.execute(
                select(TermAttendance)
                .where(
                    TermAttendance.party_id == party_id,
                    repository.listed_attendance_condition(term_id, term.attendance_closed_at),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if attendance is None:
            await db.rollback()
            raise EntityNotFoundException("TermAttendance", party_id)
        new_status = PaymentStatus.PAID if paid else PaymentStatus.UNPAID
        changed = attendance.payment_status != new_status
        if changed:
            attendance.payment_status = new_status
            attendance.paid_marked_at = datetime.utcnow() if paid else None
        await db.commit()
    if changed:
        logger.info(
            "Term payment status set term_id=%s party_id=%s status=%s organizer_party_id=%s",
            term_id,
            party_id,
            new_status.value,
            profile.party_id,
        )


@dataclass(frozen=True)
class CloseOutcome:
    rewarded: bool
    awarded: int


async def close_attendance(
    db: AsyncSession, term_id: uuid.UUID, *, skip_locked: bool
) -> CloseOutcome | None:
    """The close algorithm shared by the organizer and the job; flushes and
    leaves the commit to the caller. Locks the term first (lock order
    term → point accounts → items), re-checks it is OPEN, freezes the result
    on the term and awards ATTENDANCE when the minimum is met. With
    `skip_locked` (the job) a locked, closed or not yet started term rolls
    back and returns `None`; otherwise those raise 409."""
    term = (
        await db.execute(
            select(Term)
            .where(Term.id == term_id)
            .with_for_update(skip_locked=skip_locked)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()
    if term is None:
        await db.rollback()
        if skip_locked:
            return None
        raise EntityNotFoundException("Term", term_id)
    state = attendance_state(term)
    if state is not TermAttendanceState.OPEN:
        await db.rollback()
        if skip_locked:
            return None
        raise BusinessConflictException(
            CLOSED_MESSAGE if state is TermAttendanceState.CLOSED else NOT_STARTED_MESSAGE
        )

    present = (
        (
            await db.execute(
                select(TermAttendance.id, TermAttendance.party_id)
                .where(
                    TermAttendance.term_id == term_id,
                    TermAttendance.withdrawn_at.is_(None),
                    TermAttendance.present_marked_at.is_not(None),
                    _not_an_organizer(term.circle_group_id),
                )
                .order_by(TermAttendance.party_id)
            )
        )
        .tuples()
        .all()
    )
    rules = await points_acl.attendance_rules(db)
    rewarded = term.attendance_points > 0 and len(present) >= rules.min_present
    term.attendance_closed_at = datetime.utcnow()
    term.attendance_min_present = rules.min_present
    term.attendance_present_count = len(present)
    term.attendance_rewarded = rewarded
    await db.flush()

    awarded = 0
    if rewarded:
        group_names = await repository.list_group_names(db, {term.circle_group_id})
        awarded = await points_acl.award_attendance(
            db,
            group_names.get(term.circle_group_id, ""),
            term.attendance_points,
            list(present),
        )
    return CloseOutcome(rewarded=rewarded, awarded=awarded)


async def close_term_attendance(
    db: AsyncSession, principal: Principal, group_id: uuid.UUID, term_id: uuid.UUID
) -> TermAttendanceResponse:
    """„Zatwierdź obecność”: 403 before the 409 of a list that is not OPEN,
    one commit, then the attendance read."""
    await _organizer_term(db, principal, group_id, term_id)
    async with mapped_transaction_conflicts(db):
        await close_attendance(db, term_id, skip_locked=False)
        await db.commit()
    return await get_attendance(db, principal, group_id, term_id)


async def close_due_attendance(db: AsyncSession) -> None:
    """The auto-close job: closes up to `CLOSE_BATCH_SIZE` OPEN terms whose
    `occurs_on` lies `auto_close_days` or more in the past, oldest first,
    each in its own transaction. Candidates are read without locks;
    `close_attendance` re-checks each under `SKIP LOCKED`, so a term closed
    or locked meanwhile is skipped and a rerun is a no-op. A lost race is one
    WARNING and the term is retried on the next run; any other failure is
    logged once with its traceback and the loop goes on."""
    rules = await points_acl.attendance_rules(db)
    due_by = clock.local_now() - timedelta(days=rules.auto_close_days)
    term_ids = list(
        (
            await db.execute(
                select(Term.id)
                .where(Term.attendance_closed_at.is_(None), Term.occurs_on <= due_by)
                .order_by(Term.occurs_on, Term.id)
                .limit(CLOSE_BATCH_SIZE)
            )
        )
        .scalars()
        .all()
    )
    await db.commit()

    closed = awarded = 0
    for term_id in term_ids:
        try:
            outcome = await close_attendance(db, term_id, skip_locked=True)
            await db.commit()
        except DBAPIError as exc:
            await db.rollback()
            sqlstate = getattr(exc.orig, "sqlstate", None)
            if sqlstate in TRANSACTION_CONFLICTS:
                logger.warning(
                    "attendance close of term %s lost a race (%s); retrying next run",
                    term_id,
                    sqlstate,
                )
            else:
                logger.exception("attendance close of term %s failed", term_id)
            continue
        except Exception:
            await db.rollback()
            logger.exception("attendance close of term %s failed", term_id)
            continue
        if outcome is not None:
            closed += 1
            awarded += outcome.awarded
    logger.info("attendance close: closed=%d awarded=%d", closed, awarded)
