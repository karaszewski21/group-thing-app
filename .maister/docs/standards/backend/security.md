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

The matrix lives only in `app/core/authorization_matrix.py` (`AUTHORIZATION_MATRIX`). It is a reference table verified by tests (`resolve_requirement(method, path)` walks it, first match wins, and is used only in `tests/test_authorization_matrix.py`). Each route enforces its row through `Depends(require_any(...))`, or through no dependency for PUBLIC rows. FastAPI has no native path-pattern security filter chain, so nothing applies the table centrally at request time — the route's own dependency must match what the matrix says for that route. When adding a new route:

1. Add its row to `AUTHORIZATION_MATRIX` first (in the correct evaluation-order position — first-match-wins means row order is significant, not just row content)
2. Then declare the matching `Depends(require_any(...))` on the actual route (or no dependency for a PUBLIC row)
3. Add a `resolve_requirement` case to `tests/test_authorization_matrix.py`, plus regression cases for any existing row the new one is placed ahead of

Don't add a permission check directly on a route without also adding/updating its row in the matrix — the matrix is meant to stay the single readable reference for "what's protected and how," even though enforcement is distributed.

**Example — the `/api/public/` prefix.** Every anonymous-friendly read lives under `/api/public/...` (organizer and party pages, the circle page and `/access`, events, item `/details` and `/actions`), so a single `GET ^/api/public/.*$` PUBLIC row, placed right after the non-`/api/` row, covers them all; a new public read needs no new row, only the prefix. Mutations never go under `/public/` (RSVP is `POST /api/groups/{id}/rsvp`, redeeming a join code `POST /api/groups/{id}/join-code/redeem` with its own AUTHENTICATED row ahead of the blanket groups POST row). Tests assert the prefix row, that removing it sends these reads to the catch-all, and that the old public paths no longer resolve to PUBLIC.

### Public Routes Need No Dependency At All

Rows resolving to `"PUBLIC"` need no `Depends(...)` — that's simply the FastAPI/Starlette default for a route with no auth dependency declared. Only rows resolving to `"AUTHENTICATED"` or a permission tuple need an explicit `require_any(...)`.

### Row-Order Ambiguity: Resolve Toward the More Specific Rule, Document It

Matrix rows are evaluated in order, first match wins — a row stated informally (e.g. "any method") can accidentally swallow a more specific, later row if read too literally. When a matrix row's method scope is ambiguous against explicit prose elsewhere describing one specific route's behavior, the specific prose wins and the row is scoped down to avoid the conflict — documented inline at the row, not resolved silently. (Precedent: `AUTHORIZATION_MATRIX` row 10, the public rule for browser navigation to non-`/api/` paths, which now end in the JSON 404 catch-all because the Next.js frontend serves the pages, is scoped to `GET` only, specifically so it doesn't swallow `/oauth2/authorize` — a `POST`, non-`/api/` path that a separate note establishes is NOT public — before that request ever reaches the catch-all `AUTHENTICATED` row.)

### Personalised Public Responses Never Hit Shared Caches
Public GET routes that personalise on `OptionalPrincipal` call `app.core.cache_headers.set_personalised_cache_headers(response, principal)` after the service call succeeds (never on errors). A resolved principal gets `Cache-Control: private, no-store`; an anonymous request or an invalid token gets `public, max-age=0, s-maxage=60`; `Vary: Authorization, Cookie` is always set, because the principal can also come from the `auth_token` cookie (see below). Never send shared-cache headers for an authenticated response. Current users: `/api/public/items/{id}/actions`, `/api/public/items/{id}/details`, `/api/events/{id}`, `/api/public/groups/{id}/access` and the organization layout and owner-items routes (`/organizations/{slug}/layout/{layout}`, `/organizers/{slug}/items`, `/parties/{id}/items`); `…/organizations/{slug}/groups/{group_id}/terms` and the owner meetings routes (`…/organizers/{slug}/meetings`, `/parties/{id}/meetings`) do not personalise and keep the plain public header.
```python
result = await service.get_actions(db, item_id, principal)
set_personalised_cache_headers(response, principal)
```

### Token Sources: Cookie on GET/HEAD Only
`_extract_token` (`app/core/_auth/token.py`) reads the token in this order: `Authorization: Bearer <token>`; a `_token` form/query param (the OAuth2 authorize form POST); then, **on GET and HEAD only**, the `auth_token` cookie (`AUTH_COOKIE_NAME`) that the frontend writes next to localStorage for server-rendered pages. The cookie is JS-readable and `SameSite=Lax`, and browsers send it cross-site too, so it must never authenticate a state-changing method: keep `_COOKIE_METHODS` to GET/HEAD, keep GET routes free of side effects, and keep mutations and plugins on the Bearer header. Any route that personalises a GET on the principal sends `Vary: Authorization, Cookie` through `set_personalised_cache_headers`. The Next.js server never forwards the cookie to the backend (its own reads are anonymous).
```python
if request.method in _COOKIE_METHODS:
    return request.cookies.get(AUTH_COOKIE_NAME) or None
```

### Auth-Flow Cookies: HttpOnly, Purpose-Keyed, Narrow Path, Set by a JSON POST
The backend sets one cookie of its own, `aj_google_nonce` (Google sign-in, `app/auth/google.py`); a future auth-flow cookie follows the same rules:
- `HttpOnly`, `SameSite=Lax`, a narrow `Path` (`/api/auth/google`), a short `Max-Age` (600 s), and `Secure` from a setting (`AUTH_COOKIE_SECURE`, default `true`, `false` only over http), never derived from request headers
- the value is a compact HS256 JWT with its own `aud` (`aj:google-nonce`), signed with a purpose key derived from `JWT_SECRET` (`HMAC-SHA256(key, "aj google-nonce cookie v1")`), so a login token never passes as the cookie or the other way round; reuse PyJWT, no new crypto code
- set only by a PUBLIC POST that requires a JSON body (`POST /api/auth/google/nonce` takes `{}` with `extra="forbid"`), so a cross-site form or `text/plain` post cannot overwrite it without a CORS preflight; responses carrying it send `Cache-Control: no-store`
- cleared with `delete_cookie` repeating the same `Path`, `Secure`, `HttpOnly` and `SameSite` (helpers `set_nonce_cookie`/`clear_nonce_cookie` share one attribute set)
- such routes are auth-flow routes, not data reads: matrix rows 72 (`POST ^/api/auth/google/nonce$`) and 73 (`POST ^/api/auth/google$`) are PUBLIC POSTs outside `/api/public/`, commented as such at the rows, with no route dependency, so a stored Bearer token is not evaluated and they never answer 401. The `/api/public/` rule (anonymous reads) and the GET-side-effect rule above are unchanged: no GET sets a cookie
```python
set_nonce_cookie(response, encode_nonce_cookie(nonce))   # nonce route
clear_nonce_cookie(response)                               # every outcome the sign-in route builds
```

### Further PUBLIC POST Exceptions: E-mail Account Flows and Provider Callbacks
Rows 74–79 and 82 follow the reasoning of rows 72/73: PUBLIC POSTs outside `/api/public/`, each commented at its row in `AUTHORIZATION_MATRIX`, with no route dependency, so a stored Bearer token is not evaluated and they never answer 401 (an `api/client.ts` 401 would log the user out of a page opened from a mail).
- **Auth flows** (after row 73, exact order 73, 74, 75, 76, 82, 77, pinned by the ordering test): 74 `POST ^/api/auth/password-reset$`, 75 `…/password-reset/confirm$`, 76 `…/email-verification/confirm$`, 82 `…/account-tokens/lookup$`. Each takes an address or a single-use token from someone who cannot log in, answers without revealing whether an account exists (the reset request is always 202, also when silenced by the rate limit), and returns no stored data beyond the token's own address. Row 77 (`POST ^/api/auth/email-verification$`, the resend) is `("EDIT",)`, login only.
- **Provider and link callbacks** (after row 69): 78 `GET`/`POST ^/api/email/unsubscribe/[^/]+$` is authorised by the HMAC-signed token in its path (RFC 8058 one-click, so the POST must accept a form or empty body from a mail client; the GET, for a client that opens the `List-Unsubscribe` URL, is side-effect free and only answers 303 to the `/unsubscribe?token=` page, keeping the GET-side-effect rule), 79 `POST ^/api/email/webhooks/mailgun$` by the provider's signature. Rows 80/81 (`GET`/`PUT ^/api/email/preferences$`) stay `READ`/`EDIT`, login only (no `mcp:*`).
- Token-flow errors are 404 (unknown), 410 (expired or used) or 503 (email off) from a route-local `status → (error, Polish message)` map like `_GOOGLE_ERRORS`, never 401; every response sets `Cache-Control: no-store`. The frontend token pages (`/verify-email`, `/reset-password`, `/unsubscribe`) set `referrer: "no-referrer"` and `noindex` metadata, so the `?token=` never leaves through the `Referer` header, and sit outside `PROTECTED_PREFIXES`.
- **Never log a token-bearing URL.** Tokens travel in query strings (`?token=`) and in the unsubscribe path, so the nginx access log uses the `token_safe` format (`$request_method $loggable_uri`: `$uri` without the query, a `map` masking `/api/email/unsubscribe/<token>`, no `$http_referer`; `src/frontend/nginx.conf`) and the uvicorn access log is filtered by `app/core/access_log.py` (installed on `uvicorn.access` in the lifespan: masks `/api/email/unsubscribe/<token>` and the `token=`/`_token=` query values). A new token route keeps its token out of the logged URL or extends both redactions.
- These PUBLIC routes are rate-limited in nginx (zone `auth_flows`, 10 r/min per address, burst 5, the 429 JSON envelope); the Mailgun webhook is not, since the provider's retries must get through.

### Single-Use Account Tokens
`app/auth/account_tokens.py`: `secrets.token_urlsafe(32)`, and only the SHA-256 hex hash is stored (`account_tokens.token_hash`, unique) with a normalised address snapshot, a purpose and a short expiry (verification 48 h, reset 1 h). The raw token exists only in the mailed link and in the queued mail's payload until that row reaches a final state. Issuing marks the user's earlier unused tokens of the purpose used; requests are rate-limited per user and purpose on the table itself. A confirm **claims atomically** in one statement — `UPDATE account_tokens SET used_at = now, updated_at = now WHERE token_hash = :h AND purpose = :p AND used_at IS NULL AND expires_at > now RETURNING …` — and runs every side effect in the same transaction, so of two concurrent confirms exactly one wins and the other gets 410; never read-then-update. A follow-up read only splits 404 from 410. The lookup route is a plain read and never claims. A confirm whose snapshot no longer equals the profile email is 410 and rolls back.

### Provider Webhooks: HMAC, Replay Memory After Commit
`POST /api/email/webhooks/mailgun` (`app/email/webhooks.py`) verifies `HMAC-SHA256(EMAIL_WEBHOOK_SIGNING_KEY, timestamp + token)` with `hmac.compare_digest`, rejects a timestamp more than 5 min from now and a token already seen in the in-process replay memory (5 min, bounded; one backend instance assumed). Every rejection — bad signature, stale, replay, key not configured — is the same 401 with no detail plus one INFO `email webhook rejected: reason=<code>`. Parse the body defensively (a body above 64 KiB is a 400 before JSON parsing; a non-UUID message id counts as absent; unparseable JSON 400). Apply the event with Core statements in one transaction (no ORM version check to turn a race with the send job into a `StaleDataError`) and **record the replay token only after the commit**: a conflict (`40P01`/`40001`, one WARNING) or any other failure (`logger.exception`) answers 503 with no detail and leaves the token unrecorded, so the provider's retry with the same token is processed. Unknown messages answer 200. The same applies to the unsubscribe token (`app/email/links.py`): HMAC-SHA256 under `EMAIL_LINK_SIGNING_SECRET` over a canonicalised payload, compared with `compare_digest`, a bad token 404; the party id must be the canonical lowercase hyphenated UUID spelling, so one party has exactly one valid token per category. Never log a recipient address, a token, a subject or a body; `last_error` holds a code only.

### Third-Party ID Tokens (Google)
Verify locally, never through a tokeninfo call: `GoogleTokenVerifier` (`app/auth/google.py`) checks RS256 only against Google's JWKS (cached per instance for 1 h, an unknown `kid` forcing one refresh at most every 60 s), `iss` in {`accounts.google.com`, `https://accounts.google.com`}, `aud` and a present `azp` equal to `GOOGLE_CLIENT_ID`, the required `iss`/`aud`/`sub`/`exp`/`iat`/`nonce`, 30 s leeway, and the `nonce` claim (a `str`) against the cookie's with `hmac.compare_digest`. `email_verified` counts only when it `is True`. Every failure is the same generic 401 with a reason code in one INFO line; a JWKS outage is a 503. Never log or store the credential, the cookie, the nonce or the email; persist only the `sub` (in `user_identities`) and an email snapshot. **No auto-linking by email**: an unlinked Google identity whose email is already registered (case-insensitive) gets a 409, never a login, and an unverified email gets a 403. The issued session is the ordinary login token, with permissions read from the DB.

### Error Responses for Auth Failures

Custom exception handlers replicate the legacy flat-envelope 401/403 shape (`{"status": ..., "error": ..., "message": ...}`), registered globally via `app.add_exception_handler(...)` in `app/main.py` — analogous to Spring's `AuthenticationEntryPoint`/`AccessDeniedHandler`, but as FastAPI exception handlers rather than filter-chain hooks. `AuthenticationRequiredException` (401, "Authentication required") is raised by `require_any`'s own dependency function before any route body runs; `AccessDeniedException` (403) is raised the same way for an authenticated-but-under-permissioned caller. Both fire before the route handler executes, so a route's own body never needs to check permissions itself — same principle as the JVM-era guidance, applied to dependency injection instead of a filter chain.

### JWT

Use **PyJWT** directly (HS256), not a heavier auth framework — `app/core/security.py`'s `encode_login_token`/`decode_token` and `app/oauth2/router.py`'s `_encode_oauth2_token` are the two encode sites; `app/core/auth_deps.py`'s `get_current_principal` is the single decode-and-resolve-principal site every route's auth dependency ultimately goes through. Note: the signing key is base64-decoded before use (`decode_base64_hmac_key`) — don't pass the raw configured secret string directly to `jwt.encode`/`jwt.decode` without that decode step, or signatures produced by one path won't verify against the other.

### Password Storage

Use **bcrypt** directly (`hash_password`/`verify_password` in `app/core/security.py`), not a Spring-Security-style `PasswordEncoder` abstraction — a thin, direct wrapper is enough here since there is exactly one hashing scheme in use, with no need to support verifying against multiple legacy encodings. Store hashes in a `String(72)`-equivalent column (bcrypt's output is a fixed-length string). `users.password_hash` is nullable since migration 0108 (accounts created through Google): password login answers the ordinary 401 for a NULL hash in `app/auth/router.py`, while `verify_password` stays strict because the OAuth2 client-secret checks also call it. Bound every new password at **72 UTF-8 bytes** (bcrypt's input limit; bcrypt 5 raises above it) with the Polish 400 „Hasło może mieć najwyżej 72 bajty.” in `fieldErrors.password` (registration, reset confirm, login and family login creation do, through the shared helper in `app/core/security.py`). Hash off the event loop (`asyncio.to_thread`) and, in token flows, only after the token claim, so an unknown token never costs a hash.

### Spending Points Needs a Login Token
POINTS take and confirm call `require_login_principal(principal)` (`app/groups/application/term_item_listings.py`), which requires the login `EDIT` authority (`PERMISSION_EDIT`): an `mcp:edit`-only OAuth2 token passes the route's `require_any("EDIT", "mcp:edit")` but gets 403 in the use case, before any read or write. The check lives in the use case because the take and confirm routes do not name the reservation type, so no matrix row can carve POINTS out; cancel and listing stay open to `mcp:edit`, since neither spends points. Known gap: the RFC 8693 bridge token maps `mcp:edit` to `EDIT` and therefore passes.

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

*Last Updated*: 2026-11-25
