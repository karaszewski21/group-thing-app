"""End-to-end email flows across the module seams: an account or domain write
queues the row, `run_send_batch` renders it through `fake_email_sender`, and
the link or header in the sent mail drives the next API call."""

from __future__ import annotations

import re
import uuid
from typing import Any, cast
from urllib.parse import unquote

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import AccountToken, AccountTokenPurpose
from app.config import settings
from app.email import sending
from app.email.models import (
    EmailCategory,
    EmailMessage,
    EmailPreference,
    EmailSkipReason,
    EmailStatus,
    EmailStream,
    EmailTemplate,
)
from app.email.sending import run_send_batch
from app.groups import service as groups_service
from app.inventory.models import ReservationType
from app.notifications import service as notifications_service
from app.notifications.models import NotificationKind
from app.users import service as users_service
from tests.conftest import FakeEmailSender
from tests.test_email_webhook import _TEST_KEY, _payload
from tests.test_term_item_listings import (
    _create_circle_and_term,
    _principal,
    _register_personal_item,
    _rsvp,
    _take_in_term,
)
from tests.test_term_item_listings import _register as _register_role

_BASE = "https://gooo.test"
PASSWORD = "Haslo-123"


@pytest.fixture(autouse=True)
def _email_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "app_public_base_url", _BASE)
    monkeypatch.setattr(settings, "email_link_signing_secret", "test-link-secret-" + "x" * 20)
    monkeypatch.setattr(settings, "email_webhook_signing_key", _TEST_KEY)
    monkeypatch.setattr(settings, "email_daily_cap", 100)


def _email() -> str:
    return f"flows.{uuid.uuid4().hex[:10]}@example.com"


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _quiet(monkeypatch: pytest.MonkeyPatch, quiet: bool) -> None:
    monkeypatch.setattr(sending, "is_quiet", lambda _local_now: quiet)


def _sent_to(sender: FakeEmailSender, address: str) -> list[Any]:
    return [mail for mail in sender.sent if mail.to == address]


def _link_token(body: str, path: str) -> str:
    match = re.search(rf"{re.escape(_BASE + path)}\?token=([^\s\"'<&]+)", body)
    assert match is not None, f"no {path} link in the mail"
    return unquote(match.group(1))


async def _rows(db: AsyncSession, party_id: uuid.UUID, template: EmailTemplate) -> list[Any]:
    result = await db.execute(
        select(EmailMessage)
        .where(EmailMessage.party_id == party_id, EmailMessage.template == template)
        .order_by(EmailMessage.created_at)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


async def _token_expiry(db: AsyncSession, email: str, purpose: AccountTokenPurpose) -> Any:
    return (
        await db.execute(
            select(AccountToken.expires_at)
            .where(AccountToken.email == email, AccountToken.purpose == purpose)
            .order_by(AccountToken.created_at.desc())
            .limit(1)
        )
    ).scalar_one()


async def test_register_verifyMailSentInQuietHours_linkConfirmsAndMeIsVerified(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "email_enabled", True)
    _quiet(monkeypatch, True)
    email = _email()
    registered = await client.post(
        "/api/auth/register", json={"role": "GUEST", "email": email, "password": PASSWORD}
    )
    assert registered.status_code == 201, registered.text
    token, party_id = registered.json()["token"], uuid.UUID(registered.json()["party_id"])
    (row,) = await _rows(db_session, party_id, EmailTemplate.VERIFY_EMAIL)
    assert row.expires_at == await _token_expiry(
        db_session, email, AccountTokenPurpose.VERIFY_EMAIL
    )

    await run_send_batch(db_session)

    (mail,) = _sent_to(fake_email_sender, email)
    assert "List-Unsubscribe" not in mail.headers
    raw = _link_token(mail.text, "/verify-email")
    assert raw == _link_token(mail.html, "/verify-email")
    (row,) = await _rows(db_session, party_id, EmailTemplate.VERIFY_EMAIL)
    assert row.status == EmailStatus.SENT
    assert row.provider_message_id is not None
    assert "token" not in row.payload
    before = await client.get("/api/people/me", headers=_auth(token))
    assert before.json()["email_verified"] is False

    confirmed = await client.post("/api/auth/email-verification/confirm", json={"token": raw})

    assert confirmed.status_code == 204, confirmed.text
    after = await client.get("/api/people/me", headers=_auth(token))
    assert after.json()["email_verified"] is True


async def test_passwordReset_googleOnlyMailThroughTheJob_linkSetsPasswordThenChangedMail(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "email_enabled", True)
    _quiet(monkeypatch, False)
    email = _email()
    _, party = await users_service.bootstrap_person_account(db_session, email=email, password=None)
    await db_session.commit()
    party_id = cast(uuid.UUID, party.id)

    assert (await client.post("/api/auth/password-reset", json={"email": email})).status_code == 202
    (row,) = await _rows(db_session, party_id, EmailTemplate.PASSWORD_RESET)
    assert row.stream == EmailStream.TRANSACTIONAL
    assert row.expires_at == await _token_expiry(
        db_session, email, AccountTokenPurpose.PASSWORD_RESET
    )
    await run_send_batch(db_session)

    (mail,) = _sent_to(fake_email_sender, email)
    assert "Logujesz się przez Google" in mail.text
    raw = _link_token(mail.text, "/reset-password")
    lookup = await client.post(
        "/api/auth/account-tokens/lookup", json={"token": raw, "purpose": "PASSWORD_RESET"}
    )
    assert (lookup.status_code, lookup.json()) == (200, {"email": email})
    confirmed = await client.post(
        "/api/auth/password-reset/confirm", json={"token": raw, "password": "Nowe-haslo-1"}
    )
    assert confirmed.status_code == 204, confirmed.text
    login = await client.post("/api/auth/login", json={"email": email, "password": "Nowe-haslo-1"})
    assert login.status_code == 200, login.text

    await run_send_batch(db_session)

    changed = _sent_to(fake_email_sender, email)[1:]
    assert [m.tag for m in changed] == [EmailTemplate.PASSWORD_CHANGED.value]
    assert raw not in changed[0].text


async def test_bellFromAGiftTake_sentWithOneClickHeader_deliveredThenUnsubscribeStopsTheNext(
    client: AsyncClient,
    db_session: AsyncSession,
    fake_email_sender: FakeEmailSender,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    org_token, _ = await _register_role(client, "ORGANIZER", _email())
    group_id, term_id = await _create_circle_and_term(client, org_token, "flows")
    lister_email = _email()
    lister_token, lister_id = await _register_role(client, "GUEST", lister_email)
    await _rsvp(client, lister_token, group_id, term_id)
    item_id = await _register_personal_item(client, lister_token, "Wozek")
    await groups_service.set_item_listing_preference(
        db_session, _principal(lister_token), item_id, ReservationType.GIFT
    )
    taker_token, _ = await _register_role(client, "GUEST", _email())
    await _rsvp(client, taker_token, group_id, term_id)
    await db_session.execute(
        text("UPDATE user_profiles SET email_verified_at = now() WHERE party_id = :id"),
        {"id": lister_id},
    )
    await db_session.commit()
    monkeypatch.setattr(settings, "email_enabled", True)
    monkeypatch.setattr(settings, "email_notifications_enabled", True)
    _quiet(monkeypatch, False)

    await _take_in_term(db_session, _principal(taker_token), item_id, term_id)
    await db_session.commit()
    await run_send_batch(db_session)

    (mail,) = _sent_to(fake_email_sender, lister_email)
    assert mail.tag == EmailTemplate.NOTIFICATION.value
    assert mail.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    header = mail.headers["List-Unsubscribe"]
    assert header.startswith(f"<{_BASE}/api/email/unsubscribe/") and header.endswith(">")
    (row,) = await _rows(db_session, lister_id, EmailTemplate.NOTIFICATION)
    assert (row.notification_kind, row.status) == ("TERM_ITEM_LISTING_TAKEN", EmailStatus.SENT)

    delivered = await client.post(
        "/api/email/webhooks/mailgun",
        json=_payload("delivered", email_message_id=str(row.id), recipient=lister_email),
    )
    assert delivered.status_code == 200, delivered.text
    (row,) = await _rows(db_session, lister_id, EmailTemplate.NOTIFICATION)
    assert row.status == EmailStatus.DELIVERED

    unsubscribed = await client.post(
        header[1:-1].removeprefix(_BASE), data={"List-Unsubscribe": "One-Click"}
    )
    assert unsubscribed.status_code == 200, unsubscribed.text
    stored = await db_session.scalar(
        select(EmailPreference.enabled).where(
            EmailPreference.party_id == lister_id,
            EmailPreference.category == EmailCategory.RESERVATIONS,
        )
    )
    assert stored is False
    await notifications_service.create_notification(
        db_session,
        party_id=lister_id,
        kind=NotificationKind.SWAP_PROPOSED,
        message="Ktoś proponuje wymianę",
        link_path="/swaps/1",
    )
    await db_session.commit()

    await run_send_batch(db_session)

    assert len(_sent_to(fake_email_sender, lister_email)) == 1
    later = (await _rows(db_session, lister_id, EmailTemplate.NOTIFICATION))[-1]
    assert (later.status, later.skip_reason) == (
        EmailStatus.SKIPPED,
        EmailSkipReason.CATEGORY_DISABLED,
    )
