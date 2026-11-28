"""`POST /api/auth/google/nonce` and `POST /api/auth/google`: ID tokens are
signed locally with an RSA key generated once per module and served by a fake
JWKS fetcher on a fresh verifier, so no test touches the network. httpx does
not send `Secure` cookies to `http://test`, so the flows turn
`auth_cookie_secure` off."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient, Response
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.exc import StaleDataError

from app.auth import router as auth_router
from app.auth import service as auth_service
from app.auth.google import (
    NONCE_COOKIE_NAME,
    GoogleTokenVerifier,
    encode_nonce_cookie,
    get_google_verifier,
)
from app.auth.models import Permission, User, UserIdentity, user_permissions
from app.config import settings
from app.core.errors import ModerationUnavailable, TextModerationRejected
from app.core.security import decode_token
from app.families.repository import list_families_for_guardian_party
from app.main import app
from app.oauth2.stores import authorization_code_store
from app.users import service as users_service
from app.users.models import UserProfile, UserRole, UserRoleType

CLIENT_ID = "test-client.apps.googleusercontent.com"
KID = "google-login-key"
NONCE_URL = "/api/auth/google/nonce"
SIGN_IN_URL = "/api/auth/google"

COPY_401 = "Nie udało się zalogować przez Google. Spróbuj ponownie."
COPY_403 = (
    "Ten adres w Google nie jest potwierdzony. Potwierdź go w Google albo załóż konto emailem."
)
COPY_409 = "Konto z tym adresem już istnieje — zaloguj się hasłem."
COPY_503 = (
    "Logowanie przez Google jest chwilowo niedostępne. Zaloguj się emailem albo spróbuj później."
)

_SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


async def _fake_jwks() -> Any:
    jwk = RSAAlgorithm.to_jwk(_SIGNING_KEY.public_key(), as_dict=True)
    return {"keys": [{**jwk, "kid": KID, "alg": "RS256", "use": "sig"}]}


async def _jwks_outage() -> Any:
    raise TimeoutError("jwks timeout")


def _use_verifier(fetch_jwks: Callable[[], Any]) -> None:
    app.dependency_overrides[get_google_verifier] = lambda: GoogleTokenVerifier(
        CLIENT_ID, fetch_jwks
    )


@pytest.fixture
async def google(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[None]:
    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    monkeypatch.setattr(settings, "auth_cookie_secure", False)
    _use_verifier(_fake_jwks)
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_google_verifier, None)


def _credential(nonce: str, **overrides: Any) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "azp": CLIENT_ID,
        "sub": "google-sub-1",
        "email": "jan.google@example.com",
        "email_verified": True,
        "name": "Jan   Google",
        "nonce": nonce,
        "iat": now,
        "exp": now + 3600,
        **overrides,
    }
    return jwt.encode(claims, _SIGNING_KEY, algorithm="RS256", headers={"kid": KID})


async def _nonce(client: AsyncClient) -> str:
    response = await client.post(NONCE_URL, json={})
    assert response.status_code == 200, response.text
    return str(response.json()["nonce"])


async def _sign_in(client: AsyncClient, **claims: Any) -> Response:
    """Nonce POST then sign-in, the cookie travelling in the client's jar."""
    nonce = await _nonce(client)
    return await client.post(SIGN_IN_URL, json={"credential": _credential(nonce, **claims)})


async def _sign_in_with_cookie(client: AsyncClient, **claims: Any) -> Response:
    """Sign-in with a freshly signed cookie sent explicitly (no nonce POST)."""
    nonce = "explicit-nonce"
    return await client.post(
        SIGN_IN_URL,
        json={"credential": _credential(nonce, **claims)},
        headers={"Cookie": f"{NONCE_COOKIE_NAME}={encode_nonce_cookie(nonce)}"},
    )


def _assert_cookie_cleared(response: Response, *, secure: bool) -> None:
    header = response.headers.get("set-cookie", "")
    lowered = header.lower()
    assert header.startswith(f'{NONCE_COOKIE_NAME}=""'), header
    assert "max-age=0" in lowered
    assert "path=/api/auth/google" in lowered
    assert "httponly" in lowered
    assert "samesite=lax" in lowered
    assert ("; secure" in lowered) is secure


def _assert_error(response: Response, status: int, message: str) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert body["status"] == status
    assert body["message"] == message


async def _profile(db_session: AsyncSession, party_id: str) -> UserProfile:
    return (
        await db_session.execute(select(UserProfile).where(UserProfile.party_id == party_id))
    ).scalar_one()


async def _identity_count(db_session: AsyncSession, subject: str) -> int:
    return int(
        (
            await db_session.execute(
                select(func.count())
                .select_from(UserIdentity)
                .where(UserIdentity.subject == subject)
            )
        ).scalar_one()
    )


@pytest.mark.parametrize("secure", [True, False])
async def test_googleNonce_emptyJsonBody_returnsNonceAndSetsSignedCookie(
    client: AsyncClient, google: None, monkeypatch: pytest.MonkeyPatch, secure: bool
) -> None:
    monkeypatch.setattr(settings, "auth_cookie_secure", secure)

    response = await client.post(NONCE_URL, json={})

    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"nonce"} and len(body["nonce"]) >= 32
    assert response.headers["cache-control"] == "no-store"
    cookie = response.headers["set-cookie"]
    lowered = cookie.lower()
    assert cookie.startswith(f"{NONCE_COOKIE_NAME}=")
    assert "httponly" in lowered
    assert "samesite=lax" in lowered
    assert "path=/api/auth/google" in lowered
    assert "max-age=600" in lowered
    assert ("; secure" in lowered) is secure


@pytest.mark.parametrize(
    "request_kwargs",
    [
        pytest.param({}, id="no-body"),
        pytest.param({"data": {"a": "b"}}, id="form-body"),
        pytest.param({"json": {"extra": 1}}, id="extra-field"),
    ],
)
async def test_googleNonce_missingOrNonJsonBody_returns400WithoutCookie(
    client: AsyncClient, google: None, request_kwargs: dict[str, Any]
) -> None:
    response = await client.post(NONCE_URL, **request_kwargs)

    assert response.status_code == 400, response.text
    assert "set-cookie" not in response.headers


async def test_googleSignIn_firstThenSecond_creates201ThenLogsIn200(
    client: AsyncClient, google: None, db_session: AsyncSession
) -> None:
    first = await _sign_in(client)

    assert first.status_code == 201, first.text
    body = first.json()
    assert set(body) == {"token", "created", "party_id"}
    assert body["created"] is True
    _assert_cookie_cleared(first, secure=False)
    profile = await _profile(db_session, body["party_id"])
    assert profile.display_name == "Jan Google"
    assert profile.email == "jan.google@example.com"
    user = await db_session.get(User, profile.account_user_id)
    assert user is not None and user.password_hash is None
    assert decode_token(body["token"], settings.jwt_secret)["sub"] == user.username
    assert await _identity_count(db_session, "google-sub-1") == 1
    roles = (
        await db_session.execute(
            select(UserRole.role_type).where(UserRole.party_id == profile.party_id)
        )
    ).scalars()
    assert set(roles) == {UserRoleType.USER}
    assert len(await list_families_for_guardian_party(db_session, profile.party_id)) == 1

    second = await _sign_in(client, email="Jan.Renamed@Example.com", email_verified=False)

    assert second.status_code == 200, second.text
    assert second.json()["created"] is False
    assert second.json()["party_id"] == body["party_id"]
    assert decode_token(second.json()["token"], settings.jwt_secret)["sub"] == user.username
    _assert_cookie_cleared(second, secure=False)
    identity = (
        await db_session.execute(
            select(UserIdentity)
            .where(UserIdentity.subject == "google-sub-1")
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert (identity.email, identity.email_verified) == ("jan.renamed@example.com", False)
    assert await _identity_count(db_session, "google-sub-1") == 1


async def _verified_at(db_session: AsyncSession, party_id: str) -> object:
    return (
        await db_session.execute(
            select(UserProfile.email_verified_at)
            .where(UserProfile.party_id == party_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def test_googleSignIn_newAndLinked_setEmailVerifiedAtOnlyForVerifiedMatchingEmail(
    client: AsyncClient, google: None, db_session: AsyncSession
) -> None:
    created = await _sign_in(client, sub="google-verified")
    assert created.status_code == 201, created.text
    party_id = created.json()["party_id"]
    assert await _verified_at(db_session, party_id) is not None

    async def _cleared_then_sign_in(**claims: Any) -> object:
        await db_session.execute(
            text(
                "UPDATE user_profiles SET email_verified_at = NULL,"
                " email = 'Jan.Google@Example.com' WHERE party_id = :p"
            ),
            {"p": party_id},
        )
        await db_session.commit()
        response = await _sign_in(client, sub="google-verified", **claims)
        assert response.status_code == 200, response.text
        return await _verified_at(db_session, party_id)

    assert await _cleared_then_sign_in(email_verified=False) is None
    assert await _cleared_then_sign_in(email="other.google@example.com") is None
    assert await _cleared_then_sign_in(email="JAN.GOOGLE@example.com") is not None


async def _register(client: AsyncClient, email: str) -> str:
    response = await client.post(
        "/api/auth/register", json={"role": "GUEST", "email": email, "password": "secret123"}
    )
    assert response.status_code == 201, response.text
    return str(response.json()["party_id"])


@pytest.mark.parametrize(
    "case",
    [
        "email_taken",
        "email_taken_mixed_case",
        "unverified",
        "missing_cookie",
        "tampered_cookie",
        "nonce_mismatch",
        "bad_token",
        "jwks_outage",
    ],
)
async def test_googleSignIn_refusal_returnsPolishCopyAndClearsCookie(
    client: AsyncClient,
    google: None,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    case: str,
) -> None:
    secure = False
    if case in ("email_taken", "email_taken_mixed_case"):
        party_id = await _register(client, "jan.google@example.com")
        if case == "email_taken_mixed_case":
            await db_session.execute(
                text(
                    "UPDATE user_profiles SET email = 'Jan.Google@Example.com' WHERE party_id = :p"
                ),
                {"p": party_id},
            )
            await db_session.commit()
        response = await _sign_in_with_cookie(client)
        expected = (409, COPY_409)
    elif case == "unverified":
        response = await _sign_in_with_cookie(client, email_verified=False)
        expected = (403, COPY_403)
    elif case == "missing_cookie":
        secure = True
        monkeypatch.setattr(settings, "auth_cookie_secure", True)
        response = await client.post(
            SIGN_IN_URL, json={"credential": _credential("explicit-nonce")}
        )
        expected = (401, COPY_401)
    elif case == "tampered_cookie":
        cookie = encode_nonce_cookie("explicit-nonce")
        response = await client.post(
            SIGN_IN_URL,
            json={"credential": _credential("explicit-nonce")},
            headers={"Cookie": f"{NONCE_COOKIE_NAME}={cookie[:-2]}xx"},
        )
        expected = (401, COPY_401)
    elif case == "nonce_mismatch":
        response = await client.post(
            SIGN_IN_URL,
            json={"credential": _credential("other-nonce")},
            headers={"Cookie": f"{NONCE_COOKIE_NAME}={encode_nonce_cookie('explicit-nonce')}"},
        )
        expected = (401, COPY_401)
    elif case == "bad_token":
        response = await client.post(
            SIGN_IN_URL,
            json={"credential": "not-a-jwt"},
            headers={"Cookie": f"{NONCE_COOKIE_NAME}={encode_nonce_cookie('n')}"},
        )
        expected = (401, COPY_401)
    else:
        _use_verifier(_jwks_outage)
        response = await _sign_in_with_cookie(client)
        expected = (503, COPY_503)

    _assert_error(response, *expected)
    _assert_cookie_cleared(response, secure=secure)
    assert await _identity_count(db_session, "google-sub-1") == 0


async def test_googleRoutes_unconfigured_return503AndNonceSetsNoCookie(
    client: AsyncClient, google: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "google_client_id", "")

    nonce = await client.post(NONCE_URL, json={})
    sign_in = await _sign_in_with_cookie(client)

    _assert_error(nonce, 503, COPY_503)
    assert "set-cookie" not in nonce.headers
    _assert_error(sign_in, 503, COPY_503)
    _assert_cookie_cleared(sign_in, secure=False)


async def test_googleSignIn_adminGrantedInDb_tokenCarriesAdminAndReadsPeopleMe(
    client: AsyncClient, google: None, db_session: AsyncSession
) -> None:
    first = await _sign_in(client, sub="google-admin")
    assert first.status_code == 201, first.text
    profile = await _profile(db_session, first.json()["party_id"])
    await db_session.execute(
        user_permissions.insert().values(
            user_id=profile.account_user_id, permission=Permission.ADMIN.value
        )
    )
    await db_session.commit()

    second = await _sign_in(client, sub="google-admin")

    assert second.status_code == 200, second.text
    token = second.json()["token"]
    assert sorted(decode_token(token, settings.jwt_secret)["permissions"]) == [
        "ADMIN",
        "EDIT",
        "READ",
    ]
    me = await client.get("/api/people/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200, me.text
    assert me.json()["account_user_id"] == str(profile.account_user_id)


async def test_googleSignIn_tokenAsAuthorizeFormToken_issuesConsentCodeForTheUser(
    client: AsyncClient, google: None, db_session: AsyncSession
) -> None:
    redirect_uri = "https://client.example/callback"
    registered = await client.post(
        "/oauth2/register",
        json={
            "client_name": "Consent client",
            "redirect_uris": [redirect_uri],
            "grant_types": ["authorization_code", "refresh_token"],
            "token_endpoint_auth_method": "client_secret_post",
        },
    )
    assert registered.status_code == 201, registered.text
    client_id = registered.json()["client_id"]
    signed_in = await _sign_in(client, sub="google-consent")
    assert signed_in.status_code == 201, signed_in.text
    profile = await _profile(db_session, signed_in.json()["party_id"])
    user = await db_session.get(User, profile.account_user_id)
    assert user is not None

    response = await client.post(
        "/oauth2/authorize",
        data={
            "_token": signed_in.json()["token"],
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "state": "s1",
        },
    )

    assert response.status_code == 302, response.text
    location = response.headers["location"]
    assert location.startswith(f"{redirect_uri}?code=") and location.endswith("&state=s1")
    code = location.removeprefix(f"{redirect_uri}?code=").removesuffix("&state=s1")
    entry = await authorization_code_store.consume(code)
    assert entry is not None
    assert (entry.username, sorted(entry.permissions)) == (user.username, ["EDIT", "READ"])


@pytest.mark.parametrize(("length", "status"), [(4096, 401), (4097, 400)])
async def test_googleSignIn_credentialLengthCap_rejectsOver4096Chars(
    client: AsyncClient, google: None, length: int, status: int
) -> None:
    response = await client.post(
        SIGN_IN_URL,
        json={"credential": "x" * length},
        headers={"Cookie": f"{NONCE_COOKIE_NAME}={encode_nonce_cookie('n')}"},
    )

    assert response.status_code == status, response.text
    if status == 400:
        assert "set-cookie" not in response.headers
    else:
        _assert_error(response, 401, COPY_401)
        _assert_cookie_cleared(response, secure=False)


async def test_googleNonce_secondPost_replacesCookieAndSuccessClearsIt(
    client: AsyncClient, google: None
) -> None:
    first_nonce = await _nonce(client)
    second_nonce = await _nonce(client)

    assert first_nonce != second_nonce
    assert [c.name for c in client.cookies.jar] == [NONCE_COOKIE_NAME]
    stale = await client.post(SIGN_IN_URL, json={"credential": _credential(first_nonce)})
    _assert_error(stale, 401, COPY_401)
    assert NONCE_COOKIE_NAME not in client.cookies

    third_nonce = await _nonce(client)
    credential = _credential(third_nonce, sub="google-rotation")
    signed_in = await client.post(SIGN_IN_URL, json={"credential": credential})
    assert signed_in.status_code == 201, signed_in.text
    assert NONCE_COOKIE_NAME not in client.cookies

    replay = await client.post(SIGN_IN_URL, json={"credential": credential})
    _assert_error(replay, 401, COPY_401)


@pytest.mark.parametrize(
    ("case", "status", "line"),
    [
        ("stale_identity", 401, "google sign-in rejected: reason=stale_identity"),
        ("nonce_mismatch", 401, "google sign-in rejected: reason=nonce_mismatch"),
        ("unverified", 403, "google sign-in rejected: reason=email_unverified"),
        ("email_taken", 409, "google sign-in rejected: reason=email_taken"),
        ("created", 201, "google sign-in ok: created=True"),
    ],
)
async def test_googleSignIn_outcome_logsOneLineWithoutSecretsOrEmail(
    client: AsyncClient,
    google: None,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    case: str,
    status: int,
    line: str,
) -> None:
    if case == "stale_identity":

        async def _stale(*_args: Any, **_kwargs: Any) -> None:
            raise StaleDataError("concurrent identity refresh")

        monkeypatch.setattr(auth_router, "sign_in_with_google", _stale)
    if case == "email_taken":
        await _register(client, "jan.google@example.com")
    nonce = await _nonce(client)
    cookie = client.cookies[NONCE_COOKIE_NAME]
    credential = _credential(
        "other-nonce" if case == "nonce_mismatch" else nonce,
        email_verified=case != "unverified",
    )

    with caplog.at_level(logging.INFO):
        response = await client.post(SIGN_IN_URL, json={"credential": credential})

    assert response.status_code == status, response.text
    _assert_cookie_cleared(response, secure=False)
    logged = [r.getMessage() for r in caplog.records if "google sign-in" in r.getMessage()]
    assert logged == [line]
    for secret in (credential, cookie, nonce, "jan.google@example.com"):
        assert secret not in caplog.text


@pytest.mark.parametrize(
    "failure",
    [
        TextModerationRejected("rejected"),
        ModerationUnavailable(),
        None,
    ],
    ids=["rejected", "unavailable", "blank-name"],
)
async def test_googleSignIn_nameNotUsable_fallsBackToEmailDerivedName(
    client: AsyncClient,
    google: None,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception | None,
) -> None:
    async def _check_text(*_args: Any, **_kwargs: Any) -> None:
        if failure is not None:
            raise failure

    monkeypatch.setattr(auth_service, "check_text", _check_text)

    response = await _sign_in(
        client, email="anna.nowak@example.com", name="Anna" if failure else "   "
    )

    assert response.status_code == 201, response.text
    profile = await _profile(db_session, response.json()["party_id"])
    assert profile.display_name == "Anna Nowak"


@pytest.mark.parametrize(
    ("race", "status"),
    [("identity", 200), ("username_once", 201), ("username_always", 401)],
)
async def test_googleSignIn_bootstrapRace_resolvesWithoutDuplicateRows(
    client: AsyncClient,
    google: None,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    race: str,
    status: int,
) -> None:
    if race == "identity":
        # A concurrent first sign-in committed between the pre-checks and the
        # insert: both pre-checks miss once, then the re-read finds the identity.
        first = await _sign_in(client, sub="google-race")
        assert first.status_code == 201, first.text
        original_find = auth_service.find_identity
        find_calls = 0

        async def _find_misses_once(db: AsyncSession, subject: str) -> UserIdentity | None:
            nonlocal find_calls
            find_calls += 1
            return None if find_calls == 1 else await original_find(db, subject)

        async def _email_misses(db: AsyncSession, email: str) -> bool:
            return False

        monkeypatch.setattr(auth_service, "find_identity", _find_misses_once)
        monkeypatch.setattr(users_service, "is_email_registered", _email_misses)
        subject, email = "google-race", "jan.google@example.com"
    else:
        await _register(client, "taken.name@example.com")
        original_derive = users_service.derive_username_from_email
        derive_calls = 0

        async def _collides(db: AsyncSession, email: str) -> str:
            nonlocal derive_calls
            derive_calls += 1
            if race == "username_once" and derive_calls > 1:
                return await original_derive(db, email)
            return "taken.name"

        monkeypatch.setattr(users_service, "derive_username_from_email", _collides)
        subject, email = f"google-{race}", "fresh.name@example.com"

    response = await _sign_in(client, sub=subject, email=email)

    assert response.status_code == status, response.text
    _assert_cookie_cleared(response, secure=False)
    if status == 401:
        _assert_error(response, 401, COPY_401)
        assert await _identity_count(db_session, subject) == 0
        return
    assert await _identity_count(db_session, subject) == 1
    accounts = (
        await db_session.execute(
            select(func.count())
            .select_from(UserProfile)
            .where(func.lower(UserProfile.email) == email)
        )
    ).scalar_one()
    assert accounts == 1
    profile = await _profile(db_session, response.json()["party_id"])
    user = await db_session.get(User, profile.account_user_id)
    assert user is not None
    assert uuid.UUID(response.json()["party_id"])
    if race == "username_once":
        assert user.username == "fresh.name"
