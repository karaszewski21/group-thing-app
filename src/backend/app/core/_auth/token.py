"""Bearer-token extraction from the incoming request — the single place the
`Authorization` header / `_token` query / `_token` form fallback order is
defined, consumed by `get_current_principal`.
"""

from __future__ import annotations

from fastapi import Request

_BEARER_PREFIX = "Bearer "  # case-sensitive, exactly 7 characters


async def _extract_token(request: Request) -> str | None:
    """`Authorization: Bearer <token>` header first (case-sensitive `"Bearer
    "` prefix); else a `_token` form/query param (supports the OAuth2
    authorize endpoint's native form POST, which can't set a custom header);
    else unauthenticated."""
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

    return None
