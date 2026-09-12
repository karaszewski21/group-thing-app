"""Anti-corruption layer over `app.outbox`: the only `app.groups` module that
imports the outbox vertical."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.outbox import service as outbox_service

__all__ = ["append_event"]


async def append_event(db: AsyncSession, *, event_type: str, payload: dict[str, Any]) -> None:
    await outbox_service.append(db, event_type=event_type, payload=payload)
