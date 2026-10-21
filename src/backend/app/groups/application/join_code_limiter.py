"""In-memory sliding-window limiter for failed join-code redemptions.

Two keys: `(party_id, group_id)` allows 10 failures per 15 minutes, and
`group_id` allows 30 failures per hour across all parties. State lives in
this process only (the module-level `limiter` below), so it is lost on
restart and weakens if uvicorn ever runs more than one worker. Methods are
synchronous, so no lock is needed within one event loop.
"""

from __future__ import annotations

import math
import time
import uuid
from collections.abc import Callable, Hashable

from app.core.errors import TooManyAttemptsException

_USER_LIMIT = 10
_USER_WINDOW_SECONDS = 15 * 60
_GROUP_LIMIT = 30
_GROUP_WINDOW_SECONDS = 60 * 60


class JoinCodeLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._user_failures: dict[tuple[uuid.UUID, uuid.UUID], list[float]] = {}
        self._group_failures: dict[uuid.UUID, list[float]] = {}

    def check(self, party_id: uuid.UUID, group_id: uuid.UUID) -> None:
        """Raises `TooManyAttemptsException` with the longest wait among the
        exceeded keys. A key is exceeded at `limit` failures, so the attempt
        after the last allowed failure is blocked."""
        now = self._clock()
        waits = [
            self._wait(
                self._user_failures, (party_id, group_id), now, _USER_LIMIT, _USER_WINDOW_SECONDS
            ),
            self._wait(self._group_failures, group_id, now, _GROUP_LIMIT, _GROUP_WINDOW_SECONDS),
        ]
        longest = max((w for w in waits if w is not None), default=None)
        if longest is None:
            return
        retry_after_seconds = max(1, math.ceil(longest))
        minutes = math.ceil(retry_after_seconds / 60)
        raise TooManyAttemptsException(
            f"Za dużo prób wpisania kodu — spróbuj ponownie za {minutes} min",
            retry_after_seconds,
        )

    def record_failure(self, party_id: uuid.UUID, group_id: uuid.UUID) -> None:
        now = self._clock()
        self._user_failures.setdefault((party_id, group_id), []).append(now)
        self._group_failures.setdefault(group_id, []).append(now)

    def clear(self, party_id: uuid.UUID, group_id: uuid.UUID) -> None:
        """Drops the user key only; the group key is never cleared."""
        self._user_failures.pop((party_id, group_id), None)

    def reset(self) -> None:
        self._user_failures.clear()
        self._group_failures.clear()

    @staticmethod
    def _wait[K: Hashable](
        store: dict[K, list[float]], key: K, now: float, limit: int, window: float
    ) -> float | None:
        """Prunes `key`, deleting it when empty; returns the seconds until it
        drops below `limit`, or `None` if it is not exceeded. Indexing
        `ts[len - limit]` keeps the wait correct when concurrent requests
        overshoot the budget."""
        timestamps = [ts for ts in store.get(key, []) if ts > now - window]
        if not timestamps:
            store.pop(key, None)
            return None
        store[key] = timestamps
        if len(timestamps) < limit:
            return None
        return timestamps[len(timestamps) - limit] + window - now


limiter = JoinCodeLimiter()
