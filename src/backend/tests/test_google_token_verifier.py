"""Google ID-token verifier and nonce cookie: tokens are signed locally with
an RSA key generated once per module and served by a fake JWKS fetcher, so
no test touches the network."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm
from starlette.responses import Response

from app.auth import google
from app.auth.google import (
    GoogleKeysUnavailable,
    GoogleTokenInvalid,
    GoogleTokenVerifier,
    clear_nonce_cookie,
    encode_nonce_cookie,
    new_nonce,
    read_nonce_cookie,
    set_nonce_cookie,
)
from app.config import Settings, settings

CLIENT_ID = "test-client.apps.googleusercontent.com"
KID = "key-1"
NONCE = "nonce-abc"
EMAIL = "Jan.Kowalski@Example.com"

_SIGNING_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_FOREIGN_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwk(private_key: rsa.RSAPrivateKey, kid: str) -> dict[str, Any]:
    jwk = RSAAlgorithm.to_jwk(private_key.public_key(), as_dict=True)
    return {**jwk, "kid": kid, "alg": "RS256", "use": "sig"}


class FakeJwks:
    def __init__(self, *key_sets: list[dict[str, Any]]) -> None:
        self._key_sets = list(key_sets)
        self.calls = 0

    async def __call__(self) -> Any:
        keys = self._key_sets[min(self.calls, len(self._key_sets) - 1)]
        self.calls += 1
        return {"keys": keys}


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "azp": CLIENT_ID,
        "sub": "1234567890",
        "email": EMAIL,
        "email_verified": True,
        "name": "Jan Kowalski",
        "nonce": NONCE,
        "iat": now,
        "exp": now + 3600,
    }
    for key, value in overrides.items():
        if value is _DROP:
            claims.pop(key)
        else:
            claims[key] = value
    return claims


_DROP = object()


def _token(
    claims: dict[str, Any],
    *,
    key: Any = _SIGNING_KEY,
    kid: str = KID,
    algorithm: str = "RS256",
) -> str:
    return jwt.encode(claims, key, algorithm=algorithm, headers={"kid": kid})


def _verifier(fetch: FakeJwks | None = None, clock: FakeClock | None = None) -> GoogleTokenVerifier:
    return GoogleTokenVerifier(
        CLIENT_ID, fetch or FakeJwks([_jwk(_SIGNING_KEY, KID)]), clock or FakeClock()
    )


async def test_verify_validToken_returnsClaims() -> None:
    claims = await _verifier().verify(_token(_claims()), NONCE)

    assert claims.subject == "1234567890"
    assert claims.email == "jan.kowalski@example.com"
    assert claims.email_verified is True
    assert claims.name == "Jan Kowalski"


def _none_alg_token() -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none","kid":"key-1"}').rstrip(b"=")
    body = base64.urlsafe_b64encode(json.dumps(_claims()).encode()).rstrip(b"=")
    return f"{header.decode()}.{body.decode()}."


_INVALID_TOKENS: list[tuple[str, Any, str]] = [
    ("hs256", lambda: _token(_claims(), key="x" * 32, algorithm="HS256"), "bad_alg"),
    ("none_alg", _none_alg_token, "bad_alg"),
    ("garbage", lambda: "not-a-jwt", "bad_header"),
    ("foreign_signature", lambda: _token(_claims(), key=_FOREIGN_KEY), "bad_signature"),
    ("unknown_kid", lambda: _token(_claims(), kid="other"), "unknown_kid"),
    ("bad_iss", lambda: _token(_claims(iss="https://evil.example.com")), "bad_iss"),
    ("bad_aud", lambda: _token(_claims(aud="other-client")), "bad_aud"),
    ("aud_list", lambda: _token(_claims(aud=[CLIENT_ID, "other"])), "bad_aud"),
    ("azp_mismatch", lambda: _token(_claims(azp="other-client")), "bad_azp"),
    ("expired", lambda: _token(_claims(exp=int(time.time()) - 120)), "expired"),
    ("iat_future", lambda: _token(_claims(iat=int(time.time()) + 600)), "iat_future"),
    ("missing_nonce", lambda: _token(_claims(nonce=_DROP)), "missing_claim"),
    ("non_str_nonce", lambda: _token(_claims(nonce=12345)), "nonce_mismatch"),
    ("non_ascii_nonce", lambda: _token(_claims(nonce="nonce-ąbc")), "nonce_mismatch"),
    ("nonce_mismatch", lambda: _token(_claims(nonce="other-nonce")), "nonce_mismatch"),
    ("missing_email", lambda: _token(_claims(email=_DROP)), "missing_email"),
    ("missing_sub", lambda: _token(_claims(sub=_DROP)), "missing_claim"),
]


@pytest.mark.parametrize(
    ("build", "reason"),
    [(build, reason) for _, build, reason in _INVALID_TOKENS],
    ids=[case_id for case_id, _, _ in _INVALID_TOKENS],
)
async def test_verify_invalidToken_raisesGoogleTokenInvalid(build: Any, reason: str) -> None:
    with pytest.raises(GoogleTokenInvalid) as raised:
        await _verifier().verify(build(), NONCE)

    assert raised.value.reason == reason


@pytest.mark.parametrize("value", ["true", 1, _DROP])
async def test_verify_emailVerifiedNotStrictTrue_isFalse(value: Any) -> None:
    claims = await _verifier().verify(_token(_claims(email_verified=value)), NONCE)

    assert claims.email_verified is False


async def test_verify_unknownKid_refreshesOnceThrottledAndPerInstance() -> None:
    old_keys = [_jwk(_FOREIGN_KEY, "old")]
    rotated = [_jwk(_FOREIGN_KEY, "old"), _jwk(_SIGNING_KEY, KID)]
    fetch = FakeJwks(old_keys, rotated)
    clock = FakeClock()
    verifier = _verifier(fetch, clock)
    await verifier.verify(_token(_claims(), key=_FOREIGN_KEY, kid="old"), NONCE)
    clock.now += 61

    await verifier.verify(_token(_claims()), NONCE)
    assert fetch.calls == 2

    with pytest.raises(GoogleTokenInvalid) as raised:
        await verifier.verify(_token(_claims(), kid="missing"), NONCE)
    assert raised.value.reason == "unknown_kid"
    assert fetch.calls == 2

    other_fetch = FakeJwks(old_keys)
    with pytest.raises(GoogleTokenInvalid):
        await _verifier(other_fetch, clock).verify(_token(_claims()), NONCE)
    assert other_fetch.calls == 1


async def _timeout() -> Any:
    raise httpx.ReadTimeout("timed out")


async def _server_error() -> Any:
    response = httpx.Response(500, request=httpx.Request("GET", google.GOOGLE_JWKS_URL))
    response.raise_for_status()


async def _no_keys() -> Any:
    return {"something": []}


@pytest.mark.parametrize("fetch", [_timeout, _server_error, _no_keys])
async def test_verify_jwksFailure_raisesKeysUnavailableWithOneWarning(
    fetch: Any, caplog: pytest.LogCaptureFixture
) -> None:
    credential = _token(_claims())
    verifier = GoogleTokenVerifier(CLIENT_ID, fetch, FakeClock())

    with (
        caplog.at_level(logging.INFO, logger="app.auth.google"),
        pytest.raises(GoogleKeysUnavailable),
    ):
        await verifier.verify(credential, NONCE)

    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1
    assert credential not in caplog.text
    assert EMAIL.lower() not in caplog.text.lower()


class FlakyJwks:
    def __init__(self) -> None:
        self.failing = False
        self.calls = 0

    async def __call__(self) -> Any:
        self.calls += 1
        if self.failing:
            raise httpx.ConnectError("down")
        return {"keys": [_jwk(_SIGNING_KEY, KID)]}


async def test_verify_failureWithinBackoff_doesNotRefetch(
    caplog: pytest.LogCaptureFixture,
) -> None:
    fetch = FlakyJwks()
    fetch.failing = True
    clock = FakeClock()
    verifier = GoogleTokenVerifier(CLIENT_ID, fetch, clock)
    credential = _token(_claims())

    with caplog.at_level(logging.WARNING, logger="app.auth.google"):
        with pytest.raises(GoogleKeysUnavailable):
            await verifier.verify(credential, NONCE)
        clock.now += 59
        with pytest.raises(GoogleKeysUnavailable):
            await verifier.verify(credential, NONCE)
        assert fetch.calls == 1

        clock.now += 2
        with pytest.raises(GoogleKeysUnavailable):
            await verifier.verify(credential, NONCE)

    assert fetch.calls == 2
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 2


async def test_verify_expiredKeysAfterFailedRefresh_verifyWithinGrace() -> None:
    fetch = FlakyJwks()
    clock = FakeClock()
    verifier = GoogleTokenVerifier(CLIENT_ID, fetch, clock)
    credential = _token(_claims())
    await verifier.verify(credential, NONCE)
    fetch.failing = True
    clock.now += google.JWKS_TTL_SECONDS + 1

    claims = await verifier.verify(credential, NONCE)
    clock.now += 30
    await verifier.verify(credential, NONCE)

    assert claims.subject == "1234567890"
    assert fetch.calls == 2


async def test_verify_expiredKeysPastGrace_raisesKeysUnavailable() -> None:
    fetch = FlakyJwks()
    clock = FakeClock()
    verifier = GoogleTokenVerifier(CLIENT_ID, fetch, clock)
    credential = _token(_claims())
    await verifier.verify(credential, NONCE)
    fetch.failing = True
    clock.now += google.JWKS_TTL_SECONDS + google.JWKS_GRACE_SECONDS

    with pytest.raises(GoogleKeysUnavailable):
        await verifier.verify(credential, NONCE)
    assert fetch.calls == 2


def _set_cookie_headers(response: Response) -> list[str]:
    return [v.decode() for k, v in response.raw_headers if k == b"set-cookie"]


@pytest.mark.parametrize("secure", [True, False])
def test_nonceCookie_roundTripAndAttributes(monkeypatch: pytest.MonkeyPatch, secure: bool) -> None:
    monkeypatch.setattr(settings, "auth_cookie_secure", secure)
    nonce = new_nonce()
    value = encode_nonce_cookie(nonce)

    assert read_nonce_cookie(value) == nonce
    response = Response()
    set_nonce_cookie(response, value)
    clear_nonce_cookie(response)
    set_header, clear_header = (h.lower() for h in _set_cookie_headers(response))
    for header in (set_header, clear_header):
        assert header.startswith("aj_google_nonce=")
        assert "httponly" in header
        assert "path=/api/auth/google" in header
        assert "samesite=lax" in header
        assert ("secure" in header.split("; ")) is secure
    assert "max-age=600" in set_header
    assert "max-age=0" in clear_header


def _signed_cookie(key: bytes, **overrides: Any) -> str:
    now = int(time.time())
    claims = {"nonce": NONCE, "iat": now, "exp": now + 600, "aud": "aj:google-nonce", **overrides}
    return jwt.encode(claims, key, algorithm="HS256")


def _jwt_key() -> bytes:
    return base64.b64decode(settings.jwt_secret)


def _purpose_key() -> bytes:
    return hmac.new(_jwt_key(), b"aj google-nonce cookie v1", hashlib.sha256).digest()


def _tampered() -> str:
    value = _signed_cookie(_purpose_key())
    head, body, signature = value.split(".")
    flipped = ("A" if signature[0] != "A" else "B") + signature[1:]
    return f"{head}.{body}.{flipped}"


_BAD_COOKIES: list[tuple[str, Any]] = [
    ("missing", lambda: None),
    ("tampered", _tampered),
    ("expired", lambda: _signed_cookie(_purpose_key(), exp=int(time.time()) - 60)),
    ("plain_jwt_key", lambda: _signed_cookie(_jwt_key())),
    ("wrong_aud", lambda: _signed_cookie(_purpose_key(), aud="aj:other")),
]


@pytest.mark.parametrize("build", [b for _, b in _BAD_COOKIES], ids=[i for i, _ in _BAD_COOKIES])
def test_readNonceCookie_badCookie_raisesGoogleTokenInvalid(build: Any) -> None:
    assert read_nonce_cookie(_signed_cookie(_purpose_key())) == NONCE

    with pytest.raises(GoogleTokenInvalid):
        read_nonce_cookie(build())


@pytest.mark.parametrize(
    ("client_id", "configured"), [(None, False), ("", False), ("  \t ", False), ("id", True)]
)
def test_settings_googleLoginConfigured_followsClientId(
    client_id: str | None, configured: bool
) -> None:
    configured_settings = Settings(google_client_id=client_id)

    assert configured_settings.google_login_configured is configured
    assert configured_settings.auth_cookie_secure is True


@pytest.mark.parametrize(("raw", "secure"), [("", True), ("false", False), ("true", True)])
def test_settings_authCookieSecureEnv_emptyKeepsDefault(
    monkeypatch: pytest.MonkeyPatch, raw: str, secure: bool
) -> None:
    monkeypatch.setenv("AUTH_COOKIE_SECURE", raw)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "")

    loaded = Settings()

    assert loaded.auth_cookie_secure is secure
    assert loaded.google_login_configured is False
