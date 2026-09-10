"""`Term` / `NeededItem` use cases, with the organizer-ownership gate
co-located with the mutations it guards (per `standards/backend/security.md`)."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import BusinessConflictException, EntityNotFoundException
from app.users.service import get_profile_by_principal

from ..infrastructure import repository
from ..models import NeededItem, Pledge, PledgeStatus, Term
from ..schemas import (
    CreateNeededItemRequest,
    CreateTermRequest,
    UpdateNeededItemRequest,
    UpdateTermRequest,
)
from .circles import _require_active_organizer, get_group


async def create_term(db: AsyncSession, principal: Principal, data: CreateTermRequest) -> Term:
    profile = await get_profile_by_principal(db, principal)
    await get_group(db, data.circle_group_id)
    await _require_active_organizer(db, data.circle_group_id, profile.party_id)

    term = Term(
        circle_group_id=data.circle_group_id, occurs_on=data.occurs_on, description=data.description
    )
    db.add(term)
    await db.commit()
    await db.refresh(term)
    return term


async def get_term(db: AsyncSession, term_id: int) -> Term:
    term = await repository.get_term(db, term_id)
    if term is None:
        raise EntityNotFoundException("Term", term_id)
    return term


async def list_terms(db: AsyncSession, circle_group_id: int) -> list[Term]:
    return await repository.list_terms_for_group(db, circle_group_id)


async def update_term(
    db: AsyncSession, term_id: int, caller_party_id: int, data: UpdateTermRequest
) -> Term:
    """Partial in-place term edit. Only the parent Circle's currently active
    organizer may edit — enforced here, not by the coarse matrix."""
    term = await get_term(db, term_id)
    await _require_active_organizer(db, term.circle_group_id, caller_party_id)

    if data.occurs_on is not None:
        term.occurs_on = data.occurs_on
    if data.description is not None:
        term.description = data.description

    await db.commit()
    await db.refresh(term)
    return term


async def create_needed_item(
    db: AsyncSession, principal: Principal, data: CreateNeededItemRequest
) -> NeededItem:
    profile = await get_profile_by_principal(db, principal)
    term = await get_term(db, data.term_id)
    await _require_active_organizer(db, term.circle_group_id, profile.party_id)

    needed_item = NeededItem(
        term_id=data.term_id, category=data.category, description=data.description
    )
    db.add(needed_item)
    await db.commit()
    await db.refresh(needed_item)
    return needed_item


async def get_needed_item(db: AsyncSession, needed_item_id: int) -> NeededItem:
    needed_item = await repository.get_needed_item(db, needed_item_id)
    if needed_item is None:
        raise EntityNotFoundException("NeededItem", needed_item_id)
    if needed_item.deleted_at is not None:
        raise EntityNotFoundException("NeededItem", needed_item_id)
    return needed_item


async def list_needed_items(db: AsyncSession, term_id: int) -> list[NeededItem]:
    return await repository.list_needed_items_for_term(db, term_id)


async def _require_needed_item_organizer(
    db: AsyncSession, needed_item_id: int, caller_party_id: int
) -> NeededItem:
    needed_item = await get_needed_item(db, needed_item_id)
    term = await get_term(db, needed_item.term_id)
    await _require_active_organizer(db, term.circle_group_id, caller_party_id)
    return needed_item


async def update_needed_item(
    db: AsyncSession,
    needed_item_id: int,
    caller_party_id: int,
    data: UpdateNeededItemRequest,
) -> NeededItem:
    """Partial in-place needed-item edit, gated on the parent term's Circle
    organizer. A soft-deleted item is a 404 (via `get_needed_item`)."""
    needed_item = await _require_needed_item_organizer(db, needed_item_id, caller_party_id)

    if data.category is not None:
        needed_item.category = data.category
    if data.description is not None:
        needed_item.description = data.description

    await db.commit()
    await db.refresh(needed_item)
    return needed_item


def _withdraw_pledge_row(pledge: Pledge) -> None:
    # TODO: notify pledger that the organizer no longer needs this item
    pledge.status = PledgeStatus.WITHDRAWN


async def soft_delete_needed_item(
    db: AsyncSession, needed_item_id: int, caller_party_id: int
) -> None:
    """Soft-delete a needed item in one transaction. Blocked (409) if any
    pledge is already FULFILLED; otherwise every OPEN/CLAIMED pledge is
    transitioned to WITHDRAWN and `deleted_at` is stamped."""
    needed_item = await _require_needed_item_organizer(db, needed_item_id, caller_party_id)

    pledges = list(
        (await db.execute(select(Pledge).where(Pledge.needed_item_id == needed_item.id))).scalars()
    )

    if any(
        pledge.status == PledgeStatus.FULFILLED or pledge.resolved_reservation_id is not None
        for pledge in pledges
    ):
        raise BusinessConflictException("Nie można usunąć — rzecz została już dostarczona")

    for pledge in pledges:
        if pledge.status in (PledgeStatus.OPEN, PledgeStatus.CLAIMED):
            _withdraw_pledge_row(pledge)

    needed_item.deleted_at = datetime.utcnow()
    await db.commit()
