"""Bearer-token extraction from the incoming request — the single place the
`Authorization` header / `_token` query / `_token` form / `auth_token` cookie
fallback order is defined, consumed by `get_current_principal`.
"""

from __future__ import annotations

from fastapi import Request

_BEARER_PREFIX = "Bearer "  # case-sensitive, exactly 7 characters
AUTH_COOKIE_NAME = "auth_token"
# The cookie is sent by the browser on cross-site requests too, so it is
# honoured only on methods that never change state (no CSRF surface);
# mutations and plugins keep the Bearer header.
_COOKIE_METHODS = frozenset({"GET", "HEAD"})


async def _extract_token(request: Request) -> str | None:
    """`Authorization: Bearer <token>` header first (case-sensitive `"Bearer
    "` prefix); else a `_token` form/query param (supports the OAuth2
    authorize endpoint's native form POST, which can't set a custom header);
    else, on GET/HEAD only, the JS-readable `auth_token` cookie the frontend
    writes for server-rendered pages; else unauthenticated."""
    auth_header = request.headers.get("Authorization")
    if auth_header is not None and auth_header.startswith(_BEARER_PREFIX):
        return auth_header[len(_BEARER_PREFIX) :]

    query_token = request.query_params.get("_token")
    if query_token:
        return query_token

    content_type = request.headers.get("content-type", "")
    if "form" in content_type:
        try:
            form = await request.form()
        except AssertionError:
            # Starlette's form parser requires the optional `python-
            # multipart` dependency (not currently in pyproject.toml, added
            # by whichever group's scope owns it); degrade to "no token
            # from form" rather than 500ing the whole request — the
            # `_token` query-param fallback above still covers the same
            # use case in the meantime.
            return None
        form_token = form.get("_token")
        if isinstance(form_token, str) and form_token:
            return form_token

    if request.method in _COOKIE_METHODS:
        return request.cookies.get(AUTH_COOKIE_NAME) or None

    return None
