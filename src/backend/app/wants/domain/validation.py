"""Pure input rules of a want. Each returns the value to store or raises
`ValueError` with the Polish message (a 400)."""

from __future__ import annotations

from app.wants.domain import messages
from app.wants.domain.limits import (
    NAME_MAX_LENGTH,
    NAME_MIN_LENGTH,
    NOTE_MAX_LENGTH,
    RADIUS_MAX_KM,
    RADIUS_MIN_KM,
)


def clean_name(name: str) -> str:
    name = name.strip()
    if not NAME_MIN_LENGTH <= len(name) <= NAME_MAX_LENGTH:
        raise ValueError(messages.NAME_LENGTH_MESSAGE)
    if not any(character.isalnum() for character in name):
        raise ValueError(messages.NAME_WITHOUT_LETTER_OR_DIGIT_MESSAGE)
    return name


def clean_note(note: str | None) -> str | None:
    note = (note or "").strip()
    if len(note) > NOTE_MAX_LENGTH:
        raise ValueError(messages.NOTE_TOO_LONG_MESSAGE)
    return note or None


def clean_radius(
    radius_km: int | None, *, has_locality: bool, locality_cleared: bool = False
) -> int | None:
    """`has_locality` is the state after the write. `locality_cleared`: this
    write removes a stored locality, which drops the radius whatever was
    sent. 0 and `None` both mean "that locality only" and are stored as
    `None`."""
    if not radius_km or locality_cleared:
        return None
    if not RADIUS_MIN_KM <= radius_km <= RADIUS_MAX_KM:
        raise ValueError(messages.RADIUS_OUT_OF_RANGE_MESSAGE)
    if not has_locality:
        raise ValueError(messages.RADIUS_WITHOUT_LOCALITY_MESSAGE)
    return radius_km
