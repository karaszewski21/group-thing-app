"""`Pledge` use cases, with the pledging-party ownership gate co-located
with the mutations it guards (per `standards/backend/security.md`)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.users.service import get_profile_by_principal

from ..infrastructure import repository
from ..models import Pledge, PledgeStatus
from .terms import get_needed_item


async def create_pledge(db: AsyncSession, principal: Principal, needed_item_id: int) -> Pledge:
    profile = await get_profile_by_principal(db, principal)
    await get_needed_item(db, needed_item_id)

    pledge = Pledge(
        needed_item_id=needed_item_id,
        pledged_by_party_id=profile.party_id,
        status=PledgeStatus.CLAIMED,
    )
    db.add(pledge)
    await db.commit()
    await db.refresh(pledge)
    return pledge


async def get_pledge(db: AsyncSession, pledge_id: int) -> Pledge:
    pledge = await repository.get_pledge(db, pledge_id)
    if pledge is None:
        raise EntityNotFoundException("Pledge", pledge_id)
    return pledge


async def list_pledges(db: AsyncSession, needed_item_id: int) -> list[Pledge]:
    await get_needed_item(db, needed_item_id)
    return await repository.list_pledges_for_needed_item(db, needed_item_id)


def _require_pledging_party(pledge: Pledge, party_id: int) -> None:
    if pledge.pledged_by_party_id != party_id:
        raise AccessDeniedException


async def withdraw_pledge(db: AsyncSession, principal: Principal, pledge_id: int) -> Pledge:
    pledge = await get_pledge(db, pledge_id)
    profile = await get_profile_by_principal(db, principal)
    _require_pledging_party(pledge, profile.party_id)

    pledge.status = PledgeStatus.WITHDRAWN
    await db.commit()
    await db.refresh(pledge)
    return pledge
