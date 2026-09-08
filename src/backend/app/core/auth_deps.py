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

`AUTHORIZATION_MATRIX`/`resolve_requirement` reproduce spec.md's full
25-entry authorization matrix verbatim, in its exact evaluation order, as a
directly-testable reference: FastAPI has no native path-pattern
security-filter-chain equivalent to wire this table centrally the way Spring
does, so actual enforcement for rows 11-25 still happens per-route via
`require_any(...)` (each router declares the call matching its own row);
rows 1-10 (public) need no dependency at all — that's the FastAPI default.
"""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated, Literal

import jwt
from fastapi import Depends, FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.config import settings
from app.core.errors import AccessDeniedException, ErrorResponse
from app.core.security import decode_token

_BEARER_PREFIX = "Bearer "  # case-sensitive, exactly 7 characters


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


def _unauthorized_envelope() -> JSONResponse:
    body = ErrorResponse(status=401, error="Unauthorized", message="Authentication required")
    return JSONResponse(status_code=401, content=jsonable_encoder(body.model_dump(by_alias=True)))


async def authentication_required_handler(
    request: Request, exc: AuthenticationRequiredException
) -> JSONResponse:
    return _unauthorized_envelope()


def register_auth_exception_handlers(app: FastAPI) -> None:
    """Registers the 401 handler for `AuthenticationRequiredException`. The
    matching 403 case reuses `app.core.errors`'s already-registered
    `AccessDeniedException`/`access_denied_handler` — no separate 403
    handler needed here. Call this alongside
    `app.core.errors.register_exception_handlers` wherever the app is
    assembled.
    """
    app.add_exception_handler(AuthenticationRequiredException, authentication_required_handler)  # type: ignore[arg-type]


# --- Full authorization matrix (spec.md, verbatim, evaluation order) -------

Requirement = Literal["PUBLIC", "AUTHENTICATED"] | tuple[str, ...]


@dataclass(frozen=True, slots=True)
class MatrixEntry:
    methods: frozenset[str] | None  # None = any method
    pattern: re.Pattern[str]
    requirement: Requirement


def _methods(*names: str) -> frozenset[str]:
    return frozenset(names)


# Raw (methods, path-regex, requirement) rows — spec.md's table verbatim,
# kept as plain strings/tuples here so each row fits on one line; compiled
# into `AUTHORIZATION_MATRIX` below.
_RawEntry = tuple[frozenset[str] | None, str, Requirement]

_RAW_MATRIX: tuple[_RawEntry, ...] = (
    (_methods("GET"), r"^/\.well-known/oauth-authorization-server$", "PUBLIC"),  # 1
    (_methods("POST"), r"^/oauth2/register$", "PUBLIC"),  # 2
    (_methods("POST"), r"^/oauth2/token$", "PUBLIC"),  # 3
    (_methods("POST"), r"^/oauth2/introspect$", "PUBLIC"),  # 4
    (_methods("GET"), r"^/api/oauth2/client-info$", "PUBLIC"),  # 5
    (_methods("POST"), r"^/api/auth/login$", "PUBLIC"),  # 6
    (_methods("GET"), r"^/api/health$", "PUBLIC"),  # 7
    (None, r"^/assets/.*$", "PUBLIC"),  # 8
    (None, r"^(/|/index\.html|/[^/]+\.js|/[^/]+\.css|/favicon\.ico)$", "PUBLIC"),  # 9
    # 10 - any path NOT starting with /api/. Spec.md's table literally says
    # method "any", but its own prose note says `/oauth2/authorize` (a POST,
    # non-/api/ path) is deliberately NOT public and needs authentication —
    # a literal "any method" reading of row 10 would swallow it here, before
    # ever reaching row 25, contradicting that note. Resolved as GET-only:
    # this is an SPA-fallback rule (serving index.html to a browser
    # navigating), which is inherently a GET concern; scoping it to GET
    # excludes `/oauth2/authorize` (POST) without needing to special-case
    # that path, and lets it correctly fall through to row 25.
    (_methods("GET"), r"^(?!/api/).*$", "PUBLIC"),
    (_methods("GET"), r"^/api/products(/.*)?$", ("READ", "mcp:read")),  # 11
    (_methods("GET"), r"^/api/footprints/calculations/[^/]+/export$", ("READ", "mcp:read")),  # 12
    (_methods("GET"), r"^/api/plugins$", ("READ",)),  # 13
    (_methods("GET"), r"^/api/plugins/[^/]+$", ("READ",)),  # 14
    (_methods("GET"), r"^/api/plugins/[^/]+/objects(/.*)?$", ("READ",)),  # 15
    (_methods("GET"), r"^/api/plugins/[^/]+/products/[^/]+/data$", ("READ",)),  # 16
    (_methods("POST", "PUT", "DELETE"), r"^/api/products(/.*)?$", ("EDIT", "mcp:edit")),  # 17
    (_methods("PUT", "DELETE"), r"^/api/plugins/[^/]+/objects(/.*)?$", ("EDIT",)),  # 18
    (_methods("PUT", "DELETE"), r"^/api/plugins/[^/]+/products/[^/]+/data$", ("EDIT",)),  # 19
    (_methods("PUT"), r"^/api/plugins/[^/]+/manifest$", ("PLUGIN_MANAGEMENT",)),  # 20
    (_methods("PATCH"), r"^/api/plugins/[^/]+/enabled$", ("PLUGIN_MANAGEMENT",)),  # 21
    (_methods("DELETE"), r"^/api/plugins/[^/]+$", ("PLUGIN_MANAGEMENT",)),  # 22
    # Public circle/term page (`/krag/:groupId/publiczny`) — declared ahead of
    # row 26's blanket /api/groups READ requirement so an anonymous visitor
    # can load it, RSVP, and merge into a real account. Mirrors row 48's
    # placement.
    (_methods("GET"), r"^/api/groups/public/[^/]+$", "PUBLIC"),
    (_methods("POST"), r"^/api/groups/public/[^/]+/rsvp$", "PUBLIC"),
    (_methods("POST"), r"^/api/groups/public/merge$", "PUBLIC"),
    # 26-47: app.party / app.circulation — added beyond spec.md's original 25
    # rows for the Organizer/Circle/Family + Wypożyczalnia domain. Ownership
    # checks the matrix itself can't express (active organizer, own-family
    # guardian, reservation party, ...) are enforced in each vertical's
    # service.py — see standards/backend/security.md.
    (_methods("GET"), r"^/api/groups(/.*)?$", ("READ", "mcp:read")),  # 26
    (_methods("POST"), r"^/api/groups(/.*)?$", ("EDIT", "mcp:edit")),  # 27
    (_methods("GET"), r"^/api/families(/.*)?$", ("READ", "mcp:read")),  # 28
    (_methods("POST"), r"^/api/families(/.*)?$", ("EDIT", "mcp:edit")),  # 29
    (_methods("POST"), r"^/api/leaderships(/.*)?$", ("EDIT", "mcp:edit")),  # 30
    (_methods("POST"), r"^/api/memberships(/.*)?$", ("EDIT", "mcp:edit")),  # 31
    (_methods("GET"), r"^/api/terms(/.*)?$", ("READ", "mcp:read")),  # 32
    (_methods("POST"), r"^/api/terms(/.*)?$", ("EDIT", "mcp:edit")),  # 33
    (_methods("GET"), r"^/api/needed-items(/.*)?$", ("READ", "mcp:read")),  # 34
    (_methods("POST"), r"^/api/needed-items(/.*)?$", ("EDIT", "mcp:edit")),  # 35
    (_methods("GET"), r"^/api/pledges(/.*)?$", ("READ", "mcp:read")),  # 36
    (_methods("POST"), r"^/api/pledges(/.*)?$", ("EDIT", "mcp:edit")),  # 37
    (_methods("GET"), r"^/api/inventories(/.*)?$", ("READ", "mcp:read")),  # 38
    (_methods("POST"), r"^/api/inventories(/.*)?$", ("EDIT", "mcp:edit")),  # 39
    (_methods("GET"), r"^/api/inventory-items(/.*)?$", ("READ", "mcp:read")),  # 40
    (_methods("POST"), r"^/api/inventory-items(/.*)?$", ("EDIT", "mcp:edit")),  # 41
    (_methods("GET"), r"^/api/reservations(/.*)?$", ("READ", "mcp:read")),  # 42
    (_methods("POST"), r"^/api/reservations(/.*)?$", ("EDIT", "mcp:edit")),  # 43
    (_methods("GET"), r"^/api/accounts(/.*)?$", ("READ", "mcp:read")),  # 44
    (_methods("GET"), r"^/api/circulation-transactions(/.*)?$", ("READ", "mcp:read")),  # 45
    (_methods("GET"), r"^/api/people(/.*)?$", ("READ", "mcp:read")),  # 46
    # 47: public self-registration — the party-module counterpart to row 6's
    # `/api/auth/login`. No existing row matches this literal path, so it's
    # appended here rather than inserted next to row 6, to avoid renumbering
    # rows 7-22's original spec.md sequence.
    (_methods("POST"), r"^/api/auth/register$", "PUBLIC"),  # 47
    # Public organizer page (`domena.pl/<slug>`) — declared ahead of row 49's
    # blanket READ requirement so an unauthenticated visitor can load it.
    (_methods("GET"), r"^/api/organizations/public/[^/]+$", "PUBLIC"),  # 48
    (_methods("GET"), r"^/api/organizations(/.*)?$", ("READ", "mcp:read")),  # 49
    (_methods("POST", "PATCH"), r"^/api/organizations(/.*)?$", ("EDIT", "mcp:edit")),  # 50
    (None, r"^.*$", "AUTHENTICATED"),  # 25 - catch-all
)

AUTHORIZATION_MATRIX: tuple[MatrixEntry, ...] = tuple(
    MatrixEntry(methods, re.compile(pattern), requirement)
    for methods, pattern, requirement in _RAW_MATRIX
)


def resolve_requirement(method: str, path: str) -> Requirement:
    """Walks `AUTHORIZATION_MATRIX` in spec.md's exact evaluation order,
    first match wins. Exposed for direct verification and as the single
    source of truth future routers should consult when deciding which
    `require_any(...)` call matches their own route.
    """
    normalized_method = method.upper()
    for entry in AUTHORIZATION_MATRIX:
        if entry.methods is not None and normalized_method not in entry.methods:
            continue
        if entry.pattern.match(path):
            return entry.requirement
    return "AUTHENTICATED"  # unreachable: row 25 matches every path/method
