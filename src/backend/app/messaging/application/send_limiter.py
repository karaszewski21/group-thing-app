"""In-memory sliding-window limiter for messaging, per party: 30 messages
per minute, and 20 new ITEM conversations per hour.

`acquire_message` checks and records one send attempt in a single step (no
await in between, so concurrent requests in one worker cannot overshoot);
attempts that moderation rejects or cannot score count too. Conversations
use a separate `check_*`/`record_*` pair because a re-opened existing
conversation is never counted. `check_*`/`acquire_*` raise
`TooManyAttemptsException` (429 with `Retry-After`). State lives in this
process only (the module-level `limiter` below), like
`app.groups.application.join_code_limiter`."""

from __future__ import annotations

import math
import time
import uuid
from collections.abc import Callable

from app.core.errors import TooManyAttemptsException

_MESSAGE_LIMIT = 30
_MESSAGE_WINDOW_SECONDS = 60
_CONVERSATION_LIMIT = 20
_CONVERSATION_WINDOW_SECONDS = 60 * 60


class MessageSendLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._messages: dict[uuid.UUID, list[float]] = {}
        self._conversations: dict[uuid.UUID, list[float]] = {}

    def acquire_message(self, party_id: uuid.UUID) -> None:
        wait = self._wait(self._messages, party_id, _MESSAGE_LIMIT, _MESSAGE_WINDOW_SECONDS)
        if wait is not None:
            raise TooManyAttemptsException("Za dużo wiadomości — spróbuj ponownie za chwilę.", wait)
        self._messages.setdefault(party_id, []).append(self._clock())

    def check_new_conversation(self, party_id: uuid.UUID) -> None:
        wait = self._wait(
            self._conversations, party_id, _CONVERSATION_LIMIT, _CONVERSATION_WINDOW_SECONDS
        )
        if wait is not None:
            minutes = math.ceil(wait / 60)
            raise TooManyAttemptsException(
                f"Za dużo nowych rozmów — spróbuj ponownie za {minutes} min", wait
            )

    def record_new_conversation(self, party_id: uuid.UUID) -> None:
        self._conversations.setdefault(party_id, []).append(self._clock())

    def reset(self) -> None:
        self._messages.clear()
        self._conversations.clear()

    def _wait(
        self, store: dict[uuid.UUID, list[float]], key: uuid.UUID, limit: int, window: float
    ) -> int | None:
        """Prunes `key`, deleting it when empty; returns the whole seconds
        (at least 1) until it drops below `limit`, or `None` if it is not
        exceeded. Indexing `ts[len - limit]` stays correct under overshoot."""
        now = self._clock()
        timestamps = [ts for ts in store.get(key, []) if ts > now - window]
        if not timestamps:
            store.pop(key, None)
            return None
        store[key] = timestamps
        if len(timestamps) < limit:
            return None
        return max(1, math.ceil(timestamps[len(timestamps) - limit] + window - now))


limiter = MessageSendLimiter()
