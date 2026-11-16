"""Polish texts of wants: the notification messages and the error
messages. The caller caps a notification message to the column length."""

from __future__ import annotations

from app.wants.domain.limits import (
    MAX_ACTIVE_WANTS,
    NAME_MAX_LENGTH,
    NAME_MIN_LENGTH,
    NOTE_MAX_LENGTH,
    RADIUS_MAX_KM,
    RADIUS_MIN_KM,
    REMINDER_LEAD,
)

NAME_LENGTH_MESSAGE = f"Nazwa musi mieć od {NAME_MIN_LENGTH} do {NAME_MAX_LENGTH} znaków."
NAME_WITHOUT_LETTER_OR_DIGIT_MESSAGE = "Nazwa musi zawierać literę lub cyfrę."
NOTE_TOO_LONG_MESSAGE = f"Notatka może mieć najwyżej {NOTE_MAX_LENGTH} znaków."
RADIUS_WITHOUT_LOCALITY_MESSAGE = "Promień można ustawić tylko razem z miejscowością."
RADIUS_OUT_OF_RANGE_MESSAGE = f"Promień musi mieć od {RADIUS_MIN_KM} do {RADIUS_MAX_KM} km."
UNKNOWN_CATEGORY_MESSAGE = "Wybrana kategoria nie istnieje."
UNKNOWN_LOCALITY_MESSAGE = "Wybrana miejscowość nie istnieje."

CAP_REACHED_MESSAGE = (
    f"Masz już {MAX_ACTIVE_WANTS} aktywnych poszukiwań. Zamknij któreś, aby dodać nowe."
)
EDIT_NOT_ACTIVE_MESSAGE = "To poszukiwanie nie jest aktywne. Wznów je, aby je edytować."
EXTEND_NOT_ACTIVE_MESSAGE = "Przedłużyć można tylko aktywne poszukiwanie."
CLOSE_NOT_ACTIVE_MESSAGE = "To poszukiwanie jest już zamknięte."
RESUME_ACTIVE_MESSAGE = "To poszukiwanie jest już aktywne."

WANT_NOT_FOUND_MESSAGE = "Nie znaleziono poszukiwania."
MATCH_NOT_FOUND_MESSAGE = "Nie znaleziono dopasowania."
FORWARD_MATCH_TIMEOUT_MESSAGE = "Szukanie dopasowań trwa zbyt długo. Spróbuj ponownie za chwilę."


def single_match_message(want_name: str, product_name: str) -> str:
    return f"Szukasz: «{want_name}». Ktoś wystawił: «{product_name}»."


def several_matches_message(want_name: str, count: int) -> str:
    """For a count of 2 or more; 2-4, 22-24, ... take the "nowe" form, but
    12-14 do not."""
    few = count % 10 in (2, 3, 4) and count % 100 not in (12, 13, 14)
    things = "nowe pasujące rzeczy" if few else "nowych pasujących rzeczy"
    return f"Szukasz: «{want_name}». {count} {things}."


def expiring_message(want_name: str) -> str:
    return (
        f"Poszukiwanie «{want_name}» wygaśnie za {REMINDER_LEAD.days} dni. "
        "Przedłuż je, jeśli nadal szukasz."
    )
