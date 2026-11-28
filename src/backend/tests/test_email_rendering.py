"""Email core: the pure rules, the signed unsubscribe link and the templates."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any

import jinja2
import pytest

from app.config import settings
from app.email import links, rules
from app.email.models import EmailCategory, EmailTemplate
from app.email.rendering import render

_BASE = "https://gooo.example.test"
_NOW = datetime(2026, 11, 27, 12, 0)


@pytest.fixture
def email_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_public_base_url", _BASE)
    monkeypatch.setattr(settings, "email_from_name", "Gooo")
    monkeypatch.setattr(settings, "email_link_signing_secret", "s" * 40)


@pytest.mark.parametrize(
    ("check", "expected"),
    [
        (lambda: rules.is_quiet(datetime(2026, 11, 27, 21, 59)), False),
        (lambda: rules.is_quiet(datetime(2026, 11, 27, 22, 0)), True),
        (lambda: rules.is_quiet(datetime(2026, 11, 28, 6, 59)), True),
        (lambda: rules.is_quiet(datetime(2026, 11, 28, 7, 0)), False),
        (lambda: rules.want_match_day(datetime(2026, 11, 27, 23, 0)), date(2026, 11, 28)),
        (lambda: rules.want_match_day(datetime(2026, 11, 28, 8, 0)), date(2026, 11, 28)),
        (lambda: rules.next_send_after(_NOW, 1), _NOW + timedelta(minutes=1)),
        (lambda: rules.next_send_after(_NOW, 3), _NOW + timedelta(minutes=15)),
        (lambda: rules.next_send_after(_NOW, 5), _NOW + timedelta(minutes=240)),
        (lambda: rules.category_enabled({}, EmailCategory.RESERVATIONS), True),
        (lambda: rules.category_enabled({}, EmailCategory.MESSAGES), False),
        (lambda: rules.category_enabled({"WANTS": False}, EmailCategory.WANTS), False),
        (
            lambda: rules.category_enabled(
                {"ALL": False, "RESERVATIONS": True}, EmailCategory.RESERVATIONS
            ),
            False,
        ),
        (lambda: rules.KIND_RULES["SWAP_PROPOSED"].category, EmailCategory.RESERVATIONS),
        (lambda: rules.KIND_RULES["WANT_MATCH_FOUND"].category, EmailCategory.WANTS),
        (lambda: len(rules.KIND_RULES), 7),
    ],
)
def test_rules_helpers_matchSpecifiedBoundaries(check: Callable[[], Any], expected: Any) -> None:
    assert check() == expected


def test_unsubscribeToken_roundTrip_rejectsTamperedAndAll(
    email_settings: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    party_id = uuid.uuid4()
    token = links.sign_unsubscribe(party_id, EmailCategory.WANTS)

    version, category, pid, signature = token.split(".")
    assert (version, category, pid) == ("1", "WANTS", str(party_id))
    assert "=" not in signature
    assert links.verify_unsubscribe(token) == links.UnsubscribeTarget(party_id, EmailCategory.WANTS)

    for spelling in (str(party_id).upper(), party_id.hex, f"{{{party_id}}}"):
        assert links.verify_unsubscribe(f"1.WANTS.{spelling}.{signature}") is None

    tampered = f"1.WANTS.{party_id}.{signature[:-1]}{'A' if signature[-1] != 'A' else 'B'}"
    assert links.verify_unsubscribe(tampered) is None
    assert links.verify_unsubscribe(f"1.RESERVATIONS.{party_id}.{signature}") is None
    assert links.verify_unsubscribe("garbage") is None
    with pytest.raises(ValueError):
        links.sign_unsubscribe(party_id, EmailCategory.ALL)

    monkeypatch.setattr(settings, "email_link_signing_secret", None)
    assert links.verify_unsubscribe(token) is None


def test_renderNotification_escapesMessage_fallsBackToStart_andCarriesFooter(
    email_settings: None,
) -> None:
    rendered = render(
        EmailTemplate.NOTIFICATION,
        {
            "kind": "SWAP_PROPOSED",
            "message": "Bartek <script>alert(1)</script> proponuje wymianę",
            "link_path": None,
            "unsubscribe_token": "1.RESERVATIONS.abc.sig",
            "display_name": "Ania Kowalska",
        },
    )

    assert rendered.subject == "Ktoś chce wymienić się z Tobą"
    assert "<script>" not in rendered.html
    assert "&lt;script&gt;" in rendered.html
    assert f'href="{_BASE}/"' in rendered.html
    assert "Zobacz propozycję" in rendered.html
    assert "max-width:600px" in rendered.html
    assert f'src="{_BASE}/assets/logo-gooo-email.png"' in rendered.html
    assert "Dostajesz ten mail, bo masz włączone powiadomienia „Rezerwacje i wymiany”." in (
        rendered.html
    )
    assert f"{_BASE}/unsubscribe?token=1.RESERVATIONS.abc.sig" in rendered.html
    assert "Wypisz się z tej kategorii" in rendered.html
    assert f"{_BASE}/settings" in rendered.html
    assert rendered.html.index("<h2") < rendered.html.index("proponuje wymianę")
    assert rendered.html.index("Zobacz propozycję") < rendered.html.index("Dostajesz ten mail")
    assert "<script>alert(1)</script>" in rendered.text
    assert f"{_BASE}/" in rendered.text
    assert "Ustawienia powiadomień" in rendered.text


def test_renderVerifyEmail_matchesMockupCopy_andStrictUndefinedRaises(
    email_settings: None,
) -> None:
    rendered = render(
        EmailTemplate.VERIFY_EMAIL, {"token": "tok-123", "display_name": "Ania Kowalska"}
    )

    assert rendered.subject == "Potwierdź swój adres e-mail"
    for part in (
        "Cześć Ania! Kliknij przycisk, żeby potwierdzić adres. Link jest ważny 48 godzin.",
        "Potwierdź adres",
        f"{_BASE}/verify-email?token=tok-123",
        "Jeśli to nie Ty, zignoruj tę wiadomość.",
        "Wiadomość o Twoim koncie w Gooo, wysyłana niezależnie od ustawień powiadomień.",
    ):
        assert part in rendered.html
        assert part in rendered.text
    assert "unsubscribe" not in rendered.html
    assert "Wypisz" not in rendered.text

    with pytest.raises(jinja2.UndefinedError):
        render(EmailTemplate.VERIFY_EMAIL, {"display_name": "Ania"})


def test_renderPasswordMails_polishCopyAndWarsawDate(email_settings: None) -> None:
    changed = render(
        EmailTemplate.PASSWORD_CHANGED,
        {"changed_at": "2026-07-01T10:05:00", "display_name": "Żaneta"},
    )
    assert changed.subject == "Hasło zostało zmienione"
    # 10:05 UTC is 12:05 in Warsaw summer time; 2026-07-01 is a Wednesday.
    assert "Hasło do Twojego konta zostało zmienione śr 01.07 o 12:05." in changed.text
    assert "Hasło do Twojego konta zostało zmienione śr 01.07 o 12:05." in changed.html
    assert "Jeśli to nie Ty, ustaw nowe hasło:" in changed.html
    assert f"{_BASE}/reset-password" in changed.text

    reset = render(
        EmailTemplate.PASSWORD_RESET,
        {"token": "r-1", "google_only": True, "display_name": None},
    )
    assert reset.subject == "Ustaw nowe hasło"
    assert "Logujesz się przez Google. Możesz też ustawić hasło i logować się nim." in reset.html
    assert f"{_BASE}/reset-password?token=r-1" in reset.html
    assert "Jeśli to nie Ty, zignoruj tę wiadomość — hasło się nie zmieni." in reset.text
    assert (
        "Logujesz się przez Google"
        not in render(EmailTemplate.PASSWORD_RESET, {"token": "r-1", "google_only": False}).text
    )
