"""`POST /{id}/read`: moves the caller's read marker forward to a
message's `created_at`, never back. Allowed on read-only conversations."""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import Principal

from ..infrastructure import repository
from .messages import get_anchor, load_accessible


async def mark_read(
    db: AsyncSession, principal: Principal, conversation_id: uuid.UUID, message_id: uuid.UUID
) -> None:
    me, _, _ = await load_accessible(db, principal, conversation_id)
    message = await get_anchor(db, conversation_id, message_id)
    await repository.upsert_read_marker(db, conversation_id, me, message.created_at)
    await db.commit()
