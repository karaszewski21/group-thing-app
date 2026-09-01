"""Password hashing, JWT encode/decode, and a shared JWT-signing-key helper.

Uses `bcrypt` directly (`hashpw`/`checkpw`), not `passlib` — per
target-state-plan.md's dependency research, `passlib` is effectively
unmaintained.
"""

from __future__ import annotations

import base64
import time
from typing import Any

import bcrypt
import jwt


def hash_password(plain_password: str) -> str:
    """Bcrypt-hash a plaintext password for storage (`users.password_hash`)."""
    return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Check a plaintext password against a stored bcrypt hash."""
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def decode_base64_hmac_key(encoded_secret: str) -> bytes:
    """Base64-decode a configured secret before using it as an HMAC signing
    key — mirrors the Java `JwtTokenProvider`'s
    `Decoders.BASE64.decode(secretString)` step. Called on
    `settings.jwt_secret` before handing the resulting bytes to
    `pyjwt.encode`/`pyjwt.decode` — getting this decode step wrong silently
    breaks interop with any already-issued token.
    """
    return base64.b64decode(encoded_secret)


def encode_login_token(
    username: str, permissions: list[str], secret: str, expiration_ms: int
) -> str:
    """Standard `POST /api/auth/login` token. Claim order is significant
    and is preserved here by dict insertion order (PyJWT's `json.dumps` step
    does not reorder keys): `sub, permissions, iat, exp`. No `iss` claim —
    that's an OAuth2-issued-token-only claim, added separately by whichever
    group ports the OAuth2 token endpoint.
    """
    issued_at = int(time.time())
    claims: dict[str, Any] = {
        "sub": username,
        "permissions": list(permissions),
        "iat": issued_at,
        "exp": issued_at + expiration_ms // 1000,
    }
    return jwt.encode(claims, key=decode_base64_hmac_key(secret), algorithm="HS256")


def decode_token(token: str, secret: str) -> dict[str, Any]:
    """Decodes and signature-verifies any JWT issued by this service —
    standard login tokens and (later) OAuth2-issued tokens alike, since both
    are HS256 over the same base64-decoded secret. Does not require `aud`/
    `iss` to be present (only OAuth2-issued tokens carry them); raises
    `jwt.PyJWTError` (or a subclass, e.g. `ExpiredSignatureError`) on any
    invalid/expired token — callers treat that the same as "no token".
    """
    return jwt.decode(token, key=decode_base64_hmac_key(secret), algorithms=["HS256"])
