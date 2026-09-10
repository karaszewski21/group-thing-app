"""The authenticated caller (`Principal`), the token-resolution entry point
`get_current_principal` (never raises), the `OptionalPrincipal` alias, and the
`AuthenticationRequiredException` that `require_any` turns a missing principal
into.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

import jwt
from fastapi import Depends, Request

from app.config import settings
from app.core._auth.token import _extract_token
from app.core.security import decode_token


@dataclass(frozen=True, slots=True)
class Principal:
    """The authenticated caller, resolved from a valid JWT. `authorities`
    already carries the internal `PERMISSION_` prefix."""

    username: str
    authorities: frozenset[str]


class AuthenticationRequiredException(Exception):
    """No valid token present on a protected route. Legacy 401, fixed
    message "Authentication required" — raised by `require_any`'s
    dependency, before any route body runs."""


async def get_current_principal(request: Request) -> Principal | None:
    """Resolves the authenticated principal, or `None` if unauthenticated
    (missing, malformed, or expired token) — never raises; `require_any` is
    what turns a `None` principal into a 401. Reads the `permissions` claim,
    falling back to `scopes` if absent (unifies login tokens and
    OAuth2-issued tokens through one code path, permissions checked first);
    if neither is present, an empty list.
    """
    token = await _extract_token(request)
    if token is None:
        return None

    try:
        claims = decode_token(token, settings.jwt_secret)
    except jwt.PyJWTError:
        return None

    username = claims.get("sub")
    if not isinstance(username, str):
        return None

    permissions = claims.get("permissions")
    if permissions is None:
        permissions = claims.get("scopes", [])

    authorities = frozenset(f"PERMISSION_{permission}" for permission in permissions)
    return Principal(username=username, authorities=authorities)


OptionalPrincipal = Annotated[Principal | None, Depends(get_current_principal)]
"""Readability alias for routes that optionally honour a session token —
`get_current_principal` already returns `None` (never raises) on a missing,
malformed, or expired token, so a route declaring this stays reachable
unauthenticated and never 401s on a bad token."""
