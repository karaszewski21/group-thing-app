"""Circle CRUD and leadership transfer (strictly 1:N) use cases.

`circles` and `leaderships` are a single module: `assign_leadership` needs
`get_group` while `get_own_circle` / `update_group` need
`list_active_leaderships_for_party` / `_require_active_organizer`, so the
two form a genuine import cycle and are merged here per the import-cycle
rule (no `TYPE_CHECKING` / local-import hacks).

Ownership checks the coarse `AUTHORIZATION_MATRIX` can't express live here,
raising `AccessDeniedException` — per `standards/backend/security.md`.
"""

from __future__ import annotations

from datetime import date
from typing import cast

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AccessDeniedException, EntityNotFoundException
from app.party.models import PartyType
from app.party.service import create_party

from ..infrastructure import repository
from ..models import Group, GroupRoleType, Leadership
from ..schemas import CreateCircleRequest
from .group_roles import get_or_create_active_group_role

# --- Groups (Circles) ---------------------------------------------------------


async def create_circle(db: AsyncSession, data: CreateCircleRequest) -> Group:
    party = await create_party(db, PartyType.ORGANIZATION)
    group = Group(party_id=cast(int, party.id), name=data.name)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


async def get_own_circle(db: AsyncSession, organizer_party_id: int) -> Group | None:
    """`None` (not an exception) when the caller doesn't currently lead any
    Circle — mirrors `app.organizations.service.get_own_organization`'s
    resolve-or-None shape. Resolves via `list_active_leaderships_for_party`
    (already exists) rather than a new query — a party's "own circle" is
    whichever circle they currently, actively lead."""
    leaderships = await list_active_leaderships_for_party(db, organizer_party_id)
    if not leaderships:
        return None
    return await get_group(db, leaderships[0].to_group_id)


async def create_own_circle(db: AsyncSession, organizer_party_id: int, circle_name: str) -> Group:
    """Self-service 'become an Organizer': creates a brand-new Circle and
    assigns `organizer_party_id` as its leader in one call. Idempotent by
    design (mirrors `create_own_organization`) — a caller who already leads
    a Circle gets that same Circle back rather than a second one, so
    repeat/retry calls from the "Dodaj pierwszy termin" flow never create
    duplicate Group/Leadership rows. Callers must always derive
    `organizer_party_id` from the authenticated `Principal` (via
    `app.users.service.get_profile_by_principal`) — never from
    caller-supplied input — since `assign_leadership` itself performs no
    ownership check on who it's assigning."""
    existing = await get_own_circle(db, organizer_party_id)
    if existing is not None:
        return existing

    circle = await create_circle(db, CreateCircleRequest(name=circle_name))
    role = await get_or_create_active_group_role(db, organizer_party_id, GroupRoleType.ORGANIZATOR)
    leadership = Leadership(
        from_role_id=cast(int, role.id),
        to_group_id=cast(int, circle.id),
        valid_from=date.today(),
        valid_to=None,
    )
    db.add(leadership)
    await db.commit()
    return circle


async def list_groups(db: AsyncSession) -> list[Group]:
    return await repository.list_groups(db)


async def get_group(db: AsyncSession, group_id: int) -> Group:
    group = await repository.get_group(db, group_id)
    if group is None:
        raise EntityNotFoundException("Group", group_id)
    return group


async def update_group(db: AsyncSession, group_id: int, caller_party_id: int, name: str) -> Group:
    """In-place circle rename. Only the Circle's currently active organizer
    may rename it — enforced here, not by the coarse matrix."""
    group = await get_group(db, group_id)
    await _require_active_organizer(db, group_id, caller_party_id)
    group.name = name
    await db.commit()
    await db.refresh(group)
    return group


# --- Leadership (GroupRole(ORGANIZATOR) -> Group, strictly 1:N) ----------------


async def _group_role_party_id(db: AsyncSession, group_role_id: int) -> int:
    role = await repository.get_group_role(db, group_role_id)
    if role is None:
        raise EntityNotFoundException("GroupRole", group_role_id)
    return role.party_id


async def assign_leadership(
    db: AsyncSession, group_id: int, organizer_party_id: int, valid_from: date
) -> Leadership:
    await get_group(db, group_id)

    current = await get_current_leadership(db, group_id)
    if current is not None:
        current.valid_to = valid_from

    role = await get_or_create_active_group_role(db, organizer_party_id, GroupRoleType.ORGANIZATOR)
    leadership = Leadership(
        from_role_id=cast(int, role.id), to_group_id=group_id, valid_from=valid_from, valid_to=None
    )
    db.add(leadership)
    await db.commit()
    await db.refresh(leadership)
    return leadership


async def remove_leadership(db: AsyncSession, leadership_id: int, valid_to: date) -> Leadership:
    leadership = await repository.get_leadership(db, leadership_id)
    if leadership is None:
        raise EntityNotFoundException("Leadership", leadership_id)
    leadership.valid_to = valid_to
    await db.commit()
    await db.refresh(leadership)
    return leadership


async def build_leadership_responses(
    db: AsyncSession, leaderships: list[Leadership]
) -> list[dict[str, object]]:
    rows = []
    for leadership in leaderships:
        party_id = await _group_role_party_id(db, leadership.from_role_id)
        rows.append(
            {
                "id": leadership.id,
                "from_role_id": leadership.from_role_id,
                "to_group_id": leadership.to_group_id,
                "organizer_party_id": party_id,
                "valid_from": leadership.valid_from,
                "valid_to": leadership.valid_to,
            }
        )
    return rows


async def get_current_leadership(db: AsyncSession, group_id: int) -> Leadership | None:
    return await repository.find_current_leadership(db, group_id)


async def list_leaderships(db: AsyncSession, group_id: int) -> list[Leadership]:
    return await repository.list_leaderships_for_group(db, group_id)


async def list_active_leaderships_for_party(db: AsyncSession, party_id: int) -> list[Leadership]:
    """Every Circle `party_id` currently, actively leads."""
    role_ids = await repository.list_organizer_role_ids_for_party(db, party_id)
    if not role_ids:
        return []
    return await repository.list_active_leaderships_for_role_ids(db, role_ids)


async def _require_active_organizer(db: AsyncSession, group_id: int, party_id: int) -> None:
    current = await get_current_leadership(db, group_id)
    if current is None or await _group_role_party_id(db, current.from_role_id) != party_id:
        raise AccessDeniedException
