"""`GroupRole` use case: get-or-create the caller's standing active role of
a given type."""

from __future__ import annotations

from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from ..infrastructure import repository
from ..models import GroupRole, GroupRoleType


async def get_or_create_active_group_role(
    db: AsyncSession, party_id: int, role_type: GroupRoleType
) -> GroupRole:
    """The same active role instance is reused across repeat grants for the
    same party (e.g. a person leading several Circles shares one
    `ORGANIZATOR` `GroupRole` row) — a role is a standing capacity, not a
    per-Circle record; the specific Circle binding lives on
    `Leadership`/`Membership`."""
    existing = await repository.find_active_group_role(db, party_id, role_type)
    if existing is not None:
        return existing
    role = GroupRole(party_id=party_id, role_type=role_type, valid_from=date.today(), valid_to=None)
    db.add(role)
    await db.flush()
    return role
