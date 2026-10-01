"""Identity resolution for `app.circulation` — this vertical has no
`Person` concept of its own, it only ever deals in raw `User` ids."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException


async def find_user_id_by_principal(db: AsyncSession, principal: Principal) -> uuid.UUID | None:
    """The calling `Principal`'s `users.id`, or `None` when no `User` backs
    it (e.g. an OAuth/MCP principal) — read paths then treat the caller as
    an outsider instead of failing."""
    user_id = (
        await db.execute(select(User.id).where(User.username == principal.username))
    ).scalar_one_or_none()
    return user_id


async def get_user_id_by_principal(db: AsyncSession, principal: Principal) -> uuid.UUID:
    """Resolves the calling `Principal` (a JWT `sub`/username) to its
    `users.id` — this vertical has no `Person` concept of its own (see
    module docstring), it only ever deals in raw `User` ids."""
    user_id = await find_user_id_by_principal(db, principal)
    if user_id is None:
        raise EntityNotFoundException("User", principal.username)
    return user_id
