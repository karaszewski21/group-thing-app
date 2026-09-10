"""`require_any(*permissions)` — the dependency factory every router declares
against. Authenticated-or-401, and (if permissions are given) holds-one-or-403,
using the internal `PERMISSION_` prefix and any-of semantics.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends

from app.core._auth.principal import (
    AuthenticationRequiredException,
    Principal,
    get_current_principal,
)
from app.core.errors import AccessDeniedException


def require_any(*permission_names: str) -> Callable[..., Awaitable[Principal]]:
    """Dependency factory: the caller must be authenticated, and — if any
    `permission_names` are given — must hold at least one of them (checked
    with the internal `PERMISSION_` prefix, any-of semantics matching the
    matrix's `READ`/`EDIT`/`mcp:*`-bridge rows). No arguments means "just
    authenticated" (row 25's catch-all).
    """
    required_authorities = frozenset(f"PERMISSION_{name}" for name in permission_names)

    async def _dependency(
        principal: Annotated[Principal | None, Depends(get_current_principal)],
    ) -> Principal:
        if principal is None:
            raise AuthenticationRequiredException
        if required_authorities and not (required_authorities & principal.authorities):
            raise AccessDeniedException
        return principal

    return _dependency
