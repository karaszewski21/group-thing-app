"""Pure rules of `app.wants.domain`: text and radius validation, the state
machine, the notification texts and the links. No database."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest

from app.wants.domain import lifecycle, links, messages, validation
from app.wants.domain.lifecycle import WantAction
from app.wants.domain.status import WantStatus


def test_cleanName_validNames_trimmed() -> None:
    assert validation.clean_name("  kask rowerowy  ") == "kask rowerowy"
    assert validation.clean_name("abc") == "abc"
    assert validation.clean_name("ż" * 80) == "ż" * 80
    assert validation.clean_name("-- 3 --") == "-- 3 --"


@pytest.mark.parametrize(
    ("name", "message"),
    [
        ("ab", "Nazwa musi mieć od 3 do 80 znaków."),
        ("  ab  ", "Nazwa musi mieć od 3 do 80 znaków."),
        ("a" * 81, "Nazwa musi mieć od 3 do 80 znaków."),
        ("", "Nazwa musi mieć od 3 do 80 znaków."),
        ("---", "Nazwa musi zawierać literę lub cyfrę."),
        ("«!?»", "Nazwa musi zawierać literę lub cyfrę."),
    ],
)
def test_cleanName_invalidNames_raisesPolishMessage(name: str, message: str) -> None:
    with pytest.raises(ValueError) as error:
        validation.clean_name(name)

    assert str(error.value) == message


def test_cleanNote_trimsBlankToNullAndRejectsOverLength() -> None:
    assert validation.clean_note(None) is None
    assert validation.clean_note("   ") is None
    assert validation.clean_note("  rozmiar 116  ") == "rozmiar 116"
    assert validation.clean_note(" " + "ń" * 300 + " ") == "ń" * 300
    with pytest.raises(ValueError) as error:
        validation.clean_note("n" * 301)
    assert str(error.value) == "Notatka może mieć najwyżej 300 znaków."


@pytest.mark.parametrize(
    ("radius_km", "has_locality", "locality_cleared", "expected"),
    [
        (None, True, False, None),
        (0, True, False, None),
        (None, False, False, None),
        (0, False, False, None),
        (1, True, False, 1),
        (100, True, False, 100),
        (10, False, True, None),
        (101, False, True, None),
    ],
)
def test_cleanRadius_acceptedStates_storedValue(
    radius_km: int | None, has_locality: bool, locality_cleared: bool, expected: int | None
) -> None:
    stored = validation.clean_radius(
        radius_km, has_locality=has_locality, locality_cleared=locality_cleared
    )

    assert stored == expected


@pytest.mark.parametrize(
    ("radius_km", "has_locality", "message"),
    [
        (101, True, "Promień musi mieć od 1 do 100 km."),
        (-1, True, "Promień musi mieć od 1 do 100 km."),
        (10, False, "Promień można ustawić tylko razem z miejscowością."),
    ],
)
def test_cleanRadius_rejectedStates_raisesPolishMessage(
    radius_km: int, has_locality: bool, message: str
) -> None:
    with pytest.raises(ValueError) as error:
        validation.clean_radius(radius_km, has_locality=has_locality)

    assert str(error.value) == message


_NOT_ACTIVE = (WantStatus.FULFILLED, WantStatus.EXPIRED, WantStatus.WITHDRAWN)


@pytest.mark.parametrize(
    ("action", "status", "expected"),
    [
        (WantAction.EDIT, WantStatus.ACTIVE, None),
        (WantAction.EXTEND, WantStatus.ACTIVE, None),
        (WantAction.CLOSE, WantStatus.ACTIVE, None),
        (WantAction.RESUME, WantStatus.EXPIRED, None),
        (WantAction.RESUME, WantStatus.FULFILLED, None),
        *(
            (
                WantAction.EDIT,
                status,
                "To poszukiwanie nie jest aktywne. Wznów je, aby je edytować.",
            )
            for status in _NOT_ACTIVE
        ),
        *(
            (WantAction.EXTEND, status, "Przedłużyć można tylko aktywne poszukiwanie.")
            for status in _NOT_ACTIVE
        ),
        *(
            (WantAction.CLOSE, status, "To poszukiwanie jest już zamknięte.")
            for status in _NOT_ACTIVE
        ),
        (WantAction.RESUME, WantStatus.ACTIVE, "To poszukiwanie jest już aktywne."),
    ],
)
def test_refusal_actionInStatus_nullWhenAllowedElseMessage(
    action: WantAction, status: WantStatus, expected: str | None
) -> None:
    assert lifecycle.refusal(action, status) == expected


def test_lifecycle_validityPeriod() -> None:
    now = datetime(2026, 11, 15, 12, 0)

    assert lifecycle.new_expiry(now) == now + timedelta(days=90)
    assert lifecycle.auto_extension_due(now + timedelta(days=30), now) is True
    assert lifecycle.auto_extension_due(now + timedelta(days=30, seconds=1), now) is False


@pytest.mark.parametrize(
    ("count", "expected"),
    [
        (2, "Szukasz: «kask». 2 nowe pasujące rzeczy."),
        (4, "Szukasz: «kask». 4 nowe pasujące rzeczy."),
        (5, "Szukasz: «kask». 5 nowych pasujących rzeczy."),
        (11, "Szukasz: «kask». 11 nowych pasujących rzeczy."),
        (12, "Szukasz: «kask». 12 nowych pasujących rzeczy."),
        (14, "Szukasz: «kask». 14 nowych pasujących rzeczy."),
        (21, "Szukasz: «kask». 21 nowych pasujących rzeczy."),
        (22, "Szukasz: «kask». 22 nowe pasujące rzeczy."),
        (24, "Szukasz: «kask». 24 nowe pasujące rzeczy."),
        (25, "Szukasz: «kask». 25 nowych pasujących rzeczy."),
        (112, "Szukasz: «kask». 112 nowych pasujących rzeczy."),
    ],
)
def test_severalMatchesMessage_count_polishPluralForm(count: int, expected: str) -> None:
    assert messages.several_matches_message("kask", count) == expected


def test_messages_singleMatchExpiringAndCap_fixedTexts() -> None:
    assert (
        messages.single_match_message("kask", "Kask rowerowy S")
        == "Szukasz: «kask». Ktoś wystawił: «Kask rowerowy S»."
    )
    assert (
        messages.expiring_message("kask")
        == "Poszukiwanie «kask» wygaśnie za 7 dni. Przedłuż je, jeśli nadal szukasz."
    )
    assert (
        messages.CAP_REACHED_MESSAGE
        == "Masz już 30 aktywnych poszukiwań. Zamknij któreś, aby dodać nowe."
    )


def test_wantPath_id_wantedPage() -> None:
    want_id = uuid.uuid4()

    assert links.want_path(want_id) == f"/wanted/{want_id}"
