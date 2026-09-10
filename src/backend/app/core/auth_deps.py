"""FastAPI auth dependencies: token extraction, `get_current_principal`, and
`require_any(*permissions)` — the FastAPI-idiomatic replacement for the Java
`SecurityConfiguration`'s centralized `SecurityFilterChain` (per
`backend/security.md`'s "no @PreAuthorize" convention: authorization is not
scattered as per-method annotations, it's one small set of dependencies every
router declares against). Authorities are internally represented with a
`PERMISSION_` prefix (Spring `GrantedAuthority` convention) when mapped from
JWT claims; `require_any` encapsulates this so route code just declares e.g.
`Depends(require_any("READ", "mcp:read"))` without knowing about the prefix.
Calling `require_any()` with no arguments means "any authenticated principal,
no specific permission required" — this is row 25's catch-all, and also what
protects `/oauth2/authorize` (which needs prior authentication but isn't
itself permission-gated).

This module is a flat re-export facade: the implementation lives in
`app.core._auth.*` and the authorization matrix in
`app.core.authorization_matrix`.
"""

from __future__ import annotations

from app.core._auth.dependencies import require_any
from app.core._auth.exception_handlers import register_auth_exception_handlers
from app.core._auth.principal import (
    AuthenticationRequiredException,
    OptionalPrincipal,
    Principal,
    get_current_principal,
)

__all__ = [
    "Principal",
    "require_any",
    "OptionalPrincipal",
    "get_current_principal",
    "AuthenticationRequiredException",
    "register_auth_exception_handlers",
]
