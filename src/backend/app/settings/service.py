"""The single `app_settings` row: the fresh read used by every consumer and
the admin's compare-on-write."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BusinessConflictException
from app.db import mapped_transaction_conflicts
from app.settings.models import AppSettings
from app.settings.schemas import AppSettingsUpdateRequest

MAX_FEATURED_ITEMS_LIMIT = 20
_MAX_FEATURED_ITEMS_LABEL = "Limit wyróżnionych rzeczy"


class AppSettingsChangedException(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__("Ustawienia zostały zmienione w międzyczasie. Odśwież stronę.")


async def load_settings(db: AsyncSession) -> AppSettings:
    """The seeded settings row, read fresh on every use, so a change applies
    to the next read."""
    return (await db.execute(select(AppSettings))).scalar_one()


async def max_featured_items(db: AsyncSession) -> int:
    return (await load_settings(db)).max_featured_items


def _validate(body: AppSettingsUpdateRequest) -> None:
    """Raises `ValueError` (400) with the Polish message that applies."""
    if body.max_featured_items < 0:
        raise ValueError(f"{_MAX_FEATURED_ITEMS_LABEL} musi być liczbą całkowitą ≥ 0.")
    if body.max_featured_items > MAX_FEATURED_ITEMS_LIMIT:
        raise ValueError(
            f"{_MAX_FEATURED_ITEMS_LABEL} musi być liczbą całkowitą ≤ {MAX_FEATURED_ITEMS_LIMIT}."
        )


def _naive_utc(value: datetime) -> datetime:
    return value if value.tzinfo is None else value.astimezone(UTC).replace(tzinfo=None)


async def update_settings(db: AsyncSession, body: AppSettingsUpdateRequest) -> AppSettings:
    """A full replace guarded by the `updated_at` the admin read: a change
    saved in between is a 409, never overwritten. Lowering the limit keeps
    the existing featured marks."""
    _validate(body)
    async with mapped_transaction_conflicts(db):
        settings = (await db.execute(select(AppSettings).with_for_update())).scalar_one()
        if settings.updated_at != _naive_utc(body.updated_at):
            await db.rollback()
            raise AppSettingsChangedException()
        settings.max_featured_items = body.max_featured_items
        await db.commit()
    await db.refresh(settings)
    return settings
