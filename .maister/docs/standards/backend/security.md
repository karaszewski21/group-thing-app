## Backend Security

*Migrated from Spring Security — see history note at the end of this file.*

### FastAPI Dependency-Based Authorization

There is no FastAPI equivalent of Spring's centralized `SecurityFilterChain` bean wiring every URL pattern to a rule in one place. Instead, authorization is expressed as a small set of composable dependencies (`app/core/auth_deps.py`) that every router declares against — this is the FastAPI-idiomatic replacement for "no `@PreAuthorize` scattered on individual methods": authorization checks are not attached ad hoc to individual route handlers as arbitrary logic, they're one of a small, fixed set of `Depends(require_any(...))` calls, matching a single central table.

```python
# A route declares its own requirement via require_any(...):
@router.get("/api/products")
async def list_products(
    principal: Annotated[Principal, Depends(require_any("READ", "mcp:read"))],
    ...
) -> ...:
    ...

# require_any() with no arguments means "authenticated, no specific permission":
@router.post("/oauth2/authorize", response_model=None)
async def authorize(
    principal: Annotated[Principal, Depends(require_any())],
    ...
```

### The Authorization Matrix Is Code, Not Scattered Route Decorators

`AUTHORIZATION_MATRIX` in `app/core/auth_deps.py` reproduces the full permission table (25 entries in this codebase) verbatim, in exact evaluation order, as a single directly-testable source of truth (`resolve_requirement(method, path)` walks it, first match wins). Because FastAPI has no native path-pattern security-filter-chain to wire this table *centrally* the way Spring does, actual enforcement for the non-public rows still happens per-route via each router's own `require_any(...)` call — but that call must match what the matrix says for that route. When adding a new route:

1. Add its row to `AUTHORIZATION_MATRIX` first (in the correct evaluation-order position — first-match-wins means row order is significant, not just row content)
2. Then declare the matching `Depends(require_any(...))` on the actual route

Don't add a permission check directly on a route without also adding/updating its row in the matrix — the matrix is meant to stay the single readable reference for "what's protected and how," even though enforcement is technically distributed.

### Public Routes Need No Dependency At All

Rows resolving to `"PUBLIC"` need no `Depends(...)` — that's simply the FastAPI/Starlette default for a route with no auth dependency declared. Only rows resolving to `"AUTHENTICATED"` or a permission tuple need an explicit `require_any(...)`.

### Row-Order Ambiguity: Resolve Toward the More Specific Rule, Document It

Matrix rows are evaluated in order, first match wins — a row stated informally (e.g. "any method") can accidentally swallow a more specific, later row if read too literally. When a matrix row's method scope is ambiguous against explicit prose elsewhere describing one specific route's behavior, the specific prose wins and the row is scoped down to avoid the conflict — documented inline at the row, not resolved silently. (Precedent: `AUTHORIZATION_MATRIX` row 10, an SPA-fallback rule, is scoped to `GET` only, specifically so it doesn't swallow `/oauth2/authorize` — a `POST`, non-`/api/` path that a separate note establishes is NOT public — before that request ever reaches the catch-all `AUTHENTICATED` row.)

### Error Responses for Auth Failures

Custom exception handlers replicate the legacy flat-envelope 401/403 shape (`{"status": ..., "error": ..., "message": ...}`), registered globally via `app.add_exception_handler(...)` in `app/main.py` — analogous to Spring's `AuthenticationEntryPoint`/`AccessDeniedHandler`, but as FastAPI exception handlers rather than filter-chain hooks. `AuthenticationRequiredException` (401, "Authentication required") is raised by `require_any`'s own dependency function before any route body runs; `AccessDeniedException` (403) is raised the same way for an authenticated-but-under-permissioned caller. Both fire before the route handler executes, so a route's own body never needs to check permissions itself — same principle as the JVM-era guidance, applied to dependency injection instead of a filter chain.

### JWT

Use **PyJWT** directly (HS256), not a heavier auth framework — `app/core/security.py`'s `encode_login_token`/`decode_token` and `app/oauth2/router.py`'s `_encode_oauth2_token` are the two encode sites; `app/core/auth_deps.py`'s `get_current_principal` is the single decode-and-resolve-principal site every route's auth dependency ultimately goes through. Note: the signing key is base64-decoded before use (`decode_base64_hmac_key`) — don't pass the raw configured secret string directly to `jwt.encode`/`jwt.decode` without that decode step, or signatures produced by one path won't verify against the other.

### Password Storage

Use **bcrypt** directly (`hash_password`/`verify_password` in `app/core/security.py`), not a Spring-Security-style `PasswordEncoder` abstraction — a thin, direct wrapper is enough here since there is exactly one hashing scheme in use, with no need to support verifying against multiple legacy encodings. Store hashes in a `String(72)`-equivalent column (bcrypt's output is a fixed-length string).

### Token Claims

The standard login token (`POST /api/auth/login`) carries `sub` (username), `permissions` (string array), `iat`, `exp` — in that exact claim order, no `iss`. OAuth2-issued tokens (`/oauth2/token`) instead carry `iss, sub, scopes, iat, exp[, aud]` — note the different claim name (`scopes`, plural, not `permissions`) and the presence of `iss`/optional `aud`. `get_current_principal` unifies both token shapes through one code path: it reads `permissions` first, falling back to `scopes` if absent, so a single dependency works for both login-issued and OAuth2-issued tokens without the route needing to know which kind it received. Parse/decode the token once per request in the dependency chain — don't call `decode_token` more than once for the same incoming request.

### The Full Hand-Rolled OAuth2 Authorization Server Is Preserved, Not Replaced

`app/oauth2/` implements dynamic client registration, `/oauth2/authorize` (PKCE-aware authorization-code issuance), `/oauth2/token` (all 3 grants: `authorization_code`, `refresh_token` with rotation, and the RFC 8693 token-exchange bridge mapping `mcp:read`/`mcp:edit` scopes to `READ`/`EDIT` permissions), and `/oauth2/introspect` — all preserved 1:1 from the original hand-rolled implementation, deliberately **not** replaced with a library like `authlib`, to avoid any wire-format drift a library's own conventions might introduce. If OAuth2 behavior ever needs to change, change it in `app/oauth2/` directly rather than migrating to a framework mid-stream.

**Known preserved gaps** (deliberate migration decisions, not oversights — do not "fix" without checking the migration's `work-log.md` first):
- `/oauth2/authorize`'s unauthenticated case returns a generic legacy 401 envelope, not an OAuth2-shaped `unauthorized_client` error, because the route is gated by a zero-arg `Depends(require_any())` that raises before the handler's own OAuth2-shaped validation step ever runs. The pure validation function still implements that step for fidelity/testability; it's just unreachable through the live route today.
- The authorization-code and refresh-token stores are in-memory and single-instance (no Postgres/Redis persistence) — restarting the process invalidates any in-flight authorization code or issued refresh token. Not suitable for a multi-instance deployment as-is.

### Test-Time Auth

There is no `@WithMockUser`-style annotation in this codebase (no automated test suite exists yet — see `project/tech-stack.md`). Manual verification during migration used live-uvicorn + a real seeded Postgres user, obtaining real tokens through `/api/auth/login`/`/oauth2/token` rather than mocking authentication. When a pytest suite is eventually added (`standards/testing/backend-testing.md`), prefer a real end-to-end token wherever practical, matching this same principle over mocking `get_current_principal`.

---

### History

This document previously described Spring Security conventions (`SecurityFilterChain`, `@PreAuthorize` avoidance, `BCryptPasswordEncoder`) for the Java/Spring Boot backend. The backend was migrated to Python/FastAPI (see `.maister/tasks/migrations/2026-08-31-java-to-python-fastapi/`); the content above describes the current FastAPI-dependency-based authorization actually implemented in `app/core/auth_deps.py`, `app/core/security.py`, and `app/oauth2/`.

*Last Updated*: 2026-09-01
