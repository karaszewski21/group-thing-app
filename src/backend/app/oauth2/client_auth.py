"""`OAuth2ClientAuthenticator` — verifies OAuth2 client credentials (Basic
`Authorization` header, checked first, or POST-body `client_id`/
`client_secret` fields) against `oauth2_registered_client`, bcrypt-verified,
per spec.md's `/oauth2/token` (token-exchange grant) and `/oauth2/introspect`
requirements. Not used by `/oauth2/register` (public) or `/oauth2/authorize`
(gated by end-user JWT auth, not client credentials) — Group 5 ports the
class itself; its first call sites are Group 6's token-exchange/introspect
endpoints.
"""

from __future__ import annotations

import base64
import binascii

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password

from .models import RegisteredClient

_BASIC_PREFIX = "Basic "


async def _basic_credentials(request: Request) -> tuple[str, str] | None:
    header = request.headers.get("Authorization")
    if header is None or not header.startswith(_BASIC_PREFIX):
        return None
    try:
        decoded = base64.b64decode(header[len(_BASIC_PREFIX) :]).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        return None
    if ":" not in decoded:
        return None
    client_id, _, client_secret = decoded.partition(":")
    return client_id, client_secret


class OAuth2ClientAuthenticator:
    """Resolves and verifies the calling OAuth2 client from either a Basic
    `Authorization` header or POST-body `client_id`/`client_secret` form
    fields (Basic checked first; whichever is present wins)."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    async def authenticate(
        self,
        request: Request,
        body_client_id: str | None,
        body_client_secret: str | None,
    ) -> RegisteredClient | None:
        """Returns the authenticated `RegisteredClient`, or `None` if no
        credentials were supplied or they don't verify — callers map `None`
        to `invalid_client` ("Client authentication required" if no
        credentials at all were given, "Client authentication failed" if
        they were given but wrong; that distinction is the caller's
        responsibility since it's message-specific per endpoint)."""
        credentials = await _basic_credentials(request)
        if credentials is not None:
            client_id, client_secret = credentials
        elif body_client_id is not None and body_client_secret is not None:
            client_id, client_secret = body_client_id, body_client_secret
        else:
            return None

        client = (
            await self._db.execute(
                select(RegisteredClient).where(RegisteredClient.client_id == client_id)
            )
        ).scalar_one_or_none()
        if client is None or client.client_secret is None:
            return None
        if not verify_password(client_secret, client.client_secret):
            return None
        return client
