"""`Membership` (GroupRole(MEMBER) -> Group, N:N) use cases."""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal
from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.users.service import get_profile_by_principal

from ..infrastructure import repository
from ..models import GroupRoleType, Membership
from ..schemas import CreateMembershipRequest
from .circles import _group_role_party_id, get_group
from .group_roles import get_or_create_active_group_role


async def create_membership(
    db: AsyncSession, principal: Principal, data: CreateMembershipRequest
) -> Membership:
    profile = await get_profile_by_principal(db, principal)
    await get_group(db, data.group_id)

    role = await get_or_create_active_group_role(db, profile.party_id, GroupRoleType.MEMBER)
    membership = Membership(
        from_role_id=cast(int, role.id),
        to_group_id=data.group_id,
        valid_from=data.valid_from,
        valid_to=None,
    )
    db.add(membership)
    await db.commit()
    await db.refresh(membership)
    return membership


async def end_membership(
    db: AsyncSession, principal: Principal, membership_id: int, valid_to: date
) -> Membership:
    membership = await repository.get_membership(db, membership_id)
    if membership is None:
        raise EntityNotFoundException("Membership", membership_id)
    profile = await get_profile_by_principal(db, principal)
    if await _group_role_party_id(db, membership.from_role_id) != profile.party_id:
        raise AccessDeniedException

    membership.valid_to = valid_to
    await db.commit()
    await db.refresh(membership)
    return membership


async def list_memberships_for_circle(db: AsyncSession, circle_group_id: int) -> list[Membership]:
    return await repository.list_active_memberships_for_group(db, circle_group_id)


async def list_memberships_for_party(db: AsyncSession, party_id: int) -> list[Membership]:
    role_ids = await repository.list_member_role_ids_for_party(db, party_id)
    if not role_ids:
        return []
    return await repository.list_active_memberships_for_role_ids(db, role_ids)


async def build_membership_responses(
    db: AsyncSession, memberships: list[Membership]
) -> list[dict[str, object]]:
    rows = []
    for membership in memberships:
        party_id = await _group_role_party_id(db, membership.from_role_id)
        rows.append(
            {
                "id": membership.id,
                "from_role_id": membership.from_role_id,
                "to_group_id": membership.to_group_id,
                "member_party_id": party_id,
                "valid_from": membership.valid_from,
                "valid_to": membership.valid_to,
            }
        )
    return rows
