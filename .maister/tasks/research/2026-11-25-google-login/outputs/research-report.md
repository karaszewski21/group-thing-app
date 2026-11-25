# Research Report: Login and registration with a Google account in aj

**Research type**: Mixed (technical codebase analysis + literature/official docs) · **Date**: 2026-11-25 · **Researcher**: maister research-synthesizer
**Inputs**: 11 finding files in `analysis/findings/`, `planning/research-brief.md`, `planning/research-plan.md`; synthesis in `analysis/synthesis.md`

## TL;DR
Google sign-in should be added as a new identity source that ends in aj's existing login path. The backend verifies a Google ID token with PyJWT + `cryptography`, resolves the user through a new `user_identities` table (keyed on provider + `sub`), and returns the usual `{token}` from `encode_login_token`. The frontend stores it with `applyToken` → `setSession`, and the existing `AuthGuard` reload takes over from there. No changes are needed in `app/oauth2`, `session.ts` or the proxy. Two migrations are needed: 0107 adds `user_identities`, and 0108 makes `password_hash` nullable with a guarded downgrade. Email-based auto-linking is refused, because aj never verifies emails. The recommended browser flow is **A: a GIS popup posting the ID token**, because it keeps the in-page `AuthSheet` login. **B: a server-side OIDC code flow** is the documented alternative.

## Key Decisions
- Reuse `encode_login_token` and JSON token delivery. Every consumer (session, cookie, consent `_token`, plugin SDK) keys off `token`, and the backend has never set cookies.
- Use a separate, provider-generic `user_identities` table, with unique `(provider, subject)`. Per OIDC Core §5.7, `sub` is the only stable key. It also leaves room for Facebook later.
- Never link by email automatically. Password sign-up never verifies email, so merging is the classic-federated-merge pre-hijack, and stateless JWTs can't be revoked to contain it.
- The dependency is `pyjwt[crypto]`, not google-auth or Authlib. PyJWT is already the JWT library, `cryptography` is absent from `uv.lock` and RS256 needs it, and the alternatives add more packages or a session middleware.
- Read permissions from the DB (`_load_permissions`), not from register's hard-coded `["READ","EDIT"]`. Otherwise admins signing in with Google lose ADMIN.
- Recommend flow A (GIS popup + server-issued nonce) over B (code flow). This is a recommendation, not a decision: A keeps `AuthSheet` in-page and needs no secret, while B keeps the custom button, loads no third-party script and is provider-generic.

## Open Questions / Risks
- **Owner decision**: flow A or B (§7.2). Also whether the custom pill button is a hard requirement. If it is, choose B.
- **Production prerequisites outside the code**: the public domain, a privacy policy and a homepage on a verified domain (needed for Google brand verification). None of these exist in the repo yet.
- **No session revocation**: unlinking, deletion or a Google `sessions-revoked` event cannot end a live JWT before `exp` (default 1 h). This is an accepted MVP risk.
- **No password reset**: a Google-only user who loses their Google account cannot recover the aj account.
- **Role at sign-up**: GUEST or ORGANIZER is chosen in `RegisterForm`, but the Google button sits above both tabs. The proposal is an optional `role` (default GUEST) that is honoured only when an account is created.
- **Untested UX**: the GIS iframe button inside the focus-trapped `AuthSheet`, and popup blocking in in-app browsers (flow A).

---

## Table of Contents
1. Executive Summary
2. Research Objectives
3. Methodology
4. Findings
5. Recommended Flow and Request Sequences
6. Data Model Changes and Migration Notes
7. Analysis and Insights (trade-offs, linking policy, SWOT)
8. Security Checklist
9. Config and Deploy Checklist (incl. redirect-URI matrix)
10. Test Strategy (no network calls to Google)
11. Dependency Decision
12. Conclusions
13. Recommendations
14. Appendices (sources, gaps, raw data)

---

## 1. Executive Summary
**What was researched**: how aj should implement "Zaloguj się przez Google" end to end, covering the FastAPI backend, the Next.js frontend, the data model, security and the deploy configuration.

**How**: five parallel gatherers traced the current login, registration, JWT, OAuth2-server, session, proxy and data-model code with file:line evidence, and compared Google's official OIDC/GIS documentation, OIDC Core, RFC 9700/7636, OWASP and the USENIX 2022 pre-hijacking study. One open fact (`cryptography` in `uv.lock`) was re-verified during synthesis.

**Key findings**:
- aj's session is one HS256 JWT `{sub: users.username, permissions, iat, exp}` (`app/core/security.py:39-55`), returned as JSON by login and register. The frontend is its only writer (`auth/session.ts:1-5`).
- Nothing downstream depends on how the token was obtained. The in-house OAuth2 server, the consent page, the plugin SDK and the `auth_token` cookie all accept any aj JWT, so Google login needs no OAuth2 or session changes.
- The only schema obstacles are the NOT NULL `password_hash` and the missing identity table. No password change, reset, verification or deletion code exists that would need adapting.
- Emails are never verified at registration, so email-based account linking is unsafe.
- `/api/*` is same-origin in all three environments and bypasses the Next proxy, so backend routes need no nginx or Next changes.
- There is no CSP today, so GIS's script needs no header change. If a CSP is added later, it must list `accounts.google.com/gsi/*`.

**Main conclusions**: build one verifier and one sign-in resolver on the backend, add two migrations, refuse email collisions with a Polish 409, and choose the browser flow (recommended: GIS popup) on UX grounds.

## 2. Research Objectives
**Primary question**: How should aj implement login and registration with a Google account end to end, consistently with the existing auth architecture and project standards?

**Sub-questions** (brief §Sub-questions): (1) current auth; (2) interaction with the in-house OAuth2 server; (3) data model; (4) Google options and libraries; (5) account linking and takeover; (6) frontend and routing; (7) config and deploy; (8) legal and UX.

**Scope**: included are the backend flow, data model and migrations, frontend button and callback, security, config and deploy, and tests. Excluded are the implementation itself, Facebook/Apple beyond a provider-generic note, and non-identity Google APIs.

## 3. Methodology
- **Type**: mixed, combining code-flow tracing, an external docs comparison, a trade-off matrix and verification against file:line or official URL.
- **Data sources**: 11 finding files. The codebase evidence spans roughly 50 files across `src/backend/app/{auth,users,party,media,oauth2,core,config.py}`, Alembic 0001/0011/0015/0016/0082/0106, `src/frontend/src/{auth,features/auth,lib,routing,proxy.ts,app}`, `docker-compose.yml`, `nginx.conf`, `next.config.ts`, both Dockerfiles, `pyproject.toml`/`uv.lock`, `.env.example` (keys only), and the standards in `.maister/docs/standards/`. The external evidence is about 25 official URLs (Google Identity, the discovery document, OIDC Core, RFC 9700, RFC 7636, OWASP, PyJWT, google-auth, Authlib, USENIX/MSRC, Meta).
- **Framework**: technical (component, flow and integration mapping), literature (pattern comparison, trade-offs, applicability), gap analysis and risk assessment.
- **Secrets**: no `.env` was read. Presence checks only.

## 4. Findings

### F1. One login JWT, one frontend writer
**Category**: current auth · **Confidence**: High
`encode_login_token(username, permissions, secret, expiration_ms)` builds `{sub, permissions, iat, exp}` HS256 over the base64-decoded `JWT_SECRET` (`app/core/security.py:39-55`). `POST /api/auth/login` returns `{"token"}` (`app/auth/router.py:57-87`), and `POST /api/auth/register` returns `{"token","party_id","role"}` with 201 (`app/users/router.py:41-51`). The frontend writes localStorage and the `auth_token` cookie (`SameSite=Lax; Path=/; Max-Age` from `exp`) only through `setSession` (`auth/session.ts:1-5,63-74`). The backend never calls `set_cookie`.
**Implication**: a Google endpoint must return the same JSON shape, and the frontend must store it via `applyToken`.

### F2. Identity is username-based, with permissions from the DB on login
**Category**: current auth · **Confidence**: High
`Principal.username = claims["sub"]` (`app/core/_auth/principal.py:52`). Around 20 call sites resolve `User.username == principal.username` (`users/service.py:86,104`, `inventory/application/identity.py:21`, `moderation/service.py:316`, ...). Login reads permissions from `user_permissions` (`auth/router.py:50-54,83`), while register hard-codes `["READ","EDIT"]` (`users/router.py:48-50`).
**Implication**: Google accounts get a normal `users.username` (derived by `derive_username_from_email`), and the Google path uses `_load_permissions`.

### F3. The in-house OAuth2 server is unaffected
**Category**: OAuth2 interaction · **Confidence**: High
`POST /oauth2/authorize` authenticates with `Depends(require_any())` and stores `principal.username` + permissions in the code entry (`app/oauth2/router.py:316-391`). The consent page posts `_token` from localStorage (`OAuth2AuthorizePage.tsx:28,99-101`). Token exchange accepts only aj-signed subject tokens (`router.py:611`), so Google tokens are correctly rejected. A guest is sent to `/login?returnTo=/oauth2/authorize?<7 params>` (`proxy.ts:46-48`, `routing/paths.ts:158`).
**Implication**: no `app/oauth2` change is needed. The Google step must preserve a long `returnTo`.

### F4. A password is assumed in only a few places
**Category**: data model · **Confidence**: High
`users.password_hash String(72) NOT NULL` (`app/auth/models.py:50`). `create_account` always hashes (`users/service.py:46-47`), and login calls `verify_password`, where `bcrypt.checkpw(None…)` raises and returns a 500 (`auth/router.py:70`, `core/security.py:23-25`). Family/guardian account creation passes passwords and is unaffected (`families/bootstrap.py:58`, `families/guardians.py:32`). There is no password change, reset, email verification or account deletion (grep of `app/`).
**Implication**: making the hash nullable is safe, provided login short-circuits on NULL with the same 401.

### F5. Emails are never verified; sign-up races are unhandled
**Category**: data model / security · **Confidence**: High
Registration checks duplicates in the app (`service.py:279-283`) and relies on `uq_user_profiles_email_lower` (`0016:32-40`). Nothing records email ownership. A concurrent duplicate becomes an IntegrityError, which most likely surfaces as a 500.
**Implication**: auto-linking by email is unsafe. Map IntegrityErrors to 409.

### F6. Google's verification rules
**Category**: external · **Confidence**: High
The ID token is RS256, signed with keys from `https://www.googleapis.com/oauth2/v3/certs`. `iss` must be `accounts.google.com` or `https://accounts.google.com`. `aud` must equal the client ID, `exp` must be in the future, and the nonce must be checked if one was sent. `hd` only matters for domain restriction. Use `sub`, never email, as the key. Email is authoritative only for `@gmail.com`, or for `email_verified` + `hd`. Verify locally, not via `tokeninfo`. Sources: developers.google.com/identity/gsi/web/guides/verify-google-id-token, /identity/openid-connect/openid-connect, OIDC Core §3.1.3.7 and §5.7, the live discovery document (2026-11-25).

### F7. Two integration patterns
**Category**: external · **Confidence**: High
(a) Server code flow: authorize at `accounts.google.com/o/oauth2/v2/auth`, exchange at `oauth2.googleapis.com/token` (client secret), with `state` + `nonce` + PKCE S256 (RFC 9700 §2.1.1 RECOMMENDS PKCE for confidential clients). (b) GIS: a Google-rendered button or One Tap; popup mode delivers the ID token to a JS callback, while redirect mode POSTs it to `login_uri` with `g_csrf_token`. One Tap now runs on FedCM, and the button uses FedCM only on opt-in. The implicit flow must not be used (RFC 9700 §2.1.2).

### F8. Pre-account-hijacking
**Category**: security / literature · **Confidence**: High
In the classic–federated merge (Sudhodanan & Paverd, USENIX Security 2022, where 35 of 75 services were vulnerable), an attacker pre-registers the victim's email with a password, and the victim's later Google login is merged into that account. The defence is to verify email before merging, or to invalidate the password and all sessions on merge. aj can do neither today (F5, F1: no revocation).

### F9. Frontend hosts and the in-page login
**Category**: frontend · **Confidence**: High
`SocialAuthButtons` is a mock (`features/auth/SocialAuthButtons.tsx:31-58`) rendered once in `AuthTabs.tsx:59`. That puts it on `/login` and in `AuthSheet`, which serves six public surfaces (`SignUpFooter`, `ItemPage`, `ItemChatButton`, `ItemPickupActions`, `TermNeededItems`, `PrivateTermView`). `AuthSheet` logs the user in "without leaving the page" (`AuthSheet.tsx:9-32`). After `applyToken`, `/login`'s `AuthGuard requireAuth={false}` does a full reload to `isSafeReturnPath(returnTo)` or `homePath` (`AuthGuard.tsx:37-41`, `utils/url.ts:16-24`).

### F10. Script loader precedent and SSR safety
**Category**: frontend · **Confidence**: High
`lib/googleMaps.ts` loads lazily with memoization, a 10 s timeout, a single `<script id>`, and returns `null` without `NEXT_PUBLIC_*` (`:53-166`). Browser globals are not allowed during render (`components.md`, `ssrSafety.test.tsx`).

### F11. Routing, origins and base URL
**Category**: config/deploy · **Confidence**: High
`/api/*` goes to the backend through the Next rewrite in dev :5173 (`next.config.ts:8`) and through nginx at :5174 (`nginx.conf:37-41`), and the proxy matcher skips it (`proxy.ts:68-71`). nginx forwards `Host $host` without the port, and uvicorn runs without `--proxy-headers`, so `resolve_base_url` yields `http://localhost` at :5174 (`metadata_router.py:45-62`). Redirect URIs therefore need an explicit `PUBLIC_BASE_URL`.

### F12. Settings and env pattern
**Category**: config/deploy · **Confidence**: High
`Settings` (`app/config.py:19-75`) has optional integrations as `str | None` with an "all set" property (`photo_storage_configured`). Compose interpolates the root `.env` into `backend.environment` (`docker-compose.yml:31-45`). The only frontend build arg is `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (compose `:74-75`, Dockerfile `:22-25`). There is no CSP, COOP or security header anywhere.

### F13. Dependencies
**Category**: dependency · **Confidence**: High (re-verified)
`pyjwt` 2.13.0 and `httpx` 0.28.1 are locked. `grep -i cryptography src/backend/uv.lock` finds nothing, so `PyJWKClient` and RS256 need `pyjwt[crypto]`. The frontend needs no npm package: GIS is a script tag.

### F14. Consent screen and branding
**Category**: legal/UX · **Confidence**: High (85-90%)
With only `openid email profile`, no app verification is required and Testing status works for any user (with conflicting docs on whether a warning shows). Showing aj's name and logo requires brand verification: a homepage on a verified domain that describes the app and links a privacy policy covering Google user data. The branding guidelines prefer the SDK button. A custom one must use the standard "G", Google Sans Medium 14/20 and a CTA like "Kontynuuj z Google", and be at least as prominent as the other providers.

### F15. Facebook (provider-generic note)
**Category**: external · **Confidence**: Medium (70%)
Facebook offers an OIDC code flow with PKCE (still "in testing") and a classic access-token flow. User IDs are app-scoped and `email` may be missing. The `(provider, subject)` table with a nullable email fits. Facebook email is never authoritative, and it would need its own callback path (mix-up defence, RFC 9700 §4.4).

### Summary table
| # | Finding | Category | Confidence | Sources |
|---|---|---|---|---|
| F1 | One JWT, frontend single writer | current auth | High | 4 |
| F2 | Username identity, DB permissions | current auth | High | 3 |
| F3 | OAuth2 server unaffected | OAuth2 | High | 3 |
| F4 | Few password assumptions | data model | High | 2 |
| F5 | No email verification, unhandled races | data model/security | High | 3 |
| F6 | Google ID-token rules | external | High | 4 |
| F7 | Code flow vs GIS | external | High | 5 |
| F8 | Pre-account hijack | security | High | 3 |
| F9 | AuthSheet in-page login | frontend | High | 2 |
| F10 | Loader pattern, SSR safety | frontend | High | 2 |
| F11 | Same-origin `/api`, base-URL bug | config | High | 3 |
| F12 | Settings/env pattern, no CSP | config | High | 3 |
| F13 | `pyjwt[crypto]` needed | dependency | High | 3 |
| F14 | Consent screen, branding | legal/UX | High | 4 |
| F15 | Facebook note | external | Medium | 4 |

## 5. Recommended Flow and Request Sequences

Both options share the backend core.

**Shared backend core (new)**
- `app/auth/google.py`: `verify_google_id_token(token, *, expected_nonce) -> GoogleClaims`. It uses a module-level `jwt.PyJWKClient("https://www.googleapis.com/oauth2/v3/certs", lifespan=3600)` called through `run_in_threadpool`, and `jwt.decode(token, key, algorithms=["RS256"], audience=settings.google_client_id, issuer=("https://accounts.google.com","accounts.google.com"), options={"require": ["iss","aud","sub","exp","iat"]}, leeway=30)`. It then compares the nonce with `hmac.compare_digest`, checks `azp` when present, and returns `(sub, email, email_verified, name, picture)`. The verifier is exposed as a FastAPI dependency (`get_google_verifier`) so tests can override it.
- `app/auth/google_service.py`: `resolve_google_sign_in(db, claims, role) -> (User, created, party_id)` implements the linking matrix (§7.3). It uses a new shared `app/users/service.py::bootstrap_person_account(db, *, email, password: str | None, display_name, role)` extracted from `register()`, and inserts the `UserIdentity` in the same transaction before the commit. IntegrityErrors on `uq_user_identities_provider_subject` or `uq_user_profiles_email_lower` become a rollback plus one re-read, or a 409.
- The token comes from `_load_permissions(db, user.id)` (moved to `app/auth/service.py` or imported) and then `encode_login_token(user.username, permissions, settings.jwt_secret, settings.jwt_expiration_ms)`.
- The response is `GoogleLoginResponse {token, created: bool, party_id: UUID | None, role: "GUEST"|"ORGANIZER" | None}`, with 200 for an existing account and 201 when one is created. It is a superset of `LoginResponse` and `RegisterResponse`.
- Errors use the `ErrorResponse` envelope with Polish messages: 401 for an invalid or expired credential ("Logowanie przez Google nie powiodło się, spróbuj ponownie"), 403 for `email_verified=false`, and 409 for an email that belongs to an existing account ("Konto z tym adresem już istnieje — zaloguj się hasłem").
- Login change: `app/auth/router.py:70` becomes `if user is None or user.password_hash is None or not verify_password(...)`, returning the same 401.

### 5.1 Option A (recommended): GIS popup → POST ID token

```
1. Browser renders SocialAuthButtons (on /login or in AuthSheet)
   - features/auth/SocialAuthButtons.tsx: hidden when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset
2. useEffect → GET /api/auth/google/nonce
   - backend app/auth/google.py: generates 32-byte random nonce, Set-Cookie
     g_nonce=<HMAC-signed nonce|issued_at>; HttpOnly; SameSite=Lax; Path=/api/auth/google;
     Max-Age=600; Secure when https → returns {nonce}
3. lib/googleIdentity.ts (googleMaps.ts pattern) loads https://accounts.google.com/gsi/client lazily;
   google.accounts.id.initialize({client_id, nonce, callback, ux_mode:"popup", context:"signin"});
   google.accounts.id.renderButton(container, {locale:"pl", text:"continue_with", ...})
4. User clicks → Google popup (accounts.google.com) → callback({credential})
5. AuthContext.loginWithGoogle(credential, role?) → fetch POST /api/auth/google
   Content-Type: application/json  body {credential, role?}   (cookie g_nonce sent, same origin)
6. backend: require JSON content type; read + verify g_nonce cookie signature/age; clear it
   → verify_google_id_token(credential, expected_nonce) → resolve_google_sign_in → token
   → 200/201 {token, created, party_id?, role?}
7. AuthContext.applyToken(token) → setSession (localStorage + auth_token cookie) → showToken
   → refreshDisplayName; on /login: AuthGuard requireAuth={false} → <Navigate reload> to
   isSafeReturnPath(returnTo) || homePath(permissions); in AuthSheet: sheet closes in place
8. (if returnTo = /oauth2/authorize?…) consent page posts _token → app/oauth2 unchanged
9. (optional, created only) background best-effort avatar import (§6.4)
```

Frontend pieces: `lib/googleIdentity.ts` (new loader, `isGoogleLoginConfigured()` reading `process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID` on each call), `SocialAuthButtons.tsx` (Google wired, with the GIS button mounted in an effect; Facebook stays "wkrótce"), and `AuthContext.tsx` (+`loginWithGoogle`, raw `fetch` like `login`/`register`, `Error(body.message)` on failure, shown in a `role="alert"` line). `created && role === "ORGANIZER"` triggers the same onboarding as register. There is no new route, reserved slug or proxy change.

### 5.2 Option B (alternative): server-side OIDC code flow with a handoff cookie

```
1. Button (custom pill, branding-compliant) → window.location.assign(
     "/api/auth/google/start?returnTo=<pathname+search>&role=GUEST|ORGANIZER")
2. backend GET /api/auth/google/start: validate returnTo (same rules as isSafeReturnPath);
   generate state, nonce, PKCE verifier; Set-Cookie g_tx=<signed {state,nonce,verifier,returnTo,role,iat}>;
   HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600; Secure per PUBLIC_BASE_URL scheme
   → 302 accounts.google.com/o/oauth2/v2/auth?client_id&response_type=code&scope=openid email profile
     &redirect_uri=<PUBLIC_BASE_URL>/api/auth/google/callback&state&nonce&code_challenge&code_challenge_method=S256
3. Google → 302 <PUBLIC_BASE_URL>/api/auth/google/callback?code&state   (nginx / Next rewrite → backend)
4. backend callback: verify g_tx signature/age, state == cookie (compare_digest), clear g_tx;
   httpx POST oauth2.googleapis.com/token {code, client_id, client_secret, redirect_uri, grant_type,
   code_verifier} (timeout ~10 s) → id_token → verify_google_id_token(id_token, nonce)
   → resolve_google_sign_in → aj token → Set-Cookie g_handoff=<aj token>; HttpOnly; SameSite=Lax;
   Path=/api/auth/google; Max-Age=60 → 302 /login/google?returnTo=<returnTo>
   (errors: 302 /login?googleError=<code> — a fixed code, never a message or token)
5. app/(public)/login/google/page.tsx → features/auth/GoogleCallbackPage.tsx (AuthGuard requireAuth={false})
   → POST /api/auth/google/exchange (JSON, cookie sent) → backend returns {token,...}, clears g_handoff
6. applyToken → AuthGuard reload to returnTo (as A.7); consent pass-through as A.8
```

The JWT never appears in a URL, there is no server store (so it is multi-worker and restart safe), and `setSession` remains the single writer. Costs: `GOOGLE_CLIENT_SECRET`, `PUBLIC_BASE_URL`, three routes, redirect URIs per environment, a landing page, and the page context is lost when the flow starts from `AuthSheet` (sessionStorage-backed state such as join codes survives).

## 6. Data Model Changes and Migration Notes
Head is `0106_paid_terms.py`.

### 6.1 Revision 0107: `user_identities` (schema only, in `app/auth/models.py`)
| Column | Type | Notes |
|---|---|---|
| `id`, `created_at`, `updated_at` | `BaseEntity` | UUID `gen_random_uuid()`, `pk_user_identities`, `updated_at` as the version column |
| `user_id` | UUID NOT NULL | `fk_user_identities_user_id_users` **ON DELETE CASCADE** (so future account deletion needs no extra step) |
| `provider` | VARCHAR(20) NOT NULL | `IdentityProvider.GOOGLE` via `_enum_column` (string-backed) |
| `subject` | VARCHAR(255) NOT NULL | Google `sub`, case-sensitive, never lowercased |
| `email` | VARCHAR(255) NULL | `normalize_email(claim)` snapshot, **not unique**, never the lookup key |
| `email_verified` | BOOLEAN NOT NULL default false | as reported at the last sign-in |
| `last_login_at` | TIMESTAMP NULL (naive UTC) | optional. Drop it per minimal-implementation unless an audit need exists |

Constraints are `uq_user_identities_provider_subject (provider, subject)` and `uq_user_identities_user_id_provider (user_id, provider)` (one Google per account; it also covers lookups by `user_id`). The business-key `__eq__`/`__hash__` uses `(provider, subject)` per `models.md`. The downgrade is a plain reverse drop. It only runs after 0108's guard has passed, so the only losses are links on accounts that still have a password.

### 6.2 Revision 0108: `users.password_hash` nullable
`SET LOCAL lock_timeout = '5s'`, then `ALTER COLUMN password_hash DROP NOT NULL` (metadata only, but it takes an ACCESS EXCLUSIVE lock). The downgrade is **guarded**: it refuses while `SELECT count(*) FROM users WHERE password_hash IS NULL` > 0, and the message names the recovery path (delete those accounts or restore the pre-0108 dump). Precedents: 0011, and 0073-0076 (guarded).

### 6.3 Runbook notes for `architecture.md`
`pg_dump` first, and run the guard count before any downgrade. There is **no image-only rollback past 0108**, because an old image returns a 500 (`verify_password(None)`) for Google-only users. Run 0107 and 0108 together in one deploy. Off-peak is not required, since both are fast.

### 6.4 Code touch-list
| Area | File | Change |
|---|---|---|
| ORM | `app/auth/models.py:50` | `password_hash: Mapped[str \| None]`; add `IdentityProvider`, `UserIdentity` |
| Account creation | `app/users/service.py:46-81` | `password: str \| None` → NULL hash; family callers unchanged |
| Registration | `app/users/service.py:268-308` | extract `bootstrap_person_account(...)` (duplicate check, username, display name, role, solo family), used by `register` and the Google resolver; map IntegrityError → 409 |
| Display name | `app/users/service.py:261-265` | Google `name` (trimmed, ≤255, `check_text(PROFILE_NAME)`), falling back to `_derive_display_name(email)` |
| Login | `app/auth/router.py:70` | null-hash short-circuit → same 401 |
| Permissions | `app/auth/router.py:50-54` | reuse `_load_permissions` |
| Google | new `app/auth/google.py`, `app/auth/google_service.py` | verifier, nonce/handoff cookies, resolver, router (included in `app/main.py` next to `auth_router`) |
| Matrix | `app/core/authorization_matrix.py` | A: `POST ^/api/auth/google$`, `GET ^/api/auth/google/nonce$` PUBLIC. B: `GET ^/api/auth/google/(start\|callback)$`, `POST ^/api/auth/google/exchange$` PUBLIC. Append near row 47, plus matrix tests |
| Avatar (optional) | `app/media/service.py:305` | after commit, on creation only: fetch `picture` over HTTPS from `*.googleusercontent.com` only, ≤ 2 MB, ≤ 5 s timeout, then `upload_media(..., MediaKind.AVATAR, bytes)` best effort (moderation applies; no login failure). It can also be deferred entirely |
| Not changed | `app/oauth2/*`, `core/security.py`, `core/_auth/*`, `auth/session.ts`, `proxy.ts`, `AuthGuard.tsx` | none |

A future password-set feature must allow setting a first password when the hash is NULL. A future unlink must refuse when it would leave the account with no credential.

## 7. Analysis and Insights

### 7.1 Patterns identified
| Pattern | Type | Prevalence | Assessment |
|---|---|---|---|
| Single token, single frontend writer | architectural | universal | mature. Google must not fork it |
| Optional integration gated by presence (settings property + `NEXT_PUBLIC_*` check) | configuration | Spaces, Maps | reuse as `google_login_configured` |
| Lazy third-party script loader | implementation | Maps | copy for GIS |
| Authorization matrix as test oracle | security | universal | new PUBLIC rows required |
| Guarded lossy downgrades + runbook | migrations | 0073-0076 | apply to 0108 |
| Polish errors in the `ErrorResponse` envelope | API | universal | reuse for 401/403/409 |
| Full reload after a session change | frontend | standard | free via AuthGuard |
| Missing account lifecycle (verification, reset, deletion, revocation) | gap | systemic | drives the linking policy |

### 7.2 Trade-off matrix: browser flow
| Criterion | A. GIS popup + ID token | B. Server code flow + handoff | GIS redirect (`login_uri`) |
|---|---|---|---|
| `AuthSheet` stays in-page (6 surfaces) | **Yes** | No (full redirect, `returnTo`) | No |
| Client secret | none | `GOOGLE_CLIENT_SECRET` in backend env | none |
| Button | Google-rendered iframe (always on-brand) | custom pill allowed if guideline-compliant | Google-rendered |
| Third-party script / future CSP | `accounts.google.com/gsi/*` (script, frame, connect, style) | none | same as A |
| Popup blockers / in-app browsers | risk | robust | robust |
| Backend routes | 2 (nonce, POST) | 3 (start, callback, exchange) + landing page | 1 form POST + landing page |
| Google console entries | JS origins only | redirect URIs per env | JS origins + `login_uri` per env |
| Needs `PUBLIC_BASE_URL` | no | yes | yes |
| Replay/CSRF tools | nonce cookie + JSON-only POST | state + nonce + PKCE S256 | `g_csrf_token` + nonce |
| Provider-generic (Facebook) | no | **yes** | no |
| SSR / standards fit | effect-only init, `ssrSafety` case | thin route file + feature entry, `renderWithRoute` test | as B |
| One Tap later | easy | n/a | easy |
| Dependency | `pyjwt[crypto]` | `pyjwt[crypto]` (+ existing `httpx`) | `pyjwt[crypto]` |

**Recommendation**: A. The in-page `AuthSheet` login is a documented design intent on six conversion surfaces, A has the smallest secret surface and the fewest routes, and aj has no CSP that a third-party script would fight. **Choose B instead** if the owner treats any of these as must-haves: the custom pill button, no Google script on aj pages, or Facebook in the next iteration. The shared verifier and resolver make a later switch, or running both, cheap. GIS redirect mode is not recommended: it leaves the page like B without B's generality.

### 7.3 Account-linking policy (recommended MVP)
| Situation at sign-in | Action |
|---|---|
| (GOOGLE, `sub`) linked | log in that user. Refresh the `email`/`email_verified` snapshot |
| no link, `email_verified=false` | 403 "Adres email konta Google nie jest potwierdzony" |
| no link, no profile with that email | create the account (`password_hash` NULL) + identity, role from the request (default GUEST), 201 |
| no link, an account profile (`account_user_id` set) with that email | **refuse 409** with a Polish "log in with your password" message. No merge |
| no link, a login-less profile (family member or anonymous guest) with that email | refuse 409 (same as `DuplicateEmailException`; no merge feature exists) |
| logged-in user "Połącz z Google" (phase 2) | `POST /api/auth/google/link` (EDIT): link if `sub` is unlinked, refuse if it is linked to another user |
| unlink (phase 2) | allowed only if a password or another identity remains |

Rejected alternatives: auto-link on authoritative Google email (aj's side is unverified, which is the pre-hijack case), and link + NULL the password (an attacker's live JWT survives up to 1 h, and it silently removes a legitimate user's password). The 409 confirms that the email is registered, but `register` already does that, so there is no new enumeration leak.

### 7.4 Key insights
1. Google is an upstream identity, not an OAuth2-server feature, so the only constraint is that `returnTo` survives the round trip (High).
2. aj's own lifecycle gaps decide the linking policy (High).
3. `AuthSheet` is the deciding UX factor for the flow choice (High).
4. In B, a 60-second HttpOnly handoff cookie plus a JSON exchange avoids both a token in the URL and a server-side store (Medium-High).
5. Request-derived URLs are wrong behind nginx, and so is the existing OAuth2 metadata issuer at :5174 (High).
6. JSON delivery plus the absence of a backend-set session cookie structurally blocks login CSRF (Medium-High).
7. Google sign-in must read DB permissions, or admins lose ADMIN (High).

### 7.5 SWOT
| Strengths | Weaknesses |
|---|---|
| One token shape, so downstream is unchanged. Same-origin `/api` in all environments. Existing loader, guard and matrix patterns. PyJWT already used | No email verification, revocation, password reset or deletion. Register race returns a 500. Base URL wrong behind nginx |
| **Opportunities** | **Threats** |
| One Tap later (A). Facebook via the same table and resolver (B). Fix the register race and the metadata issuer while touching the code. Google avatar import | Pre-account hijack if linking is relaxed. Popup blocking (A). Brand verification and privacy policy blocking a branded prod consent screen. GIS/FedCM changes |

## 8. Security Checklist
**ID-token validation**
- [ ] Signature RS256 against Google JWKS. `algorithms=["RS256"]` pinned; never take the algorithm from the header.
- [ ] `iss` ∈ {`https://accounts.google.com`, `accounts.google.com`}.
- [ ] `aud` == `GOOGLE_CLIENT_ID`. If `azp` is present, it equals the client ID.
- [ ] `exp` in the future, `iat` required, leeway ≤ 60 s (30 s proposed).
- [ ] Nonce present and equal (`hmac.compare_digest`) to the server-issued value from the signed HttpOnly cookie, used once.
- [ ] `sub` is the key (case-sensitive). Email is only a lookup hint after `normalize_email`.
- [ ] `email_verified` true is required to create an account. `hd` is not used (no domain restriction).
- [ ] Verify locally. Never call `tokeninfo` in production. JWKS is fetched in a threadpool with a timeout and refreshed on an unknown `kid`.
- [ ] The Google credential is discarded after verification, never logged and never stored. The aj JWT stays HS256 over `JWT_SECRET`.

**Flow integrity**
- [ ] A: `POST /api/auth/google` accepts `application/json` only (blocks cross-site form POSTs). The response is JSON and the backend sets no session cookie.
- [ ] B: `state` (≥ 128-bit random) bound to the browser via the signed `g_tx` cookie, PKCE S256 verifier, nonce, one-time use, Max-Age 600.
- [ ] Cookies are `HttpOnly; SameSite=Lax; Path=/api/auth/google`, with `Secure` from the `PUBLIC_BASE_URL` scheme (B) or the request scheme behind a trusted proxy. Signed with HMAC over a key derived from `JWT_SECRET` with a purpose label (or a separate `GOOGLE_STATE_SECRET`).
- [ ] B: the aj JWT is never in a query, fragment or `Location` header. Handoff via the 60-second HttpOnly cookie plus a JSON exchange. Error redirects carry fixed codes only.
- [ ] `returnTo` is validated with the `isSafeReturnPath` rules on the backend (B) and again by `AuthGuard` (both). Same-origin relative paths only (RFC 9700 §4.11.1).
- [ ] No implicit flow. Exact redirect URIs. HTTPS everywhere except localhost.

**Accounts**
- [ ] No automatic email linking (§7.3). Login-less profiles with that email return 409.
- [ ] Password login on a NULL hash returns the same 401 "Invalid username or password" (no "this email uses Google" leak, no 500).
- [ ] Permissions via `_load_permissions`.
- [ ] IntegrityError on either unique index → rollback → 409 or re-read, never a 500.
- [ ] Rate-limit the new endpoints with nginx `limit_req`. Login and register have no limit today either, so cover all three.

**Secrets and privacy**
- [ ] `GOOGLE_CLIENT_SECRET` (B only) lives in the backend env only. Never `NEXT_PUBLIC_*`, never a Docker build arg, never printed. Presence checks only.
- [ ] Only the `openid email profile` scopes. No refresh token, no Google API access.
- [ ] Avatar fetch (optional) restricted to Google image hosts over HTTPS, with size and time limits (SSRF).
- [ ] Accepted risk, documented: no session revocation. RISC is deferred until a per-user token cutoff exists.

## 9. Config and Deploy Checklist
**Google Cloud console**
- [ ] OAuth consent screen: External, scopes `openid email profile`, app name "aj", support email, privacy policy + homepage links (needed for brand verification), authorized domain verified in Search Console.
- [ ] Two OAuth clients (Web application): **dev** (localhost entries) and **prod** (production host only), so the prod secret never reaches dev machines.
- [ ] Publish to "In production" once the privacy policy and homepage are live. Check in the console whether Testing shows a warning (the docs conflict).

**Redirect-URI / JavaScript-origin matrix**
| Environment | Authorized JavaScript origins (A) | Authorized redirect URI (B) | Backend reached via | Backend secrets live in | Frontend client ID (A) |
|---|---|---|---|---|---|
| Dev host (`next dev` :5173 + uvicorn :8080) | `http://localhost`, `http://localhost:5173` | `http://localhost:5173/api/auth/google/callback` | Next rewrite `/api/:path*` (`next.config.ts:8`) | `src/backend/.env` | `src/frontend/.env.local` `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |
| Compose (nginx :5174) | `http://localhost`, `http://localhost:5174` | `http://localhost:5174/api/auth/google/callback` | nginx `location /api/` (`nginx.conf:37-41`) | root `.env` → `backend.environment` | root `.env` → `web.build.args` → Dockerfile `ARG` (rebuild `web`) |
| Production (host TBD) | `https://<public-host>` | `https://<public-host>/api/auth/google/callback` | TLS terminator → nginx :80 → backend | server root `.env` (never in an image or the repo) | build arg at image build |

`localhost` and `127.0.0.1` are distinct entries: use `localhost` consistently.

**Backend `Settings` (`app/config.py`)**
- [ ] `google_client_id: str | None = None` (A and B).
- [ ] `google_client_secret: str | None = None` (B only).
- [ ] `public_base_url: str | None = None` (B only; never derive it from request headers).
- [ ] `google_login_configured` property (all required values set). Routes return 404, or a Polish 503, when it is off.

**Compose / Docker / env files**
- [ ] `docker-compose.yml` `backend.environment`: `GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}`, plus `GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}` and `PUBLIC_BASE_URL: ${PUBLIC_BASE_URL:-http://localhost:5174}` for B.
- [ ] A: `web.build.args` `NEXT_PUBLIC_GOOGLE_CLIENT_ID: ${NEXT_PUBLIC_GOOGLE_CLIENT_ID:-}`, plus `ARG`/`ENV` in the `src/frontend/Dockerfile` build stage (inlined at build; runtime env will not work).
- [ ] B: the frontend needs a way to show the button. Use `NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED` as a build arg, or reuse `NEXT_PUBLIC_GOOGLE_CLIENT_ID` presence (it is not secret).
- [ ] `.env.example`: a comment block plus empty placeholders for each new key. Values only in the git-ignored `.env`.
- [ ] No nginx or `next.config.ts` change (everything is under `/api/`). Optional `limit_req` for `/api/auth/`.
- [ ] CORS unchanged (same origin). Keep no COOP (or `same-origin-allow-popups` if one is ever added, for A).
- [ ] If a CSP is introduced later (A): `script-src https://accounts.google.com/gsi/client; frame-src https://accounts.google.com/gsi/; connect-src https://accounts.google.com/gsi/; style-src https://accounts.google.com/gsi/style`, alongside the Maps sources.
- [ ] Backend `pyproject.toml`: `pyjwt[crypto]>=2.13.0`, with `uv.lock` updated and shipped in the same change.
- [ ] Docs: `tech-stack.md` (dependency, env vars), `architecture.md` (Google login section + 0107-0108 runbook), the `INDEX.md` summary.

**Legal/UX**
- [ ] A privacy-policy page (for example `/about/privacy`; `about` is already a reserved slug) explaining the use of Google data, and a homepage describing aj.
- [ ] Polish copy: CTA "Kontynuuj z Google", plus error lines for cancelled, unverified email, account conflict and service unavailable.
- [ ] The same terms or consent notice as password registration (not researched; see the gaps).

## 10. Test Strategy (no network calls to Google)
**Backend (pytest, real PostgreSQL via testcontainers, `backend-testing.md`)**
- *Verifier unit tests* (`tests/test_google_id_token.py`): generate an RSA key with `cryptography` in the test, build a `jwt.PyJWKSet`/JWK dict, and inject it in place of the JWKS fetch (a constructor argument or a monkeypatched `PyJWKClient.fetch_data`). Sign tokens locally. Cases: valid; wrong `aud`; wrong `iss`; expired; missing nonce or nonce mismatch; `alg=HS256` with the public key as secret (alg confusion); unknown `kid`. Use table tests (`pytest.mark.parametrize`).
- *Endpoint tests* (`tests/test_google_login.py`): override `get_google_verifier` through `app.dependency_overrides` to return fixed claims (no crypto, no network). Cases: first sign-in creates User (NULL hash) + Identity + Profile + `UserRole(USER)` + solo Family with an exact key-set response and 201; a returning `sub` gives 200 with the same username and DB permissions (seed ADMIN and assert it is kept); an email collision with a password account gives 409 with the Polish message; a login-less profile collision gives 409; `email_verified=false` gives 403; `role=ORGANIZER` adds ORGANIZATOR; the token works on `GET /api/people/me`; a non-JSON content type is rejected; nonce cookie missing or expired gives 401.
- *Password login on a Google-only account* (`tests/test_login.py`): 401, not 500.
- *OAuth2 pass-through*: register a public client via `POST /oauth2/register`, then `POST /oauth2/authorize` with the Google-created token as the `_token` form field gives a 302 with `code` (the first `/oauth2/*` HTTP test).
- *Migrations* (`tests/test_user_identities_migration.py`): a downgrade-to-0106-then-upgrade-head round trip with the named constraints asserted, and the 0108 refusal while a NULL hash exists, restoring head plus `engine.dispose()` in `finally`.
- *Matrix*: new rows in `tests/test_authorization_matrix.py`.
- *B only*: start sets `g_tx` and 302s to Google with S256 parameters (assert the URL only); the callback with the token-exchange function behind a dependency, overridden to return a locally signed `id_token` (no HTTP mocking library needed), checks state mismatch, an unsafe `returnTo` and the handoff cookie; exchange returns the token once and the cookie is cleared.
- Expected size: 8-14 tests across 3-4 files, within the 2-8 per feature guideline per feature slice.

**Frontend (Vitest + Testing Library, `frontend-testing.md`)**
- `SocialAuthButtons.test.tsx`: the Google button is hidden without `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (`vi.stubEnv`); with it, the loader is called. Use a fake `window.google.accounts.id` (`initialize`/`renderButton` as `vi.fn`) whose stored callback the test invokes with a fake credential, and assert that `fetch` POSTs `/api/auth/google` with JSON. Facebook still shows "wkrótce". Polish error on a 409.
- `googleIdentity.test.ts`: the loader mirrors the Maps loader tests (a single script tag, `null` without a key, timeout, retry after failure). No real script is loaded.
- `auth.test.tsx`: `AuthContext.loginWithGoogle` calls `setSession`, then the token is visible; on error it throws `body.message`.
- `ssrSafety.test.tsx`: `/login` and an `AuthSheet` host render to string without touching `window.google`.
- `AuthGuard.test.tsx`: unchanged coverage of the `returnTo` reload. For B, add `GoogleCallbackPage.test.tsx` via `renderWithRoute({url: "/login/google?returnTo=/oauth2/authorize%3F…", pattern: "/login/google"})`, asserting `replaceDocument` with the `returnTo` and an error state; `proxy.test.ts` checks that `/login/google` is unprotected and `/api/auth/google/callback` is skipped.
- Typed fixtures without `as` casts; `vi.resetAllMocks()` in `beforeEach`.

## 11. Dependency Decision
| Option | New packages | Async | Fit | Verdict |
|---|---|---|---|---|
| **`pyjwt[crypto]`** | `cryptography` (+ `cffi`, `pycparser`) | `PyJWKClient` blocking → `run_in_threadpool` (or an `httpx` prefetch into `PyJWKSet`) | already the JWT library; issuer containers, `require`, leeway, key refresh on unknown `kid` | **Choose** |
| google-auth | `google-auth` + `requests` transport, `cachetools`, `pyasn1-modules`, `rsa` | no | certs re-fetched on every call unless wrapped; `audience=None` skips the aud check | reject |
| Authlib | `authlib` + `itsdangerous`, Starlette `SessionMiddleware` | yes | a session middleware aj doesn't use; `url_for` scheme issues behind nginx | reject |

`cryptography` absence verified: `grep -i cryptography src/backend/uv.lock` returns no match (2026-11-25). Justification against "minimal dependencies": a new dependency is unavoidable for RS256, and this is the smallest one, an extra of a library already in use. `httpx` (already locked) covers B's token exchange. The frontend has no npm dependency.

## 12. Conclusions
**Primary**
1. Google sign-in = new verifier + resolver ending in `encode_login_token` + JSON `{token}` + `applyToken`. OAuth2 server, session, proxy and guard are unchanged. **High.**
2. Data model: `user_identities` (0107) + nullable `password_hash` with a guarded downgrade (0108). **High.**
3. Security: RS256/JWKS verification with pinned claims and a nonce, `sub` as the key, no automatic email linking, JSON-only handoff. **High.**
4. Dependency: `pyjwt[crypto]`. **High.**
5. Flow: A (GIS popup) recommended for the in-page `AuthSheet` UX, with B (code flow + handoff cookie) as the alternative if the custom button, no third-party script or Facebook-readiness matters more. **Medium-High** (it depends on owner priorities).

**Secondary**
- `resolve_base_url` is wrong at :5174, which already affects the OAuth2 metadata issuer.
- The register IntegrityError race returns a 500 today, so fix it in the shared bootstrap.
- Production needs non-code artefacts: a domain, a privacy policy and a homepage.

**Direct answer**: add a public `POST /api/auth/google` (plus a nonce endpoint) in `app/auth`, verify the GIS ID token with PyJWT + `cryptography`, and resolve users via a new `user_identities` table (sign-up through a password-optional shared bootstrap; email collisions refused with 409). Return the standard aj login JWT, and let the frontend's new `loginWithGoogle` → `applyToken` and the existing `AuthGuard` reload do the rest. Configure one Google client per environment family and gate the feature on the presence of `GOOGLE_CLIENT_ID` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

## 13. Recommendations
| # | Recommendation | Priority | Effort | Rationale | Risk |
|---|---|---|---|---|---|
| R1 | Owner picks flow A or B (§7.2) | Critical (blocks the spec) | XS | everything else is shared | — |
| R2 | Migrations 0107 + 0108 with tests and a runbook | High | S | prerequisite for any Google account | no image-only rollback past 0108 |
| R3 | Shared `bootstrap_person_account` + IntegrityError → 409 + login null-hash guard | High | S | reuse register, fix the race | touches registration, so keep its 4 tests green |
| R4 | `pyjwt[crypto]` + `verify_google_id_token` with unit tests | High | S | core security | JWKS fetch blocking, so use a threadpool |
| R5 | Resolver with the §7.3 policy + `/api/auth/google` (+ nonce) + matrix rows | High | M | the feature | linking strictness may irritate existing users, so add clear Polish copy |
| R6 | Frontend: GIS loader, `SocialAuthButtons`, `AuthContext.loginWithGoogle` (A), or the landing page (B) | High | M | the feature | iframe in the focus trap, so test manually on mobile |
| R7 | Settings, compose, Dockerfile, `.env.example`, docs | High | S | deploy | secrets rule |
| R8 | Privacy policy + homepage + Search Console domain + brand verification | High for prod | M (non-code) | branded consent screen | external lead time |
| R9 | Phase 2: "Połącz z Google" from settings + unlink rules | Medium | M | the safe path for existing password users | — |
| R10 | Later: `token_version`/`iat` cutoff, then RISC; email verification for password accounts | Low-Medium | M-L | closes the revocation and linking gaps | — |
| R11 | Side fix: `resolve_base_url` behind nginx (`PUBLIC_BASE_URL` for OAuth2 metadata too) | Low | XS | an existing bug | — |
| R12 | Optional: Google avatar import on creation | Low | S | nicer profiles | SSRF, so restrict hosts |

## 14. Appendices

### A. Source list
**Finding files** (`analysis/findings/`): `codebase-auth-login-jwt.md`, `codebase-auth-oauth2-server.md`, `codebase-data-model-current.md`, `codebase-data-model-proposal.md`, `codebase-frontend-google-integration.md`, `codebase-frontend-session-routing.md`, `config-deploy-env-and-origins.md`, `external-google-console-branding-facebook.md`, `external-google-flows.md`, `external-google-id-token-verification.md`, `external-google-security-linking.md`.

**Key code**: `app/core/security.py:23-66`; `app/core/_auth/{token.py:10-49, principal.py:20-64, dependencies.py:21-39}`; `app/auth/router.py:28-87`; `app/auth/models.py:18-50`; `app/users/{router.py:41-51, service.py:38-308, schemas.py:23-148, models.py:45-92}`; `app/oauth2/{router.py:139-668, stores.py, metadata_router.py:45-98}`; `app/core/authorization_matrix.py:38-291`; `app/config.py:19-78`; `app/main.py:272-287`; `app/media/{models.py, service.py:305-358}`; Alembic `0001`, `0011`, `0015`, `0016`, `0082`, `0106`; `src/frontend/src/{auth/session.ts, auth/AuthContext.tsx, auth/AuthGuard.tsx, auth/authPaths.ts, utils/url.ts, proxy.ts, routing/paths.ts, routing/reservedSlugs.ts, lib/googleMaps.ts, features/auth/{SocialAuthButtons,AuthTabs,AuthSheet,LoginForm,LoginPage,OAuth2AuthorizePage}.tsx}`; `docker-compose.yml`, `src/frontend/nginx.conf`, `src/frontend/next.config.ts`, both Dockerfiles, `pyproject.toml`, `uv.lock`, `.env.example` (keys).

**External**: developers.google.com/identity/{openid-connect/openid-connect, gsi/web/guides/overview, gsi/web/reference/js-reference, gsi/web/guides/display-button, gsi/web/guides/verify-google-id-token, gsi/web/guides/fedcm-migration, gsi/web/guides/get-google-api-clientid, oauth2/web/guides/use-code-model, protocols/oauth2/web-server, protocols/oauth2/production-readiness/overview, protocols/risc, branding-guidelines}; accounts.google.com/.well-known/openid-configuration; support.google.com/cloud/answer/{15549945, 13463073, 13464321}; openid.net OIDC Core 1.0; RFC 9700; RFC 7636; OWASP OAuth2 Cheat Sheet; pyjwt.readthedocs.io (usage, api); googleapis.dev google-auth id_token; Authlib docs (Debian-packaged copy, blog); USENIX Security 2022 Sudhodanan & Paverd + MSRC blog; developers.facebook.com (web login, OIDC token, manual flow, debug_token, map-users).

### B. Gaps and uncertainties
| Gap | Impact | Next step |
|---|---|---|
| Production host and TLS terminator unknown | prod URIs/origins | owner names the domain |
| No privacy policy or homepage | brand verification | write `/about/privacy` |
| Terms/consent on password registration not researched | sign-up parity | check `RegisterForm` during the spec |
| PyJWKClient behaviour only from docs | low | covered by the unit tests |
| GIS iframe in `trapFocus`, mobile width | UX | manual check during implementation |
| Google Testing-status warning conflict | low | check in the console |
| No account deletion; Google data policy | legal | note in the privacy policy, later feature |
| No revocation; RISC deferred | security | R10 |
| Facebook details (email availability, deletion URL) | future | research when Facebook is scheduled |

### C. Methodology details
Each claim about aj was taken from file:line reads by the gatherers. The `cryptography` absence was re-run during synthesis. Each Google rule cites an official URL fetched on 2026-11-25. Confidence: High = direct code or official docs, from multiple sources or verified; Medium = a single source or docs-only behaviour; Low = unverified.

### D. Raw data references
`analysis/findings/*.md` (11 files), `planning/sources.md`, `analysis/synthesis.md`.
