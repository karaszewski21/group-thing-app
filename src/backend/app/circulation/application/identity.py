"""Identity resolution for `app.circulation` — this vertical has no
`Person` concept of its own, it only ever deals in raw `User` ids."""

from __future__ import annotations

from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.core.auth_deps import Principal
from app.core.errors import EntityNotFoundException


async def get_user_id_by_principal(db: AsyncSession, principal: Principal) -> int:
    """Resolves the calling `Principal` (a JWT `sub`/username) to its
    `users.id` — this vertical has no `Person` concept of its own (see
    module docstring), it only ever deals in raw `User` ids."""
    user = (
        await db.execute(select(User).where(User.username == principal.username))
    ).scalar_one_or_none()
    if user is None:
        raise EntityNotFoundException("User", principal.username)
    return cast(int, user.id)
