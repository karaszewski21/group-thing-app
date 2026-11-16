"""State machine of a want: which seeker action each status allows, and the
validity period. A `WITHDRAWN` want allows nothing; it is never loaded for
the seeker, so its refusal texts are not shown."""

from __future__ import annotations

import enum
from datetime import datetime

from app.wants.domain import messages
from app.wants.domain.limits import AUTO_EXTENSION_WINDOW, VALIDITY
from app.wants.domain.status import WantStatus


class WantAction(enum.StrEnum):
    EDIT = "EDIT"
    EXTEND = "EXTEND"
    CLOSE = "CLOSE"
    RESUME = "RESUME"


_ALLOWED_IN: dict[WantAction, frozenset[WantStatus]] = {
    WantAction.EDIT: frozenset({WantStatus.ACTIVE}),
    WantAction.EXTEND: frozenset({WantStatus.ACTIVE}),
    WantAction.CLOSE: frozenset({WantStatus.ACTIVE}),
    WantAction.RESUME: frozenset({WantStatus.EXPIRED, WantStatus.FULFILLED}),
}
_REFUSALS: dict[WantAction, str] = {
    WantAction.EDIT: messages.EDIT_NOT_ACTIVE_MESSAGE,
    WantAction.EXTEND: messages.EXTEND_NOT_ACTIVE_MESSAGE,
    WantAction.CLOSE: messages.CLOSE_NOT_ACTIVE_MESSAGE,
    WantAction.RESUME: messages.RESUME_ACTIVE_MESSAGE,
}


def refusal(action: WantAction, status: WantStatus) -> str | None:
    """The message of the 409 when `status` does not allow `action`, `None`
    when it does."""
    return None if status in _ALLOWED_IN[action] else _REFUSALS[action]


def new_expiry(now: datetime) -> datetime:
    """`expires_at` of a want created, extended or resumed at `now`."""
    return now + VALIDITY


def auto_extension_due(expires_at: datetime, now: datetime) -> bool:
    """Seeing the matches of an ACTIVE want renews it this close to its end."""
    return expires_at - now <= AUTO_EXTENSION_WINDOW
