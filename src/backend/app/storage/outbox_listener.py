"""Deletes stored objects after the database rows pointing at them are gone.
Producers stage `storage.objects_delete` in the same commit as the row
delete, so a failed storage call is retried by the outbox instead of being
lost; an already-deleted key is not an error for S3 `DeleteObjects`."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.outbox import registry

from .service import get_storage

OBJECTS_DELETE = "storage.objects_delete"

__all__ = ["OBJECTS_DELETE", "register"]


async def _handle_objects_delete(_db: AsyncSession, payload: dict[str, Any]) -> None:
    storage = get_storage()
    if storage is None:
        raise RuntimeError("Photo storage is not configured")
    await storage.delete([str(key) for key in payload["keys"]])


def register() -> None:
    registry.register_handler(OBJECTS_DELETE, _handle_objects_delete)
