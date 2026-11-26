"""Google sign-in primitives: the ID-token verifier with its per-instance JWKS
cache, and the signed `aj_google_nonce` cookie that binds an ID token to the
browser that asked for the nonce.

Never log the credential, the cookie, the nonce or the email.
"""

from __future__ import annotations

import asyncio
import functools
import hashlib
import hmac
import logging
import secrets
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from starlette.responses import Response

from app.config import settings
from app.core.errors import ServiceUnavailableException
from app.core.security import decode_base64_hmac_key
from app.users.schemas import normalize_email

logger = logging.getLogger(__name__)

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
JWKS_FETCH_TIMEOUT_SECONDS = 5.0
JWKS_TTL_SECONDS = 3600.0
FORCED_REFRESH_MIN_INTERVAL_SECONDS = 60.0
FAILURE_BACKOFF_SECONDS = 60.0
JWKS_GRACE_SECONDS = 24 * 3600.0
LEEWAY_SECONDS = 30
_REQUIRED_CLAIMS = ["iss", "aud", "sub", "exp", "iat", "nonce"]

NONCE_COOKIE_NAME = "aj_google_nonce"
NONCE_COOKIE_PATH = "/api/auth/google"
NONCE_TTL_SECONDS = 600
_NONCE_AUDIENCE = "aj:google-nonce"
_NONCE_KEY_PURPOSE = b"aj google-nonce cookie v1"

FetchJwks = Callable[[], Awaitable[Any]]


class GoogleTokenInvalid(Exception):
    """The ID token or the nonce cookie failed a check. 401; `reason` is a
    short code safe to log."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


GOOGLE_UNAVAILABLE_COPY = (
    "Logowanie przez Google jest chwilowo niedostępne. Zaloguj się emailem albo spróbuj później."
)


class GoogleKeysUnavailable(ServiceUnavailableException):
    """Google's signing keys could not be fetched. 503; the central handler
    renders the same copy should a route not catch it."""

    def __init__(self) -> None:
        super().__init__(GOOGLE_UNAVAILABLE_COPY)


@dataclass(frozen=True)
class GoogleClaims:
    subject: str
    email: str
    email_verified: bool
    name: str | None


def new_nonce() -> str:
    return secrets.token_urlsafe(32)


def _nonce_cookie_key() -> bytes:
    """A purpose key, so a login token never passes as a nonce cookie or the
    other way round."""
    return hmac.new(
        decode_base64_hmac_key(settings.jwt_secret), _NONCE_KEY_PURPOSE, hashlib.sha256
    ).digest()


def encode_nonce_cookie(nonce: str) -> str:
    issued_at = int(time.time())
    claims = {
        "nonce": nonce,
        "iat": issued_at,
        "exp": issued_at + NONCE_TTL_SECONDS,
        "aud": _NONCE_AUDIENCE,
    }
    return jwt.encode(claims, _nonce_cookie_key(), algorithm="HS256")


def read_nonce_cookie(value: str | None) -> str:
    if not value:
        raise GoogleTokenInvalid("missing_cookie")
    try:
        claims = jwt.decode(
            value,
            _nonce_cookie_key(),
            algorithms=["HS256"],
            audience=_NONCE_AUDIENCE,
            options={"require": ["nonce", "iat", "exp", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise GoogleTokenInvalid("bad_cookie") from exc
    nonce = claims["nonce"]
    if not isinstance(nonce, str) or not nonce:
        raise GoogleTokenInvalid("bad_cookie")
    return nonce


def _nonce_cookie_attributes() -> dict[str, Any]:
    return {
        "path": NONCE_COOKIE_PATH,
        "secure": settings.auth_cookie_secure,
        "httponly": True,
        "samesite": "lax",
    }


def set_nonce_cookie(response: Response, value: str) -> None:
    response.set_cookie(
        NONCE_COOKIE_NAME, value, max_age=NONCE_TTL_SECONDS, **_nonce_cookie_attributes()
    )


def clear_nonce_cookie(response: Response) -> None:
    response.delete_cookie(NONCE_COOKIE_NAME, **_nonce_cookie_attributes())


async def fetch_google_jwks() -> Any:
    async with httpx.AsyncClient(timeout=JWKS_FETCH_TIMEOUT_SECONDS) as client:
        response = await client.get(GOOGLE_JWKS_URL)
        response.raise_for_status()
        return response.json()


def _parse_jwks(body: Any) -> dict[str, jwt.PyJWK]:
    if not isinstance(body, dict) or not isinstance(body.get("keys"), list):
        raise ValueError("JWKS body without a keys list")
    keys: dict[str, jwt.PyJWK] = {}
    for entry in body["keys"]:
        if not isinstance(entry, dict) or entry.get("alg") != "RS256":
            continue
        kid = entry.get("kid")
        if not isinstance(kid, str):
            continue
        try:
            keys[kid] = jwt.PyJWK(entry)
        except jwt.PyJWTError:
            continue
    return keys


_DECODE_ERRORS: tuple[tuple[type[jwt.PyJWTError], str], ...] = (
    (jwt.ExpiredSignatureError, "expired"),
    (jwt.ImmatureSignatureError, "iat_future"),
    (jwt.InvalidIssuerError, "bad_iss"),
    (jwt.InvalidAudienceError, "bad_aud"),
    (jwt.MissingRequiredClaimError, "missing_claim"),
    (jwt.InvalidSignatureError, "bad_signature"),
)


class GoogleTokenVerifier:
    """Verifies Google ID tokens locally against Google's JWKS. The key cache,
    its lock and its timestamps belong to the instance, so separate verifiers
    share nothing; `clock` drives the TTL, the forced-refresh throttle, the
    backoff after a failed fetch and the grace period for expired keys."""

    def __init__(
        self,
        client_id: str,
        fetch_jwks: FetchJwks,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._client_id = client_id
        self._fetch_jwks = fetch_jwks
        self._clock = clock
        self._keys: dict[str, jwt.PyJWK] = {}
        self._expires_at = float("-inf")
        self._last_fetch: float | None = None
        self._failed_at: float | None = None
        self._lock = asyncio.Lock()

    async def verify(self, credential: str, expected_nonce: str) -> GoogleClaims:
        try:
            header = jwt.get_unverified_header(credential)
        except jwt.PyJWTError as exc:
            raise GoogleTokenInvalid("bad_header") from exc
        if header.get("alg") != "RS256":
            raise GoogleTokenInvalid("bad_alg")
        kid = header.get("kid")
        if not isinstance(kid, str):
            raise GoogleTokenInvalid("unknown_kid")
        key = await self._key_for(kid)

        try:
            claims = jwt.decode(
                credential,
                key,
                algorithms=["RS256"],
                audience=self._client_id,
                issuer=GOOGLE_ISSUERS,
                leeway=LEEWAY_SECONDS,
                options={"require": _REQUIRED_CLAIMS},
            )
        except jwt.PyJWTError as exc:
            reason = next(
                (code for error, code in _DECODE_ERRORS if isinstance(exc, error)),
                "invalid_token",
            )
            raise GoogleTokenInvalid(reason) from exc

        if claims["aud"] != self._client_id:
            raise GoogleTokenInvalid("bad_aud")
        if "azp" in claims and claims["azp"] != self._client_id:
            raise GoogleTokenInvalid("bad_azp")
        nonce = claims["nonce"]
        if not isinstance(nonce, str) or not hmac.compare_digest(
            nonce.encode("utf-8"), expected_nonce.encode("utf-8")
        ):
            raise GoogleTokenInvalid("nonce_mismatch")
        subject = claims["sub"]
        if not isinstance(subject, str) or not subject:
            raise GoogleTokenInvalid("missing_claim")
        email = claims.get("email")
        if not isinstance(email, str) or not email.strip():
            raise GoogleTokenInvalid("missing_email")
        name = claims.get("name")
        return GoogleClaims(
            subject=subject,
            email=normalize_email(email),
            email_verified=claims.get("email_verified") is True,
            name=name if isinstance(name, str) else None,
        )

    async def _key_for(self, kid: str) -> jwt.PyJWK:
        key = self._cached_key(kid)
        if key is not None:
            return key
        async with self._lock:
            key = self._cached_key(kid)
            if key is not None:
                return key
            now = self._clock()
            if self._failed_at is not None and now - self._failed_at < FAILURE_BACKOFF_SECONDS:
                return self._grace_key(kid, now)
            throttled = (
                self._last_fetch is not None
                and now < self._expires_at
                and now - self._last_fetch < FORCED_REFRESH_MIN_INTERVAL_SECONDS
            )
            if not throttled:
                try:
                    await self._refresh(now)
                except GoogleKeysUnavailable:
                    return self._grace_key(kid, now)
            key = self._keys.get(kid)
        if key is None:
            raise GoogleTokenInvalid("unknown_kid")
        return key

    def _cached_key(self, kid: str) -> jwt.PyJWK | None:
        if self._clock() >= self._expires_at:
            return None
        return self._keys.get(kid)

    def _grace_key(self, kid: str, now: float) -> jwt.PyJWK:
        """After a failed fetch: the last key set, expired for at most the
        grace period, else fail closed."""
        key = self._keys.get(kid)
        if key is None or now >= self._expires_at + JWKS_GRACE_SECONDS:
            raise GoogleKeysUnavailable()
        return key

    async def _refresh(self, now: float) -> None:
        try:
            keys = _parse_jwks(await self._fetch_jwks())
        except Exception as exc:
            self._failed_at = now
            logger.warning("google jwks fetch failed: %s", type(exc).__name__)
            raise GoogleKeysUnavailable() from exc
        self._keys = keys
        self._last_fetch = now
        self._failed_at = None
        self._expires_at = now + JWKS_TTL_SECONDS


@functools.cache
def get_google_verifier() -> GoogleTokenVerifier:
    """The process-wide verifier; a FastAPI dependency that tests override."""
    return GoogleTokenVerifier(settings.google_client_id or "", fetch_google_jwks)
