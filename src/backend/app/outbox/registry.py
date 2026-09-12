"""In-process outbox event-handler registry. Deliberately generic and dumb:
this module never imports a consuming vertical — a consumer registers its own
handler against an `event_type` string it agrees on with the producer."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

Handler = Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]

_handlers: dict[str, list[Handler]] = defaultdict(list)

__all__ = ["register_handler", "get_handlers", "clear"]


def register_handler(event_type: str, handler: Handler) -> None:
    _handlers[event_type].append(handler)


def get_handlers(event_type: str) -> list[Handler]:
    return _handlers[event_type]


def clear() -> None:
    """Test-only reset of this module's global registration state."""
    _handlers.clear()
