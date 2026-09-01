"""In-memory OAuth2 authorization-code store — a plain `dict` guarded by an
`asyncio.Lock`, per spec.md's "Persistence of OAuth2 code/token stores"
(fixed decision #2: preserved as-is, not durable to Postgres/Redis). TTL
600s, single-use (consumed on first successful redemption via `consume`),
background sweep every 5 minutes drops expired-but-unconsumed entries —
mirrors the Java `@Scheduled` cadence exactly. This module-level singleton
means the service must run single-process for these guarantees to hold (see
spec.md).

The refresh-token store (`RefreshTokenStore` below) follows the identical
dict+`asyncio.Lock` pattern: TTL 86400s (24h), swept every 1800s (30
minutes), single-use via `consume` — but unlike the authorization-code
store, a successful `consume` is always immediately followed by a fresh
`issue` at the `/oauth2/token` `refresh_token`-grant call site (rotation:
old invalidated, new issued, original scope reused).
"""

from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field

_AUTHORIZATION_CODE_TTL_SECONDS = 600
_CLEANUP_INTERVAL_SECONDS = 300  # 5 minutes, matches the Java cadence


@dataclass(frozen=True, slots=True)
class AuthorizationCodeEntry:
    """Everything captured at `/oauth2/authorize` success time, per
    spec.md: the authenticated user's identity/permissions are captured
    here, not deferred to token exchange."""

    client_id: str
    redirect_uri: str
    scope: str
    code_challenge: str | None
    code_challenge_method: str | None
    username: str
    permissions: tuple[str, ...]
    created_at: float = field(default_factory=time.time)

    def is_expired(self, now: float | None = None) -> bool:
        elapsed = (now if now is not None else time.time()) - self.created_at
        return elapsed > _AUTHORIZATION_CODE_TTL_SECONDS


class AuthorizationCodeStore:
    """Single-use, TTL-bound authorization-code storage. `authorization_code_store`
    below is the single process-wide instance routers should use."""

    def __init__(self) -> None:
        self._codes: dict[str, AuthorizationCodeEntry] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def generate_code() -> str:
        """256-bit URL-safe base64 code, no padding. `secrets.token_urlsafe`
        already produces the URL-safe alphabet with padding stripped."""
        return secrets.token_urlsafe(32)  # 32 bytes = 256 bits

    async def put(self, code: str, entry: AuthorizationCodeEntry) -> None:
        async with self._lock:
            self._codes[code] = entry

    async def consume(self, code: str) -> AuthorizationCodeEntry | None:
        """Single-use lookup: pops the entry if present, returns `None` if
        missing, already-consumed, or expired (expired entries are popped
        and discarded, not returned)."""
        async with self._lock:
            entry = self._codes.pop(code, None)
        if entry is None or entry.is_expired():
            return None
        return entry

    async def sweep_expired(self) -> None:
        """Drops expired-but-unconsumed entries. Called periodically (every
        5 minutes) by `run_cleanup_forever`."""
        now = time.time()
        async with self._lock:
            expired = [code for code, entry in self._codes.items() if entry.is_expired(now)]
            for code in expired:
                del self._codes[code]

    async def run_cleanup_forever(self) -> None:
        """Background sweep loop. Group 13 starts this via
        `asyncio.create_task` in the FastAPI lifespan."""
        while True:
            await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)
            await self.sweep_expired()


authorization_code_store = AuthorizationCodeStore()


_REFRESH_TOKEN_TTL_SECONDS = 86_400  # 24 hours
_REFRESH_TOKEN_CLEANUP_INTERVAL_SECONDS = 1_800  # 30 minutes, matches the Java cadence


@dataclass(frozen=True, slots=True)
class RefreshTokenEntry:
    """Everything needed to reissue an access token (and a rotated refresh
    token) without re-consulting the original authorization code: the
    granted client/username/scope from the grant that produced this
    refresh token."""

    client_id: str
    username: str
    scope: str
    created_at: float = field(default_factory=time.time)

    def is_expired(self, now: float | None = None) -> bool:
        elapsed = (now if now is not None else time.time()) - self.created_at
        return elapsed > _REFRESH_TOKEN_TTL_SECONDS


class RefreshTokenStore:
    """Single-use, TTL-bound, rotate-on-use refresh-token storage — same
    dict+`asyncio.Lock` pattern as `AuthorizationCodeStore`.
    `refresh_token_store` below is the single process-wide instance routers
    should use."""

    def __init__(self) -> None:
        self._tokens: dict[str, RefreshTokenEntry] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _generate_token() -> str:
        """256-bit URL-safe base64 token, no padding — same generation
        scheme as `AuthorizationCodeStore.generate_code`."""
        return secrets.token_urlsafe(32)  # 32 bytes = 256 bits

    async def issue(self, *, client_id: str, username: str, scope: str) -> str:
        """Generates a new refresh token, stores its entry, and returns the
        token string. Called both on initial `authorization_code`-grant
        success and on every `refresh_token`-grant rotation."""
        token = self._generate_token()
        async with self._lock:
            self._tokens[token] = RefreshTokenEntry(
                client_id=client_id, username=username, scope=scope
            )
        return token

    async def consume(self, token: str) -> RefreshTokenEntry | None:
        """Single-use lookup: pops the entry if present, returns `None` if
        missing, already-consumed (rotated away), or expired (expired
        entries are popped and discarded, not returned)."""
        async with self._lock:
            entry = self._tokens.pop(token, None)
        if entry is None or entry.is_expired():
            return None
        return entry

    async def sweep_expired(self) -> None:
        """Drops expired-but-unconsumed entries. Called periodically (every
        30 minutes) by `run_cleanup_forever`."""
        now = time.time()
        async with self._lock:
            expired = [token for token, entry in self._tokens.items() if entry.is_expired(now)]
            for token in expired:
                del self._tokens[token]

    async def run_cleanup_forever(self) -> None:
        """Background sweep loop. Group 13 starts this via
        `asyncio.create_task` in the FastAPI lifespan."""
        while True:
            await asyncio.sleep(_REFRESH_TOKEN_CLEANUP_INTERVAL_SECONDS)
            await self.sweep_expired()


refresh_token_store = RefreshTokenStore()
