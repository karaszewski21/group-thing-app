# Codebase: in-house OAuth2 server and a Google-authenticated user

## TL;DR
- The in-house OAuth2 server (`app/oauth2`) authenticates the end user only through an existing aj login JWT (`Depends(require_any())` on `POST /oauth2/authorize`); it has no login form or password step of its own. Any user who holds an aj token — however obtained — can complete authorize/consent.
- Therefore a Google login needs **no change** to `app/oauth2` as long as it ends with the same aj login token stored in the frontend session: the consent page posts `_token` from `localStorage`, the code entry stores `principal.username` + permissions, and `/oauth2/token` mints `{iss, sub, scopes, iat, exp}` from that username.
- The only coupling is the redirect chain: a plugin/MCP client sends the user to `/oauth2/authorize`; an unauthenticated user goes to login and must come back to the same authorize URL after Google — the `next`/return URL must survive the Google round-trip (frontend concern).
- No tests exercise `/oauth2/*` endpoints today (`grep -rli oauth tests` → only matrix/groups/points helper tokens).

## Key Decisions
- Keep Google out of the OAuth2 server — aj is the authorization server for plugins/MCP; Google is just an upstream identity source for the first-party login. Mixing them (e.g. issuing OAuth2 codes from a Google callback) would duplicate consent and PKCE logic.
- Do not reuse the in-memory `authorization_code_store` for Google `state`/`nonce` — it is typed for aj client codes (`AuthorizationCodeEntry` with `client_id`, `username`, `permissions`) and is per-process memory; Google state should be bound to the browser (cookie or the GIS nonce) instead.

## Open Questions / Risks
- Stores are in-memory dicts (`app/oauth2/stores.py:1-11`): codes 600 s (`:25`), refresh tokens 24 h (`:97`), lost on restart, not shared across workers. If the Google server-side code flow kept its `state` in a similar per-process store, multi-worker or restart would break callbacks.
- Refresh/token-exchange grants re-issue tokens from the stored `username` without re-checking the user exists (`router.py:553-578`, `:581-643`) — unlinking a Google identity or deleting an account does not cut OAuth2 refresh chains for up to 24 h.
- `token_exchange` maps only `mcp:read`/`mcp:edit` → `READ`/`EDIT` (`router.py:420`, `:625-631`); unaffected by Google.

---

## 1. Endpoints (all in `src/backend/app/oauth2/`)

| Endpoint | Source | Matrix | Auth of end user |
|---|---|---|---|
| `GET /.well-known/oauth-authorization-server` | `metadata_router.py:70` | row 1 PUBLIC (`authorization_matrix.py:38`) | none |
| `GET /api/oauth2/client-info` | `metadata_router.py:98` | row 5 PUBLIC (`:42`) | none (consent page reads client name) |
| `POST /oauth2/register` (DCR) | `router.py:139` | row 2 PUBLIC (`:39`) | none |
| `GET /oauth2/authorize` | not a backend route — the Next.js consent page `src/frontend/src/features/auth/OAuth2AuthorizePage.tsx` | row 10 GET non-`/api/` PUBLIC (`:56`) | frontend reads token |
| `POST /oauth2/authorize` | `router.py:316-391` | falls to row 25 AUTHENTICATED (comment `:47-55`) | `Depends(require_any())` |
| `POST /oauth2/token` | `router.py:646-668` | row 3 PUBLIC (`:40`) | client auth / PKCE |
| `POST /oauth2/introspect` | `router.py:671` | row 4 PUBLIC (`:41`) | client auth |

Confidence: High (100%) — read directly.

## 2. How the end user is authenticated on authorize

**Source**: `src/backend/app/oauth2/router.py:316-391` — High

```python
@router.post("/oauth2/authorize", response_model=None)
async def authorize(request, principal: Annotated[Principal, Depends(require_any())], db):
    ...validate_authorize_request(..., authenticated=True)          # :350-361
    code = authorization_code_store.generate_code()
    stripped_permissions = tuple(sorted(a.removeprefix("PERMISSION_") for a in principal.authorities))
    entry = AuthorizationCodeEntry(client_id=..., redirect_uri=..., scope=scope or "",
        code_challenge=..., code_challenge_method=...,
        username=principal.username, permissions=stripped_permissions)   # :373-382
    await authorization_code_store.put(code, entry)
    return RedirectResponse(f"{redirect_uri}?code={code}&state={state}", 302)   # :385-391
```

- `principal` comes from `_extract_token` — for the native form POST that is the hidden `_token` field (`app/core/_auth/token.py:32-46`).
- **Frontend side**: `OAuth2AuthorizePage.tsx:28` reads `localStorage.getItem("auth_token")` and `:99-101` renders `<form method="POST" action="/oauth2/authorize">` with `<input type="hidden" name="_token" value={storedToken} />`. So the consent step works for any user whose aj token is in `localStorage` — exactly what the Google login must produce.
- `validate_authorize_request` (`router.py:203-267`) checks client, registered redirect URI, scopes, PKCE S256 for public clients; nothing identity-provider-specific.

## 3. Token issuance from the stored username

**Source**: `src/backend/app/oauth2/router.py:452-471` (`_encode_oauth2_token`) — High
Claims `iss, sub, scopes, iat, exp[, aud]`, 15 min (`_OAUTH2_TOKEN_EXPIRATION_MS = 900_000`, `:402`), same HS256 secret. `sub` = `entry.username` (`:537`, `:565`) = aj `users.username`.

- `authorization_code` grant: `router.py:491-550` — PKCE verify, issues access + rotating refresh token.
- `refresh_token` grant: `router.py:553-578` — consumes and rotates from `refresh_token_store`.
- token exchange (RFC 8693): `router.py:581-643` — decodes the aj subject token with `decode_token(subject_token, settings.jwt_secret)` (`:611`), so only aj-issued tokens are exchangeable. A Google ID token would be rejected (`invalid_grant`) — correct and desirable; Google tokens should never be accepted as `subject_token`.

`get_current_principal` reads `permissions` then `scopes` (`app/core/_auth/principal.py:56-58`), so OAuth2-issued and login tokens share one code path; Google adds no third token shape.

## 4. A Google-authenticated user passing through the OAuth2 flow

Sequence (no `app/oauth2` change needed):
1. MCP/plugin client → browser `GET /oauth2/authorize?client_id&redirect_uri&code_challenge&state` → Next.js consent page.
2. No aj token in `localStorage` → frontend sends the user to login with a return URL (frontend gatherer: `authPath`, proxy `PROTECTED_PREFIXES`, `POST /oauth2/authorize` rewrite in `src/proxy.ts`).
3. User picks Google → Google verification → backend `POST /api/auth/google` returns `{token}` (see `codebase-auth-login-jwt.md` §6) → frontend stores it via `auth/session.ts` (localStorage + cookie) and does a full reload to the preserved return URL (the authorize URL with its original query).
4. Consent page now has `storedToken` → form POST with `_token` → `POST /oauth2/authorize` → `principal.username` = Google-linked aj user → code → client → `POST /oauth2/token`.

Requirement on the Google step: the **return URL must be preserved across the Google round-trip** (with GIS popup/button it stays in the page; with a full-redirect code flow it must be carried in a server-validated `state` and checked against an open-redirect allowlist — same-origin relative paths only).

## 5. Client authentication helpers (for reference)

`src/backend/app/oauth2/client_auth.py:20`, `:76` — client secrets are bcrypt-hashed and checked with the same `verify_password`; `router.py:166` hashes DCR secrets with `hash_password`. Irrelevant to Google beyond showing `verify_password` is shared — a nullable user `password_hash` must not be passed to it.

## 6. Tests

- No HTTP tests of `/oauth2/register|authorize|token|introspect` found (`grep -rli oauth src/backend/tests` → `test_authorization_matrix.py`, `test_groups.py`, `test_points_config_api.py`, which only build `scopes`-shaped tokens, e.g. `_oauth_token` at `test_authorization_matrix.py:102-126`).
- A Google feature test worth adding: Google-created account's token → `POST /oauth2/authorize` with `_token` form field → 302 with `code` (proves the pass-through), using a test-registered public client.
