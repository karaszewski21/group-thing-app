"""`GET /.well-known/oauth-authorization-server` (RFC 8414 authorization
server metadata) and `GET /api/oauth2/client-info` (DCR client lookup, this
service's own extension, not part of any RFC).

`resolve_base_url` is the single shared base-URL/issuer resolver — per
spec.md, it must be reused (not reimplemented) by both this module's
metadata endpoint and `router.py`'s `/oauth2/token` `iss`/`aud` claims,
which is why it lives here as the module `router.py` imports from, rather
than being duplicated.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db

from .models import RegisteredClient

router = APIRouter(tags=["oauth2-metadata"])

DbSession = Annotated[AsyncSession, Depends(get_db)]

_DEFAULT_PORT_BY_SCHEME: dict[str, int] = {"http": 80, "https": 443}


def resolve_base_url(request: Request) -> str:
    """Builds `{scheme}://{host}[:{port}]`, honoring `X-Forwarded-Proto` /
    `X-Forwarded-Host` / `X-Forwarded-Port` (reverse-proxy aware) as
    overrides of the request's own scheme/host/port.

    Port-omission rules (per spec.md):
    - the port is omitted whenever it equals the scheme's default (80 for
      `http`, 443 for `https`), forwarded or not;
    - the port is also omitted when `X-Forwarded-Proto` is set but no
      explicit `X-Forwarded-Port` was given — a proxy that only forwards
      the scheme is assumed to be terminating on the scheme's own default
      port, not the backend's actual listening port.
    """
    forwarded_proto = request.headers.get("X-Forwarded-Proto")
    forwarded_host = request.headers.get("X-Forwarded-Host")
    forwarded_port = request.headers.get("X-Forwarded-Port")

    scheme = forwarded_proto or request.url.scheme
    host = forwarded_host or request.url.hostname or "localhost"

    port: int | None
    if forwarded_port:
        port = int(forwarded_port)
    elif forwarded_proto:
        # Proxy declared a scheme but no explicit port -> omit entirely,
        # regardless of the actual connection port.
        port = None
    else:
        port = request.url.port

    if port is not None and port == _DEFAULT_PORT_BY_SCHEME.get(scheme):
        port = None

    if port is not None:
        return f"{scheme}://{host}:{port}"
    return f"{scheme}://{host}"


@router.get("/.well-known/oauth-authorization-server", response_model=None)
async def oauth_authorization_server_metadata(request: Request) -> Response:
    issuer = resolve_base_url(request)
    # Plain dict (not a pydantic model) so insertion order is preserved
    # verbatim in the JSON response, matching spec.md's exact field order.
    body = {
        "issuer": issuer,
        "authorization_endpoint": f"{issuer}/oauth2/authorize",
        "token_endpoint": f"{issuer}/oauth2/token",
        "registration_endpoint": f"{issuer}/oauth2/register",
        "introspection_endpoint": f"{issuer}/oauth2/introspect",
        "grant_types_supported": [
            "authorization_code",
            "refresh_token",
            "urn:ietf:params:oauth:grant-type:token-exchange",
        ],
        "response_types_supported": ["code"],
        "code_challenge_methods_supported": ["S256"],
        "token_endpoint_auth_methods_supported": [
            "client_secret_post",
            "client_secret_basic",
            "none",
        ],
        "scopes_supported": ["mcp:read", "mcp:edit"],
    }
    return JSONResponse(status_code=200, content=body)


@router.get("/api/oauth2/client-info", response_model=None)
async def client_info(client_id: str, db: DbSession) -> Response:
    """200 with the client's public info if `client_id` is registered;
    **404 with an empty body** (not the standard error envelope) if not —
    preserve this exactly, per spec.md's explicit "do not fix" note."""
    client = (
        await db.execute(select(RegisteredClient).where(RegisteredClient.client_id == client_id))
    ).scalar_one_or_none()
    if client is None:
        return Response(status_code=404, content=b"")

    body = {
        "client_id": client.client_id,
        "client_name": client.client_name or "Unknown Application",
        "scopes": client.scopes or [],
    }
    return JSONResponse(status_code=200, content=body)
