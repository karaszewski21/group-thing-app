"""Typed errors of the want use cases; their texts are in
`domain/messages.py`."""

from __future__ import annotations

import uuid

from app.core.errors import BusinessConflictException, EntityNotFoundException

from ..domain import messages


class WantNotFound(EntityNotFoundException):
    """404 with the Polish text instead of the generic English format: the
    want does not exist, belongs to another party or was withdrawn."""

    def __init__(self, want_id: uuid.UUID) -> None:
        super().__init__("Want", want_id)
        self.args = (messages.WANT_NOT_FOUND_MESSAGE,)


class WantMatchNotFound(EntityNotFoundException):
    """404: the item is not a stored match of the want."""

    def __init__(self, item_id: uuid.UUID) -> None:
        super().__init__("WantMatch", item_id)
        self.args = (messages.MATCH_NOT_FOUND_MESSAGE,)


class WantActionRefused(BusinessConflictException):
    """409: the want's status does not allow the action. `message` comes
    from `domain.lifecycle.refusal`."""


class ActiveWantCapReached(BusinessConflictException):
    def __init__(self) -> None:
        super().__init__(messages.CAP_REACHED_MESSAGE)
