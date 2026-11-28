"""One-time account tokens behind `/api/auth/password-reset*`,
`/api/auth/email-verification*` and `/api/auth/account-tokens/lookup`.

Raw tokens are read back only from the queued mail's payload, the one place
they exist besides the link. Email is switched on per test."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta
from typing import Any, cast

import pytest
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.auth.models import AccountToken, AccountTokenPurpose, User
from app.config import settings
from app.core import security
from app.email.models import EmailMessage, EmailSuppression, EmailTemplate, SuppressionReason
from app.users import service as users_service
from app.users.models import UserProfile

PASSWORD = "Haslo-123"
RESET = "/api/auth/password-reset"
RESET_CONFIRM = "/api/auth/password-reset/confirm"
VERIFY = "/api/auth/email-verification"
VERIFY_CONFIRM = "/api/auth/email-verification/confirm"
LOOKUP = "/api/auth/account-tokens/lookup"

COPY_INVALID = "Ten link jest nieprawidłowy."
COPY_RESET_GONE = "Ten link do zmiany hasła jest już nieważny."
COPY_VERIFY_GONE = "Ten link wygasł albo został już użyty."
COPY_UNAVAILABLE = "Wysyłka maili jest chwilowo niedostępna. Spróbuj później."


@pytest.fixture
def email_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "email_enabled", True)


def _email() -> str:
    return f"tokens.{uuid.uuid4().hex[:10]}@example.com"


def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _no_store(response: Response) -> None:
    assert response.headers.get("cache-control") == "no-store", response.headers


async def _register(client: AsyncClient, email: str) -> tuple[str, uuid.UUID]:
    response = await client.post(
        "/api/auth/register", json={"role": "GUEST", "email": email, "password": PASSWORD}
    )
    assert response.status_code == 201, response.text
    body = response.json()
    return body["token"], uuid.UUID(body["party_id"])


async def _user_id(db: AsyncSession, party_id: uuid.UUID) -> uuid.UUID:
    user_id = (
        await db.execute(
            select(UserProfile.account_user_id).where(UserProfile.party_id == party_id)
        )
    ).scalar_one()
    return cast(uuid.UUID, user_id)


async def _messages(db: AsyncSession, party_id: uuid.UUID) -> list[Any]:
    return list(
        (
            await db.execute(
                select(EmailMessage.template, EmailMessage.idempotency_key, EmailMessage.payload)
                .where(EmailMessage.party_id == party_id)
                .order_by(EmailMessage.created_at)
            )
        ).all()
    )


async def _latest_token(db: AsyncSession, party_id: uuid.UUID, template: EmailTemplate) -> str:
    rows = [row for row in await _messages(db, party_id) if row.template == template]
    return cast(str, rows[-1].payload["token"])


async def _reset_count(db: AsyncSession) -> int:
    rows = await db.execute(
        select(EmailMessage.id).where(EmailMessage.template == EmailTemplate.PASSWORD_RESET)
    )
    return len(rows.all())


async def _verified_at(db: AsyncSession, party_id: uuid.UUID) -> datetime | None:
    return (
        await db.execute(
            select(UserProfile.email_verified_at).where(UserProfile.party_id == party_id)
        )
    ).scalar_one()


async def _seed_token(
    db: AsyncSession,
    user_id: uuid.UUID,
    purpose: AccountTokenPurpose,
    email: str,
    *,
    expires_in: timedelta = timedelta(hours=1),
    used: bool = False,
) -> str:
    raw = secrets.token_urlsafe(32)
    now = datetime.utcnow()
    db.add(
        AccountToken(
            user_id=user_id,
            purpose=purpose,
            token_hash=_sha256(raw),
            email=email,
            expires_at=now + expires_in,
            used_at=now if used else None,
        )
    )
    await db.commit()
    return raw


async def test_register_emailEnabled_enqueuesVerifyEmailWithTheToken(
    client: AsyncClient, db_session: AsyncSession, email_on: None
) -> None:
    email = _email()
    _, party_id = await _register(client, email)

    tokens = (
        (
            await db_session.execute(
                select(AccountToken).where(
                    AccountToken.user_id == await _user_id(db_session, party_id)
                )
            )
        )
        .scalars()
        .all()
    )
    assert [(t.purpose, t.email, t.used_at) for t in tokens] == [
        (AccountTokenPurpose.VERIFY_EMAIL, email, None)
    ]
    (token,) = tokens
    assert timedelta(hours=47) < token.expires_at - datetime.utcnow() <= timedelta(hours=48)
    ((template, key, payload),) = await _messages(db_session, party_id)
    assert (template, key) == (EmailTemplate.VERIFY_EMAIL, f"auth:{token.id}")
    assert len(payload["token"]) >= 43
    assert _sha256(payload["token"]) == token.token_hash


async def test_register_emailDisabled_issuesNoToken(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    _, party_id = await _register(client, _email())

    user_id = await _user_id(db_session, party_id)
    assert (
        await db_session.execute(select(AccountToken.id).where(AccountToken.user_id == user_id))
    ).all() == []
    assert await _messages(db_session, party_id) == []


@pytest.mark.parametrize("case", ["existing", "missing", "google_only", "rate_limited"])
async def test_requestPasswordReset_anyAddress_returns202Neutrally(
    client: AsyncClient, db_session: AsyncSession, email_on: None, case: str
) -> None:
    email = _email()
    party_id: uuid.UUID | None = None
    if case in ("existing", "rate_limited"):
        _, party_id = await _register(client, email)
    elif case == "google_only":
        _, party = await users_service.bootstrap_person_account(
            db_session, email=email, password=None
        )
        await db_session.commit()
        party_id = cast(uuid.UUID, party.id)
    if case == "rate_limited":
        assert (await client.post(RESET, json={"email": email})).status_code == 202
    resets_before = await _reset_count(db_session)

    response = await client.post(RESET, json={"email": f"  {email.upper()} "})

    assert response.status_code == 202, response.text
    assert response.content == b""
    _no_store(response)
    if party_id is None:
        assert await _reset_count(db_session) == resets_before
        return
    resets = [
        row
        for row in await _messages(db_session, party_id)
        if row.template == EmailTemplate.PASSWORD_RESET
    ]
    assert len(resets) == 1
    assert resets[0].payload["google_only"] is (case == "google_only")


async def test_requestPasswordReset_emailDisabled_returns503(client: AsyncClient) -> None:
    response = await client.post(RESET, json={"email": _email()})

    assert response.status_code == 503
    assert response.json()["message"] == COPY_UNAVAILABLE
    _no_store(response)


@pytest.mark.parametrize("state", ["unknown", "expired", "used"])
@pytest.mark.parametrize(
    ("url", "purpose", "gone_copy"),
    [
        (RESET_CONFIRM, AccountTokenPurpose.PASSWORD_RESET, COPY_RESET_GONE),
        (VERIFY_CONFIRM, AccountTokenPurpose.VERIFY_EMAIL, COPY_VERIFY_GONE),
        (LOOKUP, AccountTokenPurpose.PASSWORD_RESET, COPY_RESET_GONE),
        (LOOKUP, AccountTokenPurpose.VERIFY_EMAIL, COPY_VERIFY_GONE),
    ],
)
async def test_tokenRoutes_badToken_return404Or410NeverUnauthorized(
    client: AsyncClient,
    db_session: AsyncSession,
    email_on: None,
    caplog: pytest.LogCaptureFixture,
    url: str,
    purpose: AccountTokenPurpose,
    gone_copy: str,
    state: str,
) -> None:
    caplog.set_level(logging.DEBUG)
    email = _email()
    _, party_id = await _register(client, email)
    raw = secrets.token_urlsafe(32)
    if state != "unknown":
        raw = await _seed_token(
            db_session,
            await _user_id(db_session, party_id),
            purpose,
            email,
            expires_in=timedelta(minutes=-1) if state == "expired" else timedelta(hours=1),
            used=state == "used",
        )
    body: dict[str, str] = {"token": raw}
    if url == LOOKUP:
        body["purpose"] = purpose.value
    elif url == RESET_CONFIRM:
        body["password"] = "Nowe-haslo-1"

    response = await client.post(url, json=body)

    expected = (404, COPY_INVALID) if state == "unknown" else (410, gone_copy)
    assert (response.status_code, response.json()["message"]) == expected
    _no_store(response)
    for secret in (raw, email, "Nowe-haslo-1", PASSWORD):
        assert secret not in caplog.text


async def test_confirmPasswordReset_googleOnlyAccount_setsPasswordVerifiesAndNotifies(
    client: AsyncClient, db_session: AsyncSession, email_on: None, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    email = _email()
    _, party = await users_service.bootstrap_person_account(db_session, email=email, password=None)
    await db_session.commit()
    party_id = cast(uuid.UUID, party.id)
    assert (await client.post(RESET, json={"email": email})).status_code == 202
    first = await _latest_token(db_session, party_id, EmailTemplate.PASSWORD_RESET)
    await db_session.execute(
        text("UPDATE account_tokens SET created_at = created_at - interval '2 minutes'")
    )
    assert (await client.post(RESET, json={"email": email})).status_code == 202
    raw = await _latest_token(db_session, party_id, EmailTemplate.PASSWORD_RESET)

    response = await client.post(RESET_CONFIRM, json={"token": raw, "password": "Nowe-haslo-1"})

    assert response.status_code == 204, response.text
    _no_store(response)
    login = await client.post("/api/auth/login", json={"email": email, "password": "Nowe-haslo-1"})
    assert login.status_code == 200, login.text
    assert await _verified_at(db_session, party_id) is not None
    (token_id,) = (
        await db_session.execute(
            select(AccountToken.id).where(AccountToken.token_hash == _sha256(raw))
        )
    ).one()
    changed = [
        row
        for row in await _messages(db_session, party_id)
        if row.template == EmailTemplate.PASSWORD_CHANGED
    ]
    assert [row.idempotency_key for row in changed] == [f"auth:{token_id}:changed"]
    assert "changed_at" in changed[0].payload
    again = await client.post(RESET_CONFIRM, json={"token": first, "password": "Inne-haslo-2"})
    assert again.status_code == 410
    for secret in (raw, first, email, "Nowe-haslo-1"):
        assert secret not in caplog.text


async def test_confirmVerification_clearsBounceKeepsComplaintRejectsMismatch(
    client: AsyncClient, db_session: AsyncSession, email_on: None
) -> None:
    bounced, complained, changed = _email(), _email(), _email()
    parties = {
        email: (await _register(client, email))[1] for email in (bounced, complained, changed)
    }
    db_session.add_all(
        [
            EmailSuppression(address_normalized=bounced, reason=SuppressionReason.BOUNCE),
            EmailSuppression(address_normalized=complained, reason=SuppressionReason.COMPLAINT),
        ]
    )
    await db_session.commit()
    tokens = {
        email: await _latest_token(db_session, party, EmailTemplate.VERIFY_EMAIL)
        for email, party in parties.items()
    }
    await db_session.execute(
        update(UserProfile)
        .where(UserProfile.party_id == parties[changed])
        .values(email=f"other.{changed}")
        .execution_options(synchronize_session=False)
    )
    await db_session.commit()

    responses = {
        email: await client.post(VERIFY_CONFIRM, json={"token": token})
        for email, token in tokens.items()
    }

    assert {email: r.status_code for email, r in responses.items()} == {
        bounced: 204,
        complained: 204,
        changed: 410,
    }
    assert responses[changed].json()["message"] == COPY_VERIFY_GONE
    assert await _verified_at(db_session, parties[bounced]) is not None
    assert await _verified_at(db_session, parties[changed]) is None
    remaining = (
        await db_session.execute(
            select(EmailSuppression.address_normalized, EmailSuppression.reason).where(
                EmailSuppression.address_normalized.in_([bounced, complained])
            )
        )
    ).all()
    assert remaining == [(complained, SuppressionReason.COMPLAINT)]


async def test_confirmPasswordReset_passwordOver72Bytes_returnsPolish400AndKeepsToken(
    client: AsyncClient, db_session: AsyncSession, email_on: None
) -> None:
    email = _email()
    _, party_id = await _register(client, email)
    raw = await _seed_token(
        db_session, await _user_id(db_session, party_id), AccountTokenPurpose.PASSWORD_RESET, email
    )

    too_long = await client.post(RESET_CONFIRM, json={"token": raw, "password": "a" * 73})
    fits = await client.post(RESET_CONFIRM, json={"token": raw, "password": "a" * 72})

    assert too_long.status_code == 400, too_long.text
    assert too_long.json()["fieldErrors"] == {"password": "Hasło może mieć najwyżej 72 bajty."}
    assert fits.status_code == 204, fits.text


async def test_confirmPasswordReset_unknownTokenNeverHashes_matchingResetLiftsBounce(
    client: AsyncClient,
    db_session: AsyncSession,
    email_on: None,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hashed: list[str] = []

    def counting_hash(password: str) -> str:
        hashed.append(password)
        return security.hash_password(password)

    monkeypatch.setattr("app.auth.account_tokens.hash_password", counting_hash)
    email = _email()
    _, party_id = await _register(client, email)
    await db_session.execute(
        update(UserProfile)
        .where(UserProfile.party_id == party_id)
        .values(email_verified_at=datetime.utcnow())
        .execution_options(synchronize_session=False)
    )
    db_session.add(EmailSuppression(address_normalized=email, reason=SuppressionReason.BOUNCE))
    await db_session.commit()
    raw = await _seed_token(
        db_session, await _user_id(db_session, party_id), AccountTokenPurpose.PASSWORD_RESET, email
    )

    unknown = await client.post(
        RESET_CONFIRM, json={"token": secrets.token_urlsafe(32), "password": "Nowe-haslo-1"}
    )
    assert (unknown.status_code, hashed) == (404, [])

    confirmed = await client.post(RESET_CONFIRM, json={"token": raw, "password": "Nowe-haslo-1"})

    assert confirmed.status_code == 204, confirmed.text
    assert hashed == ["Nowe-haslo-1"]
    suppression = await db_session.scalar(
        select(EmailSuppression.id).where(EmailSuppression.address_normalized == email)
    )
    assert suppression is None


async def test_requestEmailVerification_resendReplacesTokenAndIsRateLimited(
    client: AsyncClient, db_session: AsyncSession, email_on: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    login, party_id = await _register(client, _email())
    headers = {"Authorization": f"Bearer {login}"}
    first = await _latest_token(db_session, party_id, EmailTemplate.VERIFY_EMAIL)

    silenced = await client.post(VERIFY, json={}, headers=headers)
    await db_session.execute(
        text("UPDATE account_tokens SET created_at = created_at - interval '2 minutes'")
    )
    resent = await client.post(VERIFY, json={}, headers=headers)

    assert (silenced.status_code, resent.status_code) == (202, 202)
    _no_store(silenced)
    verify_rows = [
        row
        for row in await _messages(db_session, party_id)
        if row.template == EmailTemplate.VERIFY_EMAIL
    ]
    assert len(verify_rows) == 2
    old = await client.post(VERIFY_CONFIRM, json={"token": first})
    assert old.status_code == 410
    new = await client.post(VERIFY_CONFIRM, json={"token": verify_rows[-1].payload["token"]})
    assert new.status_code == 204
    after_verified = await client.post(VERIFY, json={}, headers=headers)
    assert after_verified.status_code == 202
    monkeypatch.setattr(settings, "email_enabled", False)
    disabled = await client.post(VERIFY, json={}, headers=headers)
    assert (disabled.status_code, disabled.json()["message"]) == (503, COPY_UNAVAILABLE)
    _no_store(disabled)


async def test_lookup_validToken_returnsEmailWithoutSideEffects(
    client: AsyncClient, db_session: AsyncSession, email_on: None
) -> None:
    email = _email()
    _, party_id = await _register(client, email)
    raw = await _latest_token(db_session, party_id, EmailTemplate.VERIFY_EMAIL)

    for _ in range(2):
        response = await client.post(LOOKUP, json={"token": raw, "purpose": "VERIFY_EMAIL"})
        assert (response.status_code, response.json()) == (200, {"email": email})
        _no_store(response)
    wrong_purpose = await client.post(LOOKUP, json={"token": raw, "purpose": "PASSWORD_RESET"})

    assert wrong_purpose.status_code == 404
    assert (await client.post(VERIFY_CONFIRM, json={"token": raw})).status_code == 204
    assert await _verified_at(db_session, party_id) is not None


@pytest.fixture
async def committed_client(engine: AsyncEngine) -> AsyncGenerator[AsyncClient, None]:
    """Every request on its own committing session, so two confirms race on
    separate connections."""
    from app.db import get_db
    from app.main import app

    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def _committing_get_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = _committing_get_db
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as async_client:
            yield async_client
    finally:
        app.dependency_overrides.pop(get_db, None)


_PURGE = (
    "DELETE FROM email_messages WHERE party_id = :party",
    "DELETE FROM account_tokens WHERE user_id = :user",
    "DELETE FROM user_roles WHERE party_id = :party",
    "DELETE FROM user_profiles WHERE party_id = :party",
    "DELETE FROM user_permissions WHERE user_id = :user",
    "DELETE FROM users WHERE id = :user",
    "DELETE FROM parties WHERE id = :party",
)


@pytest.mark.parametrize("purpose", list(AccountTokenPurpose))
async def test_confirm_twoConcurrentConfirms_exactlyOneSucceeds(
    committed_client: AsyncClient, engine: AsyncEngine, email_on: None, purpose: AccountTokenPurpose
) -> None:
    email = _email()
    async with AsyncSession(engine, expire_on_commit=False) as db:
        party, _profile = await users_service.create_account_and_profile(
            db, f"tok{uuid.uuid4().hex[:12]}", PASSWORD, "Tokeny", email
        )
        params = {"party": party.id, "user": _profile.account_user_id}
        await db.commit()
    try:
        async with AsyncSession(engine) as db:
            raw = await _seed_token(db, cast(uuid.UUID, params["user"]), purpose, email)
        url = VERIFY_CONFIRM if purpose == AccountTokenPurpose.VERIFY_EMAIL else RESET_CONFIRM
        body: dict[str, str] = {"token": raw}
        if purpose == AccountTokenPurpose.PASSWORD_RESET:
            body["password"] = "Nowe-haslo-1"

        responses = await asyncio.gather(
            committed_client.post(url, json=body), committed_client.post(url, json=body)
        )

        assert sorted(r.status_code for r in responses) == [204, 410], [
            r.status_code for r in responses
        ]
        async with AsyncSession(engine) as db:
            changed = (
                await db.execute(
                    select(EmailMessage.id).where(
                        EmailMessage.party_id == params["party"],
                        EmailMessage.template == EmailTemplate.PASSWORD_CHANGED,
                    )
                )
            ).all()
            assert len(changed) == (1 if purpose == AccountTokenPurpose.PASSWORD_RESET else 0)
            user = await db.get(User, params["user"])
            assert user is not None
    finally:
        async with engine.begin() as conn:
            for statement in _PURGE:
                await conn.execute(text(statement), params)
