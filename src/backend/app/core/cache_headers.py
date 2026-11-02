"""Cache headers of the public reads that personalise on an optional
principal (an invalid token counts as anonymous)."""

from __future__ import annotations

from fastapi import Response

from app.core.auth_deps import Principal

# An anonymous response is identical for every visitor and already
# eventually consistent, so a short shared cache is safe. Set only on
# success: errors are raised before the header is written.
PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=60"
# A resolved principal gets reserver names, `by_me`, viewer flags or the
# owner's own address, which no shared cache may keep or serve to anyone
# else.
PERSONALISED_CACHE_CONTROL = "private, no-store"


def set_personalised_cache_headers(response: Response, principal: Principal | None) -> None:
    """`Vary` keeps a cache from mixing the anonymous and personalised
    variants."""
    response.headers["Cache-Control"] = (
        PUBLIC_CACHE_CONTROL if principal is None else PERSONALISED_CACHE_CONTROL
    )
    response.headers["Vary"] = "Authorization"
