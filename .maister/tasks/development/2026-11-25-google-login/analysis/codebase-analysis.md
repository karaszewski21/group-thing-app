# Codebase Analysis Report

**Date**: 2026-11-25
**Task**: Google sign-in/sign-up for aj (FastAPI backend + Next.js frontend)
**Description**: Implement Google sign-in/sign-up per the completed research `.maister/tasks/research/2026-11-25-google-login` (GIS popup + ID token + server nonce in a signed HttpOnly cookie; `GET /api/auth/google/nonce`, `POST /api/auth/google`; `user_identities` (0107); nullable `users.password_hash` (0108, guarded downgrade); no auto-linking by email; new accounts GUEST via shared `bootstrap_person_account`; permissions from DB; `pyjwt[crypto]` + JWKS cache; 503 without `GOOGLE_CLIENT_ID`; button hidden without `NEXT_PUBLIC_GOOGLE_CLIENT_ID`).
**Analyzer**: codebase-analyzer skill (3 Explore agents: File Discovery, Code Analysis, Context Discovery)

---

## TL;DR
No Google-login source code exists yet: commit 69f36ee added only research artifacts and a hero image. The backend auth lives in a small `app/auth/router.py` (login) plus `app/users/service.py::register`, where the account bootstrap is inline and has to be pulled out into a shared `bootstrap_person_account`. Two blockers have to be fixed first: `cryptography` is missing (`pyjwt` has no `[crypto]` extra), and `users.password_hash` is NOT NULL, so `verify_password` would crash with a 500 on a `None` hash. On the frontend, `SocialAuthButtons.tsx` is a mock with no tests. It is rendered once in `AuthTabs`, which already reaches `/login` and all six `AuthSheet` entry points. The change is moderate: about 15 files, two migrations, two authorization-matrix rows and new deploy env vars.

## Key Decisions
- Extend `app/auth/router.py` with the two Google routes, and put the verifier and identity service in `app/auth/`. `app.auth` has no module-boundary restriction, and `app.auth.router` may import `app.users.service`, because `app.users.service` already imports `app.auth.models` and `app/auth/models.py` stays free of users imports.
- Extract the inline `register` bootstrap (`create_account_and_profile`, the role, the solo family and the deferred family import) into `bootstrap_person_account`, used by both register and Google (ADR-006/008). Every Google account is created as GUEST.
- Load permissions with the existing `_load_permissions(db, user_id)` instead of a hard-coded `["READ","EDIT"]`. Register currently hard-codes them.
- Do not auto-link by email (ADR-005). An unlinked Google sign-in whose email is already registered returns a Polish 409, and an unverified Google email returns 403. **Note:** the Code Analysis agent's "Recommended approach" step 5 suggested linking to an existing profile by email when `email_verified` is true. That contradicts ADR-005 and is rejected. The decided behaviour is the 409.
- Fetch the JWKS with `httpx.AsyncClient` and hold it in a module cache, then verify with `jwt.PyJWK`, rather than `PyJWKClient`, which blocks on urllib. `httpx` is already a runtime dependency. If `PyJWKClient` is used anyway, wrap it in `run_in_threadpool`.
- Gate the feature like `photo_storage_configured`: `google_client_id: str | None = None` in `Settings`. When it is unset the backend returns 503 through `ServiceUnavailableException`, and the frontend button is not rendered.
- Copy `src/lib/googleMaps.ts` as the template for the GIS loader (memoized loader that forgets failures, script id, timeout, env read on each call), and test it the same way `googleMaps.test.ts` does.
- `AuthContext.applyToken` is already the single session entry point. Add `loginWithGoogle` beside `login`/`register` so `AuthGuard`, `useAccountGate` and `AuthSheet` close or redirect with no changes.

## Open Questions / Risks
- **First backend `Set-Cookie`.** The backend has never set a cookie. The nonce cookie needs `Secure` set correctly, but uvicorn runs without `--proxy-headers` and nginx sends `X-Forwarded-Proto`, which nothing trusts except the hand-rolled read in `app/oauth2/metadata_router.py:33-60`. Decide how `Secure` and `SameSite` are derived (behind nginx, and in dev on http :5173 via Next rewrites).
- **Registration race.** `register` does not catch `IntegrityError`. A concurrent Google sign-up on `uq_user_profiles_email_lower`, `uq_users_username` or the new `uq_user_identities_provider_subject` would reach the generic 409 "Data integrity violation". Consider the `begin_nested` + `except IntegrityError` pattern from `app/events/service.py:401-408`, so the result is either the Polish 409 or a re-read of the existing identity.
- **Guarded 0108 downgrade.** It has to refuse while any `password_hash IS NULL` row exists, and its runbook belongs in `architecture.md`. There is no image-only rollback once Google-only accounts exist.
- **Other `password_hash` readers.** Every code path that assumes a hash must handle `None`: login (fails today with an AttributeError and a 500), and possibly password change, the OAuth2 authorization server login, and family/guardian account creation (`app/families/bootstrap.py:58`, `app/families/guardians.py:32` call `create_account_and_profile`). Grep for `password_hash` and `verify_password` before planning.
- **Focus trap.** `components/shared/trapFocus.ts` lists no `iframe`, so Tab inside `AuthSheet` skips the GIS button iframe. Decide whether to add `iframe` to `FOCUSABLE`, and check what that does to other sheets.
- **COOP and CSP.** There are none today (nginx, `next.config.ts`, `architecture.md:157`). The GIS popup works without them, but if a COOP header is added later it must be `same-origin-allow-popups`.
- **Docs out of date.** `architecture.md:535` says the backend calls no Google endpoint, which stops being true once it fetches the JWKS. Also update `:157`, `:159`, `:532`, `:619` (Dockerfile build args) and `tech-stack.md:110` (env vars).
- **Test mocks.** The `AuthContext` mock in `auth.test.tsx` (:29-48, defaults :84-100) lists every field, so `loginWithGoogle` must be added there. `themeDefects.test.tsx:80` and `themeTokenUsage.test.tsx:91` may apply theme-token rules to the `features/auth` files.
- **Known baseline failures** (33 vitest, 2 backend stale tests, mypy 15, ruff 65 on HEAD) must not be mistaken for regressions.

---

## Summary

The decided HLD already matches the request contract, and no implementation exists yet. The backend needs a new `user_identities` table, a nullable password hash, a Google ID-token verifier with a JWKS cache and a signed nonce cookie, two public routes, and an account-bootstrap function shared with register. The frontend needs a GIS loader, a real Google button inside the existing `SocialAuthButtons`, and `loginWithGoogle` in `AuthContext`. Every auth surface goes through `AuthTabs`, so it is one integration point.

---

## Files Identified

### Primary Files

**src/backend/app/auth/router.py** (87 lines)
- `router = APIRouter(prefix="/api/auth")` :28; `LoginRequest` :33; `LoginResponse` :46; `_load_permissions` :50-54; `login` :57-87, with a hand-built 401 ErrorResponse :70-81 and `encode_login_token` :83-87.
- Home of the new `GET /google/nonce` and `POST /google`. Line 70 must treat `password_hash is None` as a 401.

**src/backend/app/auth/models.py**
- `Permission` :18, `user_permissions` :33, `User` :46, `password_hash` NOT NULL :50 (change to `Mapped[str | None]`). Add the `UserIdentity` entity here (BaseEntity, `user_id` FK).

**src/backend/app/users/service.py**
- `DuplicateEmailException` :37 (Polish 409), `create_account` :46 (always hashes), `create_account_and_profile` :57, `get_or_create_active_user_role` :199, `derive_username_from_email` :241, `_derive_display_name` :261, `register` :268-308 (duplicate check :279-283, deferred solo-family import :296-302). Source of `bootstrap_person_account`. `create_account` needs a hash-optional path.

**src/backend/app/users/router.py**
- `POST /api/auth/register` :41-51, with hard-coded `["READ","EDIT"]`. Switch it to the shared bootstrap and DB permissions.

**src/backend/app/core/security.py**
- `verify_password` :23 (raw bcrypt, crashes on None), `encode_login_token` :39, `import jwt` :15.

**src/backend/app/config.py**
- `Settings` :19, optional `spaces_*` :33-39, `photo_storage_configured` :64 as the gate pattern. Add `google_client_id` and probably a nonce-signing key (or derive it from `jwt_secret`).

**src/backend/pyproject.toml / uv.lock**
- `pyjwt>=2.13.0` :12 changes to `pyjwt[crypto]`, which brings `cryptography`. Ship `uv.lock`. `httpx>=0.27` :21 is already a runtime dependency.

**src/backend/app/core/authorization_matrix.py**
- `_RAW_MATRIX` :37; row 6 :43 login PUBLIC; row 47 :183 register PUBLIC (appended, not renumbered, comment :179-182). Append two PUBLIC rows: `GET ^/api/auth/google/nonce$` and `POST ^/api/auth/google$`.

**src/backend/alembic/versions/** (head `0106_paid_terms.py`)
- New `0107_user_identities.py` and `0108_nullable_password_hash.py` (guarded downgrade). Helpers `_id()`/`_timestamps()` in `0103_points_tables.py:32-46`; guard pattern in `0073_event_reservations.py:63-78` and `0076` (with `SET LOCAL lock_timeout`).

**src/frontend/src/features/auth/SocialAuthButtons.tsx**
- `Provider` :3, `BUTTON_CLASS` :5, `GoogleMark` :8, component :34-59, Google aria-label "Kontynuuj przez Google" :40, Facebook :44, status line :49-51, divider "lub emailem" :52-56. Replace the Google mock with the GIS-rendered button and accept a `tab` prop (signin_with / signup_with).

**src/frontend/src/auth/AuthContext.tsx**
- `AuthContextValue` :22, internal `applyToken` :83-90, `login` :110-127, `register` :129-151 (role "GUEST" :136), value :158-171, token effect :100-109. Add `loginWithGoogle(credential)`.

**New: src/frontend/src/lib/googleIdentity.ts** (modeled on `src/lib/googleMaps.ts`: `SCRIPT_URL` :14, `SCRIPT_ID` :15, `LOAD_TIMEOUT_MS` :16, `isGoogleMapsConfigured` :54, memoized load :62-82, `injectScript` :138). Uses `https://accounts.google.com/gsi/client` with readiness on `window.google?.accounts?.id`.

### Related Files

**src/backend/app/users/schemas.py**: `EMAIL_PATTERN` :23, `normalize_email` :26 (reuse for the Google email), `RegisterRequest` :125, `RegisterResponse` :145.
**src/backend/app/users/models.py**: `UserProfile` :45-74 (email nullable, `account_user_id` nullable FK; `uq_user_profiles_email_lower` partial unique index from 0016), `UserRole` :77-92.
**src/backend/app/families/bootstrap.py**: `create_solo_family_for_party` :67; other caller of `create_account_and_profile` :58. **app/families/guardians.py:32** also calls it.
**src/backend/app/party/service.py**: `create_party`.
**src/backend/app/core/errors.py**: `ErrorResponse` :22-35, `_envelope` :88-102, handlers :174-193 (409 `BusinessConflictException`, 403 `AccessDeniedException`, 503 `ServiceUnavailableException`, IntegrityError 409 :115-117).
**src/backend/app/core/_auth/token.py**: cookie read on GET/HEAD only :11-15, :48-49 (unchanged). **app/core/_auth/principal.py:52-61**: claim parsing (unchanged).
**src/backend/app/main.py**: auth router :28/:287 (no new router needed if the routes stay in `app/auth/router.py`).
**src/backend/app/oauth2/metadata_router.py:33-60**: only `X-Forwarded-*` handling, a reference for deriving `Secure`.
**src/backend/app/events/service.py:401-408**: `begin_nested` + IntegrityError recovery pattern.
**src/frontend/src/features/auth/AuthTabs.tsx**: renders `SocialAuthButtons` :56-59; passes `tab`.
**src/frontend/src/features/auth/LoginForm.tsx**: error pattern :15-26, alert :60-64 (copy for the Google error line). **RegisterForm.tsx**: `DUPLICATE_EMAIL_MESSAGE` :5 with an inline "Zaloguj się" switch :69-76, possibly reused for the 409. No terms or consent notice exists anywhere, so there is nothing to mirror.
**src/frontend/src/features/auth/AuthSheet.tsx** :13-32, **useAccountGate.ts:12**, **LoginPage.tsx** :16-29, **src/auth/AuthGuard.tsx** :37-42, **src/auth/session.ts** (`setSession` :69): no change needed.
**src/frontend/src/components/shared/trapFocus.ts** :1-26, **ModalSheet.tsx** :28-66: iframe focus question.
**AuthSheet consumers** (no change, covered through `AuthTabs`): `components/shared/SignUpFooter.tsx:76`, `features/product/blocks/ItemChatButton.tsx:30`, `ItemPickupActions.tsx:156`, `features/terms/blocks/TermNeededItems.tsx:85`, `features/product/ItemPage.tsx:84`, `features/terms/views/PrivateTermView.tsx:83`.
**Deploy**: `docker-compose.yml` backend env :31-44, web build args :74-75; `src/frontend/Dockerfile` :24-25; root `.env.example`, `src/frontend/.env.example`; `next.config.ts` (`/api/:path*` already proxied); `nginx.conf` `/api/` :37 (covered).
**Docs**: `.maister/docs/project/architecture.md` (:157, :159, :532, :535, :619 and a new 0107–0108 runbook), `tech-stack.md:110`.

---

## Current Functionality

- **Login**: looks up `UserProfile` by normalized email, then `db.get(User)`, `verify_password` and `encode_login_token(username, permissions-from-DB)`, returning 200 `{token}`. On failure it returns a hand-built 401 "Invalid username or password".
- **Register** (`app/users`): checks for a duplicate email (409 Polish), then `create_account` (User + hash + READ/EDIT `user_permissions` via Core), `create_party` PERSON, `UserProfile`, `UserRole` USER (ORGANIZER optional), a solo family "Rodzina {display_name}", and a commit. Returns 201 `{token, party_id, role}` with hard-coded permissions. Username comes from the email local part (sanitized, 50 chars, numeric suffix); the display name is the local part title-cased.
- **Session**: the frontend stores the token in localStorage plus a JS-readable `auth_token` cookie (SameSite=Lax). The backend accepts the cookie only on GET/HEAD. The backend sets no cookies.
- **Social buttons**: a static mock that shows "Logowanie przez … będzie dostępne wkrótce.".
- **Failure point**: once a hash can be NULL, `verify_password(body.password, None)` raises an AttributeError and returns 500.

### Key Components/Functions
- **`_load_permissions`**: DB permission read, reused for the Google token.
- **`create_account_and_profile`**: shared by register and the families code. The new bootstrap wraps it plus role and solo family.
- **`derive_username_from_email` / `_derive_display_name`**: reuse for Google, possibly preferring the Google `name` claim for the display name.
- **`encode_login_token`**: the same HS256 login token for Google sign-ins.
- **`applyToken`**: the frontend's single session entry point.

### Data Flow (target)
GIS button, then `GET /api/auth/google/nonce` (signed HttpOnly cookie plus `{nonce}`), then GIS popup, then `credential`, then `POST /api/auth/google {credential}`. The backend verifies the signature (JWKS), `aud`/`iss`/`exp`, the nonce against the cookie, and `email_verified`. It then looks up `user_identities(provider, subject)`:
- Found: 200 with the token.
- Not found and the email is free: `bootstrap_person_account` (GUEST, no hash) plus the identity, then 201.
- Not found and the email already exists: 409 (Polish).
- Email not verified: 403.
- Client ID unset: 503.

The frontend then calls `applyToken`, which triggers the AuthGuard redirect or closes the sheet.

---

## Dependencies

### Imports (What This Depends On)
- `pyjwt[crypto]` / `cryptography`: RS256 verification (new).
- `httpx`: async JWKS fetch (already a runtime dependency).
- `app.users.service`, `app.users.models`/`schemas`, `app.party.service`, `app.families.bootstrap`: account bootstrap.
- `app.core.security`, `app.core.errors`, `app.config`.
- Frontend: GIS script (`accounts.google.com/gsi/client`), `AuthContext`, `session.ts`.

### Consumers (What Depends On This)
- **app/users/router.py**: register switches to the shared bootstrap.
- **app/families/bootstrap.py, app/families/guardians.py**: call `create_account_and_profile` and must keep working.
- **features/auth/AuthTabs.tsx**: renders the button; it is reached by `LoginPage` and the six `AuthSheet` call sites.
- **Code reading `User.password_hash`**: login, and possibly others (to verify).

**Consumer Count**: ~10 files
**Impact Scope**: Medium. Authentication is cross-cutting, but the change is additive behind a single UI component and two new routes. Register and families are touched only through the refactor.

---

## Test Coverage

### Test Files
- **tests/test_login.py** (:11, :28, :43, :61): login success and failure. Add a NULL-hash 401 case.
- **tests/test_registration.py** (201 :19, duplicate Polish :34, username :48, ORGANIZER :67): the regression net for the bootstrap extraction.
- **tests/test_families_bootstrap.py**: solo-family creation.
- **tests/test_auth_cookie.py** :41-103: cookie on GET/HEAD only.
- **tests/test_authorization_matrix.py**: `resolve_requirement(...) == "PUBLIC"` pattern (:243, :320, :329, negative :324).
- **Migration templates**: `tests/test_item_visibility_migration.py` (`_alembic` subprocess :21-30, round-trip :42-57, guarded refusal :60-95 with `upgrade head` in `finally`), `test_group_soft_delete_migration.py`, `test_locations_migration.py`, `test_events_migration.py`.
- **tests/conftest.py**: `client` :288-307 with `dependency_overrides`. Override the Google verifier the same way, or sign test ID tokens with a local RSA key and patch the JWKS.
- **Frontend**: `src/test/auth.test.tsx` (LoginPage :142, `?mode` :177, RegisterForm :203-315, AuthContext :317, register GUEST :357, session change :384), `googleMaps.test.ts` (loader test template: `vi.resetModules` :38, `vi.stubEnv` :58, stale tag :134), `ssrSafety.test.tsx:207-220` (LoginPage SSR), `AuthGuard.test.tsx`, `SidebarAuthIntegration.test.tsx`.

### Coverage Assessment
- **Test count**: about 15 relevant backend tests and about 20 relevant frontend tests exist. None covers Google.
- **Gaps**: no tests for `SocialAuthButtons`, a GIS loader, `loginWithGoogle`, the hidden-without-client-ID behaviour, or the Google error line. Nothing covers a NULL password hash, `user_identities`, the nonce cookie, the 403/409/503 paths, or the 0107–0108 migrations.

---

## Coding Patterns

### Naming Conventions
- **Components**: PascalCase files in `src/features/auth/`. Polish UI copy.
- **Functions**: snake_case service functions in Python, camelCase hooks and context methods in TS.
- **Files**: flat `tests/test_<feature>.py` (for example `test_google_login.py`, `test_user_identities_migration.py`). Frontend tests live in `src/test/`.
- **DB**: `pk_user_identities`, `fk_user_identities_user_id_users`, `uq_user_identities_provider_subject`, `uq_user_identities_user_id_provider`. Provider is a string-backed enum via a per-module `_enum_column` (VARCHAR, `native_enum=False`). Migration ids are plain strings `"0107"`/`"0108"`, hand-written (`target_metadata = None`).

### Architecture Patterns
- **Style**: FastAPI routers with service functions, `BaseEntity` (UUID, `updated_at` as `version_id_col`), cross-module FK ids without `relationship()`, typed exceptions mapped centrally, `Depends`-based authorization with a matrix row per route.
- **State Management**: frontend `AuthContext` + localStorage/cookie session, TanStack Query for data. GIS loading as a module-level memoized promise (googleMaps pattern), SSR-safe (`useClientValue`, no browser globals during render).

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | router 87 lines; users/service ~310 lines; SocialAuthButtons ~60; AuthContext ~175 | Low-Medium |
| Dependencies | ~8 imports (users, party, families, security, errors, config, jwt, httpx) | Medium |
| Consumers | ~10 (register, families x2, AuthTabs → 7 surfaces, password-hash readers) | Medium-High |
| Test Coverage | good for login/register; none for social/Google | Medium |

### Overall: Moderate
The work is additive and fits existing patterns (gate, loader, matrix rows, guarded migrations). The extra complexity comes from security-sensitive token verification, the first backend-set cookie, the nullable-hash ripple and the bootstrap refactor shared with families.

---

## Key Findings

### Strengths
- There is a single frontend integration point (`AuthTabs` → `SocialAuthButtons`), and the session plumbing (`applyToken`, `AuthGuard`, `useAccountGate`) already handles a new token.
- Ready templates exist: `googleMaps.ts` loader and tests, `photo_storage_configured` gate, guarded-downgrade migrations and tests, `ServiceUnavailableException` 503, the Polish `BusinessConflictException` 409.
- `/api/*` routing through Next rewrites and nginx needs no change.

### Concerns
- `cryptography` is missing, the hash is NOT NULL, and login crashes on a None hash.
- The registration path has no IntegrityError recovery.
- No proxy-header trust affects the nonce cookie's `Secure` flag.
- The focus trap ignores iframes.
- The docs claim the backend calls no Google endpoint.

### Opportunities
- `bootstrap_person_account` removes the duplicated, hard-coded permissions in register.
- Moving register to DB-loaded permissions aligns both entry points.

---

## Impact Assessment

- **Primary changes**: `app/auth/router.py`, `app/auth/models.py`, new `app/auth/google.py` (verifier + nonce), `app/users/service.py`, `app/users/router.py`, `app/core/security.py` (None-safe verify), `app/config.py`, `app/core/authorization_matrix.py`, migrations 0107/0108, `pyproject.toml`/`uv.lock`; frontend `SocialAuthButtons.tsx`, `AuthTabs.tsx`, `AuthContext.tsx`, new `lib/googleIdentity.ts`.
- **Related changes**: `docker-compose.yml`, `src/frontend/Dockerfile`, both `.env.example` files (placeholders only, no secret values), `architecture.md` + runbook, `tech-stack.md`, possibly `trapFocus.ts`.
- **Test updates**: new `tests/test_google_login.py`, migration tests for 0107/0108, matrix rows, login NULL-hash case, registration regression; frontend loader test, `SocialAuthButtons` tests, `loginWithGoogle` in `auth.test.tsx` mocks, SSR check.

### Risk Level: Medium
Authentication is security-critical (token verification, nonce replay, account takeover through email linking, which ADR-005 prevents). The schema change to `users` has a lossy, guarded downgrade. Existing login and register tests reduce the regression risk, and the feature is off by default behind env gates.

---

## Recommendations

New capability that modifies existing code:
1. **Dependencies and config first**: `pyjwt[crypto]` + `uv.lock`; `Settings.google_client_id: str | None = None` (and a nonce key or a derivation from `jwt_secret`); compose, Dockerfile and `.env.example` placeholders for `GOOGLE_CLIENT_ID` and the `NEXT_PUBLIC_GOOGLE_CLIENT_ID` build arg.
2. **Migrations**: 0107 creates `user_identities` (`id`, timestamps, `user_id` FK → users, `provider` VARCHAR, `subject`, optional `email` snapshot; `uq_(provider, subject)`, `uq_(user_id, provider)`). 0108 makes `password_hash` nullable, with a guarded downgrade that refuses while NULL rows exist, `SET LOCAL lock_timeout`, and a runbook. Write round-trip and refusal tests from the `test_item_visibility_migration.py` template.
3. **Null-safety**: make `verify_password` or the login path treat a None hash as a 401 (same message), and audit every other `password_hash` reader.
4. **Bootstrap refactor**: extract `bootstrap_person_account(db, email, password|None, display_name?, role)` from `register` and make register use it plus `_load_permissions`. `test_registration.py`/`test_families_bootstrap.py` must stay green before any Google code is added.
5. **Verifier**: an async JWKS fetch with httpx, cached with a TTL from Cache-Control and refreshed on an unknown `kid`. RS256 only; `aud` = client id; `iss` in {`accounts.google.com`, `https://accounts.google.com`}; `exp`/`iat` with small leeway; nonce compared to the signed HttpOnly cookie (cleared after use). Expose it as a FastAPI dependency so tests can override it.
6. **Routes**: `GET /api/auth/google/nonce` and `POST /api/auth/google` with the decided outcomes (200/201 `{token, created, party_id}`, 403 unverified, Polish 409 for an existing unlinked email, 503 unconfigured). Wrap creation in `begin_nested` + IntegrityError recovery. Add two PUBLIC matrix rows with tests.
7. **Frontend**: a `googleIdentity.ts` loader on the googleMaps pattern; `SocialAuthButtons` takes `tab`, renders nothing for Google when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset, fetches the nonce, calls `google.accounts.id.initialize`/`renderButton` client-side only, and reports errors in the `LoginForm` alert style (409 reuses the duplicate-email wording with the "Zaloguj się" switch). Add `loginWithGoogle` to `AuthContext` through `applyToken`. Decide on iframe focusability in `trapFocus`.
8. **Docs**: update `architecture.md` (Google JWKS call, auth section, runbook, build args) and `tech-stack.md` env vars.

---

## Next Steps
Invoke the gap-analyzer with this report and the research ADRs. Confirm the open questions (cookie `Secure`/proxy handling, the trapFocus iframe, the audit of other `password_hash` readers) before writing the specification.
