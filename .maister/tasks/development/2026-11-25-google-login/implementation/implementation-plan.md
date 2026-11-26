# Implementation Plan: Google sign-in and sign-up

## TL;DR
9 task groups and 50 steps. Two independent tracks start together: the backend (1 data model and migrations, 2 config, dependency and verifier, then 3 bootstrap and register, then 4 Google service, routes and matrix) and the frontend (6 loader, nonce API and AuthContext, then 7 Google slot UI). Group 5 (deploy config) has no dependencies. Group 8 (docs and standards) waits for 4, 5 and 7, and group 9 (test review and the final run) comes last. Plan no commit steps: leave all work uncommitted.

## Key Decisions
- **The frontend track builds against the spec's contract, not a running backend** — the `{token, created, party_id}` shape, the four Google copies and the 503-as-`null` nonce rule are fixed in the spec, and every frontend test mocks `src/api/auth.ts` and `src/lib/googleIdentity.ts`. So groups 6 and 7 do not depend on groups 1–4.
- **`app/auth/service.py` and `app/auth/router.py` are declared in both group 3 and group 4** — group 3 moves `load_permissions` and adds the NULL-hash login guard, and group 4 adds the Google routes. The dependency 4 → 3 already serializes them, and declaring both keeps the executor's file check honest.
- **Users bootstrap is its own group (3), before the Google service (4)** — `bootstrap_person_account`, `is_email_registered` and the register retry are regression-sensitive and get their own tests before the Google path uses them.
- **Deploy config (5) and docs (8) are verified with checks, not unit tests** — there is no testable code in them. The checks are `docker compose config --quiet` (never the unquiet form, which prints resolved environment values) and key-presence greps.
- **The expected test count goes above the usual ~34** — six code groups at 2–8 tests each give about 38 tests, plus up to 10 gap tests. Parametrized tables count as one test, as the spec's test plan says.
- **The two standards edits go through `/maister:standards-update`** (R18, CLAUDE.md standards-evolution rule), not hand edits.

## Open Questions / Risks
- The 403 copy and the extended 503 copy are still marked as proposals in `design-context/INDEX.md`. The spec's error table makes them binding, and the plan uses them verbatim.
- Backend tests need Docker (testcontainers). Without Docker, groups 1, 3 and 4 cannot verify.
- Baseline failures on HEAD are not regressions: about 33 vitest failures, 2 stale backend tests, mypy 15, ruff 65 and typecheck 0. Typecheck must stay at 0 after `AuthContextValue` gains `loginWithGoogle`.
- Manual checks that no automated test covers: Tab focus and the popup through the GIS iframe in `AuthSheet` at 375 px, and one real sign-in with the dev client ID (never printed). These belong to verification, not to this plan.
- `uv.lock` must be regenerated with `uv lock` from `src/backend` after `pyjwt[crypto]`. A failed lock blocks group 2.

## Overview
Total Steps: 50
Task Groups: 9
Expected Tests: about 38 in the implementation groups, plus up to 10 gap tests (about 38–48), and 4 config and docs checks

**Secrets rule (applies to every group)**: never print or write secret values. No `env`, `printenv`, `cat .env`, unquiet `docker compose config` or `docker inspect` Env. Use presence checks only. `.env.example` files get empty placeholders. The Google client ID is never printed, logged or written into the task folder. No commits.

**Commands**: backend from `src/backend`: `uv run python -m pytest|mypy|ruff` (the uv trampoline breaks `uv run <tool>`). Frontend from `src/frontend`: `npm test -- <files>`, `npm run typecheck` and `npm run lint`.

## Implementation Steps

### Task Group 1: Data Model & Migrations
**Dependencies:** None
**Files to Modify:** src/backend/app/auth/models.py, src/backend/alembic/versions/0107_user_identities.py, src/backend/alembic/versions/0108_nullable_password_hash.py, src/backend/tests/test_user_identities_migration.py
**Estimated Steps:** 5

- [x] 1.0 Complete the data model and migrations layer
  - [x] 1.1 Write 2 focused tests in `tests/test_user_identities_migration.py` (pattern: `tests/test_item_visibility_migration.py`, `_alembic` helper)
    - Round trip 0106 ↔ head: after the upgrade, `user_identities` exists with `pk_user_identities`, `fk_user_identities_user_id_users` (ON DELETE CASCADE), `uq_user_identities_provider_subject`, `uq_user_identities_user_id_provider`, and `users.password_hash` is nullable. After a downgrade to 0106, the table is gone and the column is NOT NULL again.
    - The 0108 downgrade with one NULL-hash user is refused with a `RuntimeError` that names the dump-restore recovery. Run `alembic upgrade head` and `engine.dispose()` in `finally` (`standards/testing/backend-testing.md`).
  - [x] 1.2 Update the ORM in `app/auth/models.py`
    - `User.password_hash: Mapped[str | None]`
    - `IdentityProvider(StrEnum)` with only `GOOGLE`, and a local `_enum_column` copy (reuse the pattern from `app/events/models.py:35`)
    - `UserIdentity(BaseEntity)`: `user_id` (plain FK id, no `relationship()`), `provider` VARCHAR(20), `subject` VARCHAR(255) case-sensitive, `email` VARCHAR(255) nullable (non-unique snapshot), `email_verified` bool NOT NULL, and both unique constraints named as in the migration
  - [x] 1.3 Write migration `0107_user_identities.py` (down_revision 0106)
    - Start the upgrade with `SET LOCAL lock_timeout = '5s'` (the FK takes a `SHARE ROW EXCLUSIVE` lock on `users`)
    - Reuse `_id`/`_timestamps` from `0103_points_tables.py`; UUID PK with `gen_random_uuid()`; explicit `pk_`/`fk_`/`uq_` names
    - The downgrade is a plain `drop_table`
  - [x] 1.4 Write migration `0108_nullable_password_hash.py`
    - Upgrade: `SET LOCAL lock_timeout = '5s'`, then `alter_column("users", "password_hash", nullable=True)`
    - Downgrade: `SET LOCAL lock_timeout = '5s'`, count `password_hash IS NULL` rows, and when the count is > 0 raise `RuntimeError` naming the recovery (restore the pre-0108 dump; no account-deletion or set-password path exists). Otherwise restore NOT NULL. Follow the guard pattern in `0076_*.py:55-85`.
  - [x] 1.5 Ensure the migration tests pass
    - Run only `uv run python -m pytest tests/test_user_identities_migration.py`

**Acceptance Criteria:**
- The 2 tests pass
- `alembic heads` shows a single head, 0108
- No `relationship()` on `UserIdentity`, and the names match `standards/backend/migrations.md`

### Task Group 2: Backend Config, Dependency & Google Verifier
**Dependencies:** None
**Files to Modify:** src/backend/app/config.py, src/backend/pyproject.toml, src/backend/uv.lock, src/backend/app/auth/google.py, src/backend/tests/test_google_token_verifier.py
**Estimated Steps:** 6

- [x] 2.0 Complete the config, dependency and verifier layer
  - [x] 2.1 Write 7 focused tests in `tests/test_google_token_verifier.py`
    - Sign RS256 tokens with an RSA key generated once per module (`cryptography`), served by a fake `fetch_jwks` on a fresh `GoogleTokenVerifier`. No network.
    - A valid token returns `GoogleClaims` (email normalized, `name` passed through)
    - A parametrized 401 table, `GoogleTokenInvalid`: HS256 and `none` alg, a foreign key's signature, an unknown `kid` after the refresh, a bad `iss`, a bad `aud`, an `azp` mismatch, expired, `iat` in the future, a missing `nonce`, a non-str `nonce`, a non-ASCII `nonce`, a nonce mismatch, a missing `email`
    - `email_verified: "true"` gives `email_verified is False`
    - An unknown `kid` refreshes once and then succeeds; a second miss within 60 s of the injected clock does not refetch. Two verifier instances share no keys.
    - A JWKS failure (timeout, non-200, body without `keys`) raises `GoogleKeysUnavailable` and logs exactly one WARNING (caplog) that contains neither the credential nor the email
    - Nonce cookie: the round trip passes; a tampered cookie, an expired cookie and a cookie signed with the plain JWT key are all rejected
  - [x] 2.2 Add the settings and the dependency
    - `Settings.google_client_id: str | None` (empty counts as unset), `Settings.auth_cookie_secure: bool = True`, and the property `google_login_configured = bool(google_client_id)` (pattern: `photo_storage_configured`)
    - In `pyproject.toml`, change `pyjwt>=2.13.0` to `pyjwt[crypto]>=2.13.0`, then run `uv lock` from `src/backend` and keep the regenerated `uv.lock`
    - **Secrets rule**: do not print settings or the environment; check presence only
  - [x] 2.3 Write the nonce cookie helpers in `app/auth/google.py`
    - `NONCE_COOKIE_NAME = "aj_google_nonce"`, `NONCE_TTL_SECONDS = 600`, `new_nonce()` = `secrets.token_urlsafe(32)`
    - Purpose key: `HMAC-SHA256(base64-decoded JWT_SECRET, "aj google-nonce cookie v1")`. `encode_nonce_cookie(nonce)` makes a compact HS256 JWT `{nonce, iat, exp, aud: "aj:google-nonce"}`. `read_nonce_cookie(value) -> str` raises `GoogleTokenInvalid` on a missing, tampered or expired cookie or a wrong `aud`.
    - `set_nonce_cookie(response, value)` and `clear_nonce_cookie(response)` share one attribute set: `HttpOnly`, `SameSite=Lax`, `Path=/api/auth/google`, `Max-Age=600` on the set, and `Secure=settings.auth_cookie_secure`
  - [x] 2.4 Write `GoogleTokenVerifier(client_id, fetch_jwks, clock=time.monotonic)`
    - Instance state: the `kid → PyJWK` dict, the expiry (1 h TTL), the last-fetch time and an `asyncio.Lock`, so concurrent misses fetch once. An unknown `kid` forces one refresh, at most once every 60 s by the injected clock. Keys whose `alg` is not RS256 are skipped.
    - `async verify(credential, expected_nonce) -> GoogleClaims`: RS256 only, `iss` in {`accounts.google.com`, `https://accounts.google.com`}, `aud` equal to the client ID, `azp` equal to it when present, 30 s leeway. Required claims are `iss`, `aud`, `sub`, `exp`, `iat` and `nonce`. The `nonce` must be a `str` and is compared with `hmac.compare_digest` over UTF-8 bytes. `email` is required and `email_verified` counts only when it `is True`. The email goes through `normalize_email`.
    - `fetch_google_jwks()` uses async `httpx` with a 5 s timeout against `https://www.googleapis.com/oauth2/v3/certs`, and `get_google_verifier()` returns one lazily built process-wide instance
  - [x] 2.5 Define the exceptions and logging
    - `GoogleTokenInvalid(reason)`, `GoogleKeysUnavailable`, and the `GoogleClaims {subject, email, email_verified, name}` dataclass
    - A fetch failure logs one WARNING. The rejection line (`google sign-in rejected: reason=<code>`, INFO) is logged by the route in group 4. No log line contains the credential, the cookie, the nonce or the email.
  - [x] 2.6 Ensure the verifier tests pass
    - Run only `uv run python -m pytest tests/test_google_token_verifier.py`

**Acceptance Criteria:**
- The 7 tests pass with no network access
- `uv.lock` includes `cryptography`
- `google_login_configured` is false when the client ID is unset or empty

### Task Group 3: Users Bootstrap, Register & Password Login Guard
**Dependencies:** 1
**Files to Modify:** src/backend/app/auth/service.py, src/backend/app/auth/router.py, src/backend/app/users/service.py, src/backend/app/users/router.py, src/backend/tests/test_registration.py, src/backend/tests/test_login.py
**Estimated Steps:** 6

- [x] 3.0 Complete the shared bootstrap and the register and login regressions
  - [x] 3.1 Write 6 focused tests (in `tests/test_registration.py` and `tests/test_login.py`)
    - The register token's permissions come from the DB (decode the JWT; for example, an extra permission granted in the DB appears)
    - A mixed-case stored profile email (`Jan@X.pl`, then registering `jan@x.pl`) gets the Polish 409
    - A simulated duplicate-email race (pre-check stubbed, the insert hits the unique index) gets the Polish 409, not the English "Data integrity violation"
    - A username collision on the first attempt is retried with a fresh username and gets 201
    - A second unclassified `IntegrityError` maps to `DuplicateEmailException` (Polish 409)
    - A NULL-hash user on `POST /api/auth/login` gets exactly `{status: 401, error: "Unauthorized", message: "Invalid username or password"}` (exact key set), never a 500
  - [x] 3.2 Create `app/auth/service.py` with `load_permissions(db, user_id)`, moved from `app/auth/router.py::_load_permissions`
    - Login uses it, and before `verify_password` it returns the existing hand-built 401 when `user.password_hash is None`. `verify_password` stays strict, because OAuth2 client-secret checks also call it.
    - Password login's own email lookup (`app/auth/router.py:60`) stays as it is (out of scope)
  - [x] 3.3 Extend `app/users/service.py`
    - `create_account` and `create_account_and_profile` accept `password: str | None`, where `None` stores a NULL hash. The families callers (`app/families/bootstrap.py:58`, `app/families/guardians.py:32`) do not change.
    - `is_email_registered(db, email)`: `func.lower(UserProfile.email) == normalize_email(email)`, served by `uq_user_profiles_email_lower`
    - Make `_derive_display_name` public as `derive_display_name`
    - `bootstrap_person_account(db, *, email, password: str | None, display_name: str | None = None) -> tuple[User, Party]`: the duplicate check through `is_email_registered`, which raises `DuplicateEmailException`, then `derive_username_from_email`, `create_account_and_profile` (Party PERSON, profile, `UserRole(USER)`, READ/EDIT) and `create_solo_family_for_party` (a deferred import, as today). It flushes but does not commit.
  - [x] 3.4 Refactor `service.register` onto the bootstrap
    - Run it inside `begin_nested()` and keep the ORGANIZER role grant
    - On `IntegrityError`: roll back the savepoint and re-read with `is_email_registered`; if the email is taken, raise `DuplicateEmailException`. Otherwise retry once in a fresh savepoint with a freshly derived username. A second `IntegrityError` always maps to `DuplicateEmailException`. Pattern: `app/events/service.py:401-408`.
  - [x] 3.5 Make `app/users/router.py` mint the register token with `load_permissions` instead of the hard-coded `["READ","EDIT"]`
    - The response stays `{token, party_id, role}` with status 201
  - [x] 3.6 Ensure the bootstrap tests pass
    - Run only `tests/test_registration.py`, `tests/test_login.py` and `tests/test_families_bootstrap.py` (the last one unchanged; it must stay green)

**Acceptance Criteria:**
- The 6 tests pass and `test_families_bootstrap.py` stays green
- Nothing imports `_load_permissions` any more; login and register both use `load_permissions`
- `app.users.service` does not import `app.auth.service` (no cycle)

### Task Group 4: Google Sign-In Service, Routes & Authorization Matrix
**Dependencies:** 1, 2, 3
**Files to Modify:** src/backend/app/auth/service.py, src/backend/app/auth/router.py, src/backend/app/core/authorization_matrix.py, src/backend/tests/test_google_login.py, src/backend/tests/test_authorization_matrix.py
**Estimated Steps:** 5

- [x] 4.0 Complete the Google sign-in API layer
  - [x] 4.1 Write 8 focused tests in `tests/test_google_login.py`, and extend the matrix table in `tests/test_authorization_matrix.py`
    - Test setup: monkeypatch `settings.google_client_id`. A fresh verifier with a fake `fetch_jwks` goes in through `app.dependency_overrides[get_google_verifier]`. The nonce-then-sign-in flows monkeypatch `settings.auth_cookie_secure = False`, because httpx does not send `Secure` cookies to `http://test`.
    - (1) `POST /api/auth/google/nonce` with `{}`: 200 `{nonce}`, `Cache-Control: no-store`, and a `Set-Cookie` with HttpOnly, SameSite=Lax, `Path=/api/auth/google`, `Max-Age=600`, and `Secure` on or off (parametrized)
    - (2) The nonce POST without a body, or with a form content type, gets 400 and no `Set-Cookie`
    - (3) The first sign-in gets 201 with the exact key set `{token, created, party_id}`, a NULL hash, one identity row, the GUEST role, a solo family and the Google name. A second sign-in gets 200 with the same username and a refreshed `email` snapshot.
    - (4) A refusal table: an existing profile email gets the 409 copy with no identity written, also with a mixed-case stored email; an unverified email gets the 403 copy; a missing cookie gets the 401 copy with the cookie cleared under the same Path, Secure, HttpOnly and SameSite
    - (5) Unconfigured: both routes get the Polish 503, and the nonce route sets no cookie
    - (6) ADMIN granted in the DB is present in the Google token, and the token works for `GET /api/people/me`
    - (7) A rejected name moderation (`TextModerationRejected`, `ModerationUnavailable`) falls back to the email-derived name
    - (8) A race table: an identity race (pre-check stubbed) gets the re-read 200; a username race on the first attempt is retried and gets 201; two unclassified failures get the generic 401 with the cookie cleared
    - Matrix: POST nonce and POST google resolve to `PUBLIC`; GET nonce and GET `/api/auth/google` resolve to `AUTHENTICATED`
  - [x] 4.2 Write `sign_in_with_google(db, claims) -> GoogleSignIn {user, party_id, created}` in `app/auth/service.py`
    - Exceptions: `GoogleEmailTaken(BusinessConflictException)`, `GoogleEmailUnverified(AccessDeniedException)` and `GoogleSignInFailed`
    - Resolution order (R4): if the identity `(GOOGLE, sub)` exists, log in and refresh `email`/`email_verified` when they changed; an unverified email raises 403; `is_email_registered` raises 409; otherwise run `bootstrap_person_account(password=None, display_name=…)` plus an identity insert in one `begin_nested()`, then commit
    - On `IntegrityError`: re-read (an identity means a login, a taken email means a 409), else retry once in a fresh savepoint with the already moderated name, else raise `GoogleSignInFailed`
    - `_google_display_name(name, email)`: collapse whitespace, cut to 255 characters, run `check_text(TextField.PROFILE_NAME)` outside the savepoint, and fall back to `derive_display_name` when the name is empty, rejected or moderation is unavailable
  - [x] 4.3 Add the routes to `app/auth/router.py`
    - `GoogleNonceRequest` (no fields, `extra="forbid"`), `GoogleSignInRequest {credential: str, 1–4096}` and `GoogleSignInResponse {token, created, party_id}`
    - `POST /google/nonce`: the 503 gate, then `new_nonce`, `set_nonce_cookie` and `no-store`
    - `POST /google` with `Depends(get_google_verifier)`: gate, read the cookie, `verify`, `sign_in_with_google`, `load_permissions`, `encode_login_token`, then 200 or 201
    - One mapping table builds `ErrorResponse` JSON in the route, the way login builds its 401: `GoogleTokenInvalid`, `GoogleSignInFailed` and `StaleDataError` (after a rollback) give 401; `GoogleEmailUnverified` gives 403; `GoogleEmailTaken` and `DuplicateEmailException` give 409; `GoogleKeysUnavailable` and unconfigured give 503. Use the Polish copies from the spec's error table verbatim.
    - Every response the route builds, success included, calls `clear_nonce_cookie`. Log one INFO `google sign-in rejected: reason=<code>` (including `reason=bootstrap_conflict`), with no credential, cookie, nonce or email.
  - [x] 4.4 Add matrix rows to `app/core/authorization_matrix.py`
    - `# 72` `(_methods("POST"), r"^/api/auth/google/nonce$", "PUBLIC")` and `# 73` `(_methods("POST"), r"^/api/auth/google$", "PUBLIC")`, placed directly after row 47
    - A comment above them names them as auth-flow routes that set or clear the nonce cookie and read no data, so the comment at `:222-225` stays true
  - [x] 4.5 Ensure the Google endpoint tests pass
    - Run only `tests/test_google_login.py` and `tests/test_authorization_matrix.py`

**Acceptance Criteria:**
- The 8 tests and the extended matrix table pass
- No route outcome returns an English message, a 500, or a duplicate `users`/`user_identities` row
- Every 200, 201, 401, 403, 409 and 503 from `POST /api/auth/google` carries the clearing `Set-Cookie` with the full attribute set

### Task Group 5: Deploy Configuration
**Dependencies:** None
**Files to Modify:** docker-compose.yml, src/frontend/Dockerfile, .env.example, src/frontend/.env.example
**Estimated Steps:** 5

- [x] 5.0 Complete the deploy configuration
  - [x] 5.1 Write 2 verification checks (no unit tests apply)
    - `docker compose config --quiet` exits 0. **Never run it without `--quiet`**, because the full output prints resolved environment values.
    - A grep shows `GOOGLE_CLIENT_ID=`, `AUTH_COOKIE_SECURE=` and `NEXT_PUBLIC_GOOGLE_CLIENT_ID=` with empty values in the `.env.example` files. Check key names only; never read or print `.env`.
  - [x] 5.2 Update `docker-compose.yml`
    - `backend.environment`: `GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}` and `AUTH_COOKIE_SECURE: ${AUTH_COOKIE_SECURE:-true}`
    - `web.build.args`: `NEXT_PUBLIC_GOOGLE_CLIENT_ID: ${NEXT_PUBLIC_GOOGLE_CLIENT_ID:-}`
  - [x] 5.3 Update `src/frontend/Dockerfile`
    - Add `ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=` and the matching `ENV`, next to the Maps key
  - [x] 5.4 Update the root `.env.example` and `src/frontend/.env.example`
    - Empty placeholders only, with a comment: the two IDs hold the same OAuth Web client ID; `AUTH_COOKIE_SECURE=false` is needed over http (dev `:5173`, compose `:5174`, Safari); rebuild `web` after a change. **Never real values.**
  - [x] 5.5 Ensure the deploy checks pass
    - Run only the 2 checks from 5.1

**Acceptance Criteria:**
- Both checks pass
- No secret value appears in any file, command output or the task folder

### Task Group 6: Frontend GIS Loader, Nonce API & AuthContext
**Dependencies:** None
**Files to Modify:** src/frontend/src/lib/googleIdentity.ts, src/frontend/src/api/auth.ts, src/frontend/src/auth/AuthContext.tsx, src/frontend/src/test/googleIdentity.test.ts, src/frontend/src/test/authApi.test.ts, src/frontend/src/test/auth.test.tsx, src/frontend/src/test/CategoryListPage.test.tsx, src/frontend/src/test/Sidebar.test.tsx, src/frontend/src/test/useItemActions.test.tsx
**Estimated Steps:** 6

- [x] 6.0 Complete the frontend loader, API and session layer
  - [x] 6.1 Write 7 focused tests (explicit `import { describe, expect, it, vi } from "vitest"`, `vi.resetAllMocks()` in `beforeEach`, typed fixtures with no casts)
    - `googleIdentity.test.ts` (pattern: `src/test/googleMaps.test.ts`, `vi.resetModules`, `vi.stubEnv`): (1) without a client ID it returns `null` and injects no script; (2) it injects exactly one `#google-identity-services` script and memoizes; (3) a script error and the 10 s timeout are forgotten, so a retry loads again; (4) a stale loaded tag is replaced and a pending one is reused
    - `authApi.test.ts`: (5) `getGoogleNonce` POSTs `{}` to `/auth/google/nonce` and returns the nonce; (6) it returns `null` on a 503 `ApiError` and rethrows other errors
    - `auth.test.tsx`: (7) `loginWithGoogle` stores the token through `applyToken` and returns `{created}` on success, and throws an `ApiError` with the status on failure
  - [x] 6.2 Write `src/lib/googleIdentity.ts`, cloned from `googleMaps.ts`
    - `isGoogleLoginConfigured()` reads `process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID` on every call
    - `loadGoogleIdentity(): Promise<GoogleIdApi | null>` is memoized and injects `<script id="google-identity-services" src="https://accounts.google.com/gsi/client" async>`. It is ready when `window.google?.accounts?.id` exists, resolves `null` on no client ID, an error or the 10 s timeout, and forgets a failure. Narrow local types; no new `@types` package; nothing runs at import time.
  - [x] 6.3 Write `src/api/auth.ts` with `getGoogleNonce(): Promise<string | null>` over `api.post("/auth/google/nonce", {})`
    - `null` on a 503 (`hasStatus` from `api/problem.ts`), rethrow otherwise. Plain module function, not a query or mutation hook (the recorded exception).
  - [x] 6.4 Add `AuthContext.loginWithGoogle(credential): Promise<{created: boolean}>`
    - A raw same-origin `fetch` POST to `/api/auth/google` with JSON, like `login`/`register`. On a non-OK response throw `ApiError(status, statusText, parsedBodyOrNull)`; on success call `applyToken(token)` and return `{created}`. Add the method to the `AuthContextValue` type.
  - [x] 6.5 Update the typed `useAuth` mocks
    - `auth.test.tsx` mock type and defaults (`:29-48`, `:91-99`), and `loginWithGoogle: vi.fn()` in the full-shape mocks in `CategoryListPage.test.tsx:72-81`, `Sidebar.test.tsx:28-37` and `useItemActions.test.tsx:26-35`. Partial `as ReturnType<typeof useAuth>` casts stay as they are.
  - [x] 6.6 Ensure the layer tests pass
    - Run only `npm test -- src/test/googleIdentity.test.ts src/test/authApi.test.ts src/test/auth.test.tsx src/test/CategoryListPage.test.tsx src/test/Sidebar.test.tsx src/test/useItemActions.test.tsx`, then `npm run typecheck` (must stay at 0)

**Acceptance Criteria:**
- The 7 tests pass and the three touched mock files keep their previous results
- `npm run typecheck` reports 0 errors
- No GIS script is injected at import time or without a client ID

### Task Group 7: Frontend Google Slot UI
**Dependencies:** 6
**Files to Modify:** src/frontend/src/features/auth/useGoogleSignIn.ts, src/frontend/src/features/auth/SocialAuthButtons.tsx, src/frontend/src/features/auth/AuthTabs.tsx, src/frontend/src/test/SocialAuthButtons.test.tsx, src/frontend/src/test/ssrSafety.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/login-tab-google-button.html
  element: screen:login-tab-google-button
  locator: `.gis-slot`, `.status`, `.divider` styles around lines 196–232; markup lines 236–242 (tabs, `.gis-slot`, `<p class="status" role="status">`, divider, form)
  acceptance: on the login tab the order is tabs, then a centered GIS pill slot (`flex min-h-11 justify-center`, GIS text `signin_with`, width clamped to 200–400 px), then the empty `role="status"` line (`mt-2 min-h-4.5 text-center text-xs text-ink-soft`), then the "lub emailem" divider (unchanged markup), then the `LoginForm`; no Facebook button, no "wkrótce" text
- mockup: analysis/design-context/mockups/register-tab-google-button.html
  element: screen:register-tab-google-button
  locator: markup lines 236–242 (register tab active, `.gis-slot`, status, divider)
  acceptance: the same slot with the GIS text `signup_with` ("Zarejestruj się przez Google"); the slot, status line and divider positions are identical to the login tab
- mockup: analysis/design-context/mockups/authsheet-mobile-item-page.html
  element: screen:authsheet-mobile-item-page
  locator: `.sheet`/`.sheet-h` styles lines 226–228; sheet markup from line 236 ("Potrzebne konto" header, tabs, slot, divider, form)
  acceptance: at 375 px inside the unchanged `AuthSheet`/`ModalSheet`, the button sits above the email form with no horizontal overflow (the width clamp respects the slot); on success the sheet closes through the existing token reaction; `trapFocus.ts` is unchanged
- mockup: analysis/design-context/mockups/loading-placeholder.html
  element: screen:loading-placeholder
  locator: skeleton styles in the 196–232 style block; markup lines 236–240 (skeleton in the slot, `<p class="status" role="status">`, divider)
  acceptance: in `loading`, a 44 px pill skeleton (`bg-line`, full width up to `max-w-[400px]`, `aria-hidden`) fills the slot, with the empty status line and the divider visible; the email form does not move when the state changes to `ready`
- mockup: analysis/design-context/mockups/conflict-409-register-tab.html
  element: screen:conflict-409-register-tab
  locator: markup line 239 (`<div class="alert" role="alert">` with the inline button)
  acceptance: on the register tab, the 409 copy "Konto z tym adresem już istnieje — zaloguj się hasłem." renders in the status line's place, with an inline underlined `type="button"` "Zaloguj się" that calls `onSwitchToLogin`; on the login tab the same copy renders without the switch
- mockup: analysis/design-context/mockups/google-error-messages.html
  element: screen:google-error-messages
  locator: the three `.card` blocks at lines 236–238 (401, 403, 503)
  acceptance: the 401 generic, 403 unverified and 503 unavailable copies render verbatim from the spec's error table, in the alert under the button and above the divider; a foreign message or status shows the 401 copy
- mockup: analysis/design-context/mockups/google-unavailable-email-only.html
  element: screen:google-unavailable-email-only
  locator: markup lines 236–237 (tabs followed directly by `<form>`)
  acceptance: with no client ID, or a nonce 503, or a GIS failure, nothing renders (no slot, no status line, no divider) and no GIS script tag exists; the email form sits directly under the tabs
- mockup: analysis/design-context/mockups/login-tab-google-button.html
  element: component:google-signin-slot
  locator: `.gis-slot`/`.status`/`.divider` styles lines 196–232 and markup lines 238–240
  acceptance: the `mb-4` wrapper holds the slot (200–400 px button, centered), then either the empty status line or the alert, then the divider, using only theme tokens (no hex colours)
- mockup: analysis/design-context/mockups/conflict-409-register-tab.html
  element: component:google-error-alert
  locator: `.alert` styles in the 196–232 style block; markup line 239
  acceptance: `role="alert"` with `mt-2 rounded-2xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger` (the same classes as the `LoginForm`/`RegisterForm` alerts), and the inline switch styled like `RegisterForm.tsx:69-76`
**Estimated Steps:** 7

- [x] 7.0 Complete the Google slot UI
  - [x] 7.1 Write 8 focused tests in `src/test/SocialAuthButtons.test.tsx` and one case in `src/test/ssrSafety.test.tsx`
    - Mock `src/api/auth.ts` and `src/lib/googleIdentity.ts` with `vi.mock` factories. A typed fake `google.accounts.id` captures the `initialize` callback. Use `renderWithRoute`.
    - (1) Without a client ID nothing renders, not even the divider; (2) `loading` shows the `aria-hidden` skeleton, an empty `role="status"` line and the divider; a nonce 503 renders nothing
    - (3) `renderButton` options per tab: `text` is `signin_with` or `signup_with`, `locale: "pl"`, `shape: "pill"`, and the width is clamped to 200–400; a tab change re-renders the button
    - (4) The callback calls `loginWithGoogle(credential)` and ignores a second callback while the POST is in flight
    - (5) A 409 with the matching copy shows the copy, plus the switch on the register tab only, and the switch calls `onSwitchToLogin`; a 409 with "Data integrity violation" shows the generic copy and no switch
    - (6) A failure re-fetches the nonce and calls `initialize` + `renderButton` again; a failed re-fetch after an error renders only the alert (no slot, no status line, no divider)
    - (7) The 9-minute timer re-fetches (`vi.useFakeTimers`); it skips while `visibilityState` is hidden or a POST is in flight, and a stale nonce is refreshed on `visibilitychange` to visible
    - (8) SSR: `/login` `renderToString` with the client ID stubbed does not throw, contains the skeleton and contains no script tag
  - [x] 7.2 Write the hook `features/auth/useGoogleSignIn.ts`
    - `useGoogleSignIn(tab)` returns `{status: "hidden" | "loading" | "ready", slotRef, error: {message, isConflict} | null}`
    - Effects only: configured? → `getGoogleNonce()` → `loadGoogleIdentity()` → `initialize({client_id, nonce, callback, ux_mode: "popup", auto_select: false})` → `renderButton(slot, {type: "standard", theme: "outline", shape: "pill", size: "large", logo_alignment: "left", locale: "pl", text, width: clamp(slot.clientWidth, 200, 400)})`; no `prompt()`
    - The four Google copies sit in one constant keyed by status (401/403/409/503); the backend `message` is shown only when it equals that status's copy, otherwise the 401 copy; `isConflict` only for a matched 409
    - On failure: show the alert, fetch a new nonce, `initialize` + `renderButton` again, never retry the POST; clear the alert on a tab change and on the next attempt; a failed re-fetch gives `hidden` with the alert kept
    - Document the single-live-instance assumption (the GIS callback is page-global)
  - [x] 7.3 Add the nonce refresh to the hook
    - A timer 9 minutes after each nonce; when it fires while `document.visibilityState === "hidden"`, a POST is in flight or `document.hasFocus()` is false, only mark the nonce stale
    - On `visibilitychange` to visible and on window `focus`, refresh a stale nonce (new nonce, `initialize`, `renderButton`) unless a POST is in flight
    - Remove the timer and both listeners on unmount
  - [x] 7.4 Rewrite `features/auth/SocialAuthButtons.tsx` as `SocialAuthButtons({tab, onSwitchToLogin})`
    - Render only from the hook state, inside the existing `mb-4` wrapper: `hidden` without an error renders nothing; `hidden` with an error renders the alert alone; `loading` renders the skeleton, the status line and the divider; `ready` renders the GIS slot, the status line or the alert, and the divider
    - Keep the divider markup verbatim (`SocialAuthButtons.tsx:52-56`); remove the Facebook mock, `FacebookMark`, `GoogleMark` and the "wkrótce" text; theme tokens only
  - [x] 7.5 Update `features/auth/AuthTabs.tsx` to pass `tab` and `() => onSelect("login")`
    - `LoginForm`, `RegisterForm`, `AuthSheet`, `AuthGuard`, `session.ts` and `proxy.ts` do not change
  - [x] 7.6 Self-check each Visual References `acceptance` item against its mockup
    - Read each mockup's locator region and compare the class strings, the order (slot → status/alert → divider → form), the copies and the hidden state
  - [x] 7.7 Ensure the UI tests pass
    - Run only `npm test -- src/test/SocialAuthButtons.test.tsx src/test/ssrSafety.test.tsx`, then `npm run typecheck` (0) and `npm run lint` (no new findings in the touched files)

**Acceptance Criteria:**
- The 8 tests pass
- The implementation matches each `acceptance` criterion in Visual References
- The server render and the first client render match, with no browser globals during render
- No hex colours in the new markup, so `themeDefects`/`themeTokenUsage` stay clean

### Task Group 8: Documentation & Standards
**Dependencies:** 4, 5, 7
**Files to Modify:** .maister/docs/project/tech-stack.md, .maister/docs/project/architecture.md, .maister/docs/standards/frontend/data-fetching.md, .maister/docs/standards/backend/security.md, .maister/docs/INDEX.md
**Estimated Steps:** 6

- [x] 8.0 Complete the documentation
  - [x] 8.1 Write 2 verification checks (no unit tests apply)
    - `architecture.md` no longer claims that the backend calls neither Google (the old `:535` sentence), and contains a 0107–0108 runbook heading
    - `INDEX.md`, `tech-stack.md` and `architecture.md` each mention `GOOGLE_CLIENT_ID`, `AUTH_COOKIE_SECURE` or `NEXT_PUBLIC_GOOGLE_CLIENT_ID` by name only, with no values
  - [x] 8.2 Update `tech-stack.md`
    - `pyjwt[crypto]`/`cryptography`, and the three env vars with their roles (names only)
  - [x] 8.3 Update `architecture.md`
    - The Google sign-in flow in the auth section (nonce POST and cookie, GIS popup, local JWKS verification, the resolution policy, the 409 with no auto-link, the GUEST bootstrap)
    - Fix `:535` and touch `:157`, `:159`, `:532` and `:619` (the build arg)
    - Add a **0107–0108 runbook**: `pg_dump` first; the guard count `SELECT count(*) FROM users WHERE password_hash IS NULL`; `downgrade 0106` from the new image is refused while the count is > 0, and the recovery is a dump restore; there is no image-only rollback past 0108 once Google accounts exist (in compose an old image fails to start, because `docker-compose.yml:28` runs `alembic upgrade head` and cannot find 0108; started without migrations it would answer 500 on password login for NULL-hash users)
  - [x] 8.4 Record the two standards edits through `/maister:standards-update`
    - `standards/frontend/data-fetching.md`: the nonce POST is an imperative `src/api/auth.ts` call from `useGoogleSignIn`, not a query or mutation hook, because each call rotates a cookie
    - `standards/backend/security.md`: auth-flow cookies are HttpOnly, signed with a purpose key, get `Secure` from `AUTH_COOKIE_SECURE`, sit on a narrow `Path`, are set only by a PUBLIC POST that requires a JSON body, and are cleared with the same attributes; they are not a data read, so the `/api/public/` rule does not apply
    - If the skill cannot run non-interactively in the executor, draft both edits and flag them to the user instead of hand-editing silently
  - [x] 8.5 Update `INDEX.md` summary lines for tech stack, architecture, security and data fetching
  - [x] 8.6 Ensure the docs checks pass
    - Run only the 2 checks from 8.1

**Acceptance Criteria:**
- Both checks pass
- The runbook covers the dump, the guard count, the refused downgrade and the no-image-only-rollback rule
- No secret values in any doc

### Task Group 9: Test Review & Gap Analysis
**Dependencies:** 1, 2, 3, 4, 5, 6, 7, 8
**Files to Modify:** src/backend/tests/test_google_login.py, src/backend/tests/test_google_token_verifier.py, src/backend/tests/test_registration.py, src/frontend/src/test/SocialAuthButtons.test.tsx, src/frontend/src/test/auth.test.tsx
**Estimated Steps:** 4

- [x] 9.0 Review the feature tests and fill critical gaps
  - [x] 9.1 Review the about 38 tests from groups 1–7 against the spec's test plan and the 9 success criteria
  - [x] 9.2 Analyze gaps for this feature only
    - Candidates: the 4096-character credential cap (400), `StaleDataError` on a concurrent snapshot refresh (401), the INFO/WARNING lines never containing the email or credential, the OAuth2 consent pass-through with a Google token, a 503 from `/google` reaching the UI as the 503 copy
  - [x] 9.3 Write up to 10 additional strategic tests, only for the gaps that matter
  - [x] 9.4 Run the feature-specific tests and the static checks
    - Backend (`src/backend`): `uv run python -m pytest tests/test_user_identities_migration.py tests/test_google_token_verifier.py tests/test_google_login.py tests/test_registration.py tests/test_login.py tests/test_families_bootstrap.py tests/test_authorization_matrix.py`, then `uv run python -m mypy app` (baseline 15, no new errors in the touched files) and `uv run python -m ruff check` (baseline 65, no new findings in the touched files)
    - Frontend (`src/frontend`): `npm test -- src/test/googleIdentity.test.ts src/test/authApi.test.ts src/test/auth.test.tsx src/test/SocialAuthButtons.test.tsx src/test/ssrSafety.test.tsx src/test/CategoryListPage.test.tsx src/test/Sidebar.test.tsx src/test/useItemActions.test.tsx`, `npm run typecheck` (0) and `npm run lint`
    - Do not run the entire suites; the known baseline (about 33 vitest failures, 2 stale backend tests) is not a regression

**Acceptance Criteria:**
- All feature tests pass (about 38–48 in total)
- No more than 10 additional tests are added
- Typecheck stays at 0, and mypy and ruff add nothing over their baselines in the touched files

## Execution Order

1. Group 1: Data Model & Migrations (5 steps, no dependencies)
2. Group 2: Backend Config, Dependency & Google Verifier (6 steps, no dependencies)
3. Group 5: Deploy Configuration (5 steps, no dependencies)
4. Group 6: Frontend GIS Loader, Nonce API & AuthContext (6 steps, no dependencies)
5. Group 3: Users Bootstrap, Register & Password Login Guard (6 steps, depends on 1)
6. Group 7: Frontend Google Slot UI (7 steps, depends on 6)
7. Group 4: Google Sign-In Service, Routes & Authorization Matrix (5 steps, depends on 1, 2, 3)
8. Group 8: Documentation & Standards (6 steps, depends on 4, 5, 7)
9. Group 9: Test Review & Gap Analysis (4 steps, depends on all)

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- global/: error-handling (typed exceptions, a 503 with one WARNING, Polish user messages, details in logs only), validation (server-side body validation, `normalize_email` before comparing), minimal-implementation (no link/unlink, One Tap, avatar or rate limit), coding-style, commenting
- backend/: models.md (`BaseEntity`, string-backed enum, plain FK id, `pk_`/`fk_`/`uq_` names), migrations.md (two small revisions, `lock_timeout`, a guarded downgrade, a round-trip test, a runbook), security.md (two PUBLIC POST matrix rows with tests, no side-effecting GET, unchanged login JWT claims), api.md, queries.md (parameterized SQLAlchemy, savepoints)
- frontend/: components.md (feature code in `src/features/auth/`, a state-bound flow in a dedicated hook, SSR-safe effects), accessibility.md (`role="alert"`, the reserved `role="status"` line, a real `type="button"` switch, an `aria-hidden` skeleton), data-fetching.md (the API wrapper in `src/api/auth.ts`, with the recorded exception), css.md (theme tokens only)
- testing/: backend-testing.md (testcontainers, `test_<operation>_<scenario>_<expected>`, exact key sets, a migration refusal restoring head), frontend-testing.md (explicit vitest imports, `vi.resetAllMocks()`, typed fixtures, `renderWithRoute`, the `ssrSafety` case)
- CLAUDE.md secrets rule: placeholders and presence checks only; the client ID is never printed. No commits.

## Notes

- Test-driven: each code group starts with 2–8 tests; the config and docs groups start with checks
- Run incrementally: only the new and touched tests after each group
- Mark progress: check off steps as they are completed
- Reuse first: `encode_login_token`, `normalize_email`, `create_account_and_profile`, `create_solo_family_for_party`, `check_text`, the `events/service.py` savepoint pattern, `googleMaps.ts`, `applyToken`, `ApiError`, and the existing alert and divider classes
- No commits: leave the work uncommitted (user instruction)
