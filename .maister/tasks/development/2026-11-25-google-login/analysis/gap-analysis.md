# Gap Analysis: Google sign-in and sign-up

## TL;DR
Nothing for Google login exists yet. The research ADRs and the Phase 1 clarifications already settle every architectural and scope choice. The work is an additive feature (two routes, a verifier, a resolver, one table, a nullable column, a real button) plus a small refactor of `register`, which moves into a shared `bootstrap_person_account`. Only one code path reads `users.password_hash` (`app/auth/router.py:70`), so making the column nullable has a narrow blast radius. The decisions still open are spec-level details: which display name to use and how it is moderated, the 409 copy, the nonce lifecycle in the client, the button layout, and the status code when the JWKS fetch fails. No critical decision is open.

## Key Decisions
- Characteristics: modifies existing code and creates new entities, with data operations and UI. There is no reproducible defect. The NULL-hash crash is a latent defect that this change would introduce, not one that exists today.
- Change type is additive. Login and register keep their contracts, and register's internals are refactored with its behaviour preserved, which makes compatibility strict for both existing endpoints.
- `user_identities` has no UI for READ, UPDATE or DELETE. This is not treated as an orphan: D1 (link/unlink) and D10 (account deletion) were deliberately deferred by ADR-009, and the identity is "read" by every sign-in.
- The iframe focus-trap risk is resolved without a code change. `trapFocus` only acts on the first and last focusable elements of the sheet. The GIS iframe sits between the tabs and the email form, and keydowns inside a cross-origin iframe never reach the sheet's handler, so Tab moves through it natively. A manual mobile check is still recommended.
- The non-JSON body question is resolved by convention. A Pydantic body model already turns a malformed or non-JSON body into the project's 400 through `validation_error_handler` (`app/core/errors.py:130`), so no custom content-type check is needed.

## Open Questions / Risks
- **Google `name` and moderation.** Profile-name edits go through `check_text(TextField.PROFILE_NAME)` (`app/users/service.py:116`), which can return 400 or 503. Copying the Google name at sign-up without that check bypasses the moderation the rest of the profile gets. Running the check inline could block a sign-in. See decision `display-name-source`.
- **JWKS outage.** The HLD says sign-in "fails closed (401)" when the keys cannot be fetched. A 401 looks to the user like a bad credential and cannot be told apart from an attack in the logs. See decision `jwks-outage-status`.
- **Nonce cookie overwrite.** Every `GET /nonce` replaces the single `g_nonce` cookie. A second tab, or a sheet left open for more than 10 minutes, makes the older button fail with 401. See decision `nonce-client-lifecycle`.
- **`google.accounts.id.initialize` is page-global.** Only one live `SocialAuthButtons` instance can own the callback. Today only one `AuthTabs` renders at a time (on `/login` or in an `AuthSheet`), but the spec should state this assumption.
- **Secure cookie in dev.** Chrome and Firefox accept `Secure` cookies on `http://localhost`, but Safari does not. The compose stack on `:5174` (over http) therefore also needs `AUTH_COOKIE_SECURE=false` in its `.env` for Safari. Document this in `.env.example`.
- **Register's duplicate check is case-sensitive.** It compares `UserProfile.email == data.email` while the unique index is on `lower(email)`. This is safe today because `normalize_email` lowercases first. The Google path must also call `normalize_email` before the lookup, otherwise a mixed-case Google email slips past the 409 check and hits the unique index.
- **Login 401 copy is English** ("Invalid username or password"). The Google 401s will reach the same alert line, so the spec should give them Polish copy.
- **Baseline failures** (33 vitest, 2 backend stale tests, mypy 15, ruff 65 on HEAD) must not be counted as regressions.

## Summary
- **Risk Level**: Medium. The code is security-sensitive (token verification, nonce binding, account-takeover prevention) and the migration's downgrade is lossy. The scope is narrow and gated on configuration.
- **Estimated Effort**: Medium. About 15 to 18 files, 2 migrations, 2 matrix rows, roughly 8 backend and 5 frontend test files.
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (login null-hash guard, register → shared bootstrap, `SocialAuthButtons`, `AuthContext`, `AuthTabs`, config and deploy)
- Creates new entities: yes (`UserIdentity`, verifier, nonce issuer, resolver, GIS loader)
- Involves data operations: yes (creating an account and identity, reading the identity, updating the email snapshot)
- UI heavy: yes (moderately): one component on 7 surfaces (`/login` plus 6 `AuthSheet` hosts)

## Gaps Identified

### Missing Features
- **Backend Google endpoints**: neither `GET /api/auth/google/nonce` nor `POST /api/auth/google` exists. `app/auth/router.py` has only `login`.
- **ID-token verifier**: there is no RS256 capability. `cryptography` is absent from `src/backend/uv.lock` (grep returns nothing) and `pyjwt` has no `[crypto]` extra.
- **`user_identities` table and entity**: absent. Alembic head is `0106_paid_terms.py`.
- **Config gate**: `Settings` has no `google_client_id` and no `auth_cookie_secure`. The backend has never set a cookie.
- **Authorization matrix**: no rows for the two routes, which must be appended as PUBLIC.
- **GIS loader**: absent. `src/lib/googleMaps.ts` is the template.
- **`AuthContext.loginWithGoogle`**: absent. `applyToken` (`AuthContext.tsx:83-90`) is the reuse point.
- **Deploy variables**: `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `AUTH_COOKIE_SECURE` are not in `docker-compose.yml` (only the Maps key at :75), `src/frontend/Dockerfile` (:24-25) or either `.env.example`.

### Incomplete Features
- **`SocialAuthButtons.tsx`** is a mock: a 2-column grid with Google and Facebook, and a click shows "będzie dostępne wkrótce". It needs to become a single full-width GIS-rendered Google button, hidden when the client ID is unset. The Facebook button, `FacebookMark` and the mock status line are removed (clarification 2). `GoogleMark` becomes dead code once GIS renders its own button.
- **Account bootstrap** is inline in `register` (`app/users/service.py:268-308`), and `create_account` (`:46`) always hashes a password. It needs a password-optional path plus `IntegrityError` recovery. `app/families/bootstrap.py:58` and `app/families/guardians.py:32` call `create_account_and_profile` with passwords and must keep working unchanged.
- **Register permissions** are hard-coded as `["READ","EDIT"]` in `app/users/router.py:48-50`. They should come from `_load_permissions` (ADR-008).

### Behavioral Changes Needed
- **`POST /api/auth/login`**: a NULL `password_hash` currently raises an AttributeError (a 500) inside `verify_password`. It must return the same 401 envelope as a wrong password.
- **`POST /api/auth/register`**: a concurrent duplicate currently produces the generic IntegrityError 409 "Data integrity violation". It should return the Polish `DuplicateEmailException` 409.
- **`users.password_hash`**: changes from NOT NULL to nullable (0108, guarded downgrade).
- **`architecture.md:535`** says the backend calls no Google endpoint. That becomes false once the backend fetches the JWKS.

### Verified: `password_hash` readers (audit executed)
`grep -rn "password_hash|verify_password|hash_password" src/backend/app`:
- `app/auth/router.py:70` is the **only** reader of `User.password_hash`, and it needs the guard.
- `app/oauth2/client_auth.py:76` and `app/oauth2/router.py:527` call `verify_password` on `client.client_secret` (OAuth2 clients, not users). They are unaffected.
- `app/users/service.py:47` is the only writer (`create_account`).
- There is no password-change, password-reset or account-deletion code, so nothing else assumes a hash.

### Verified: `user_profiles.email` invariants
- Profiles are created only in `app/users/service.py:66` (always with an account) and `app/families/members.py:37` (`email=None`, no account). No code path updates `UserProfile.email`.
- So every profile with an email has a login account. A Google 409 that says "log in with your password" never points at an account with no credential, except a Google-only account, which a Google sign-in resolves by `sub` before the email check runs.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | `/login`, and `AuthSheet` on 6 public surfaces (`SignUpFooter`, `ItemChatButton`, `ItemPickupActions`, `TermNeededItems`, `ItemPage`, `PrivateTermView`) | Same 7 surfaces through `AuthTabs` → `SocialAuthButtons`. No new route. | ✅ |
| Discoverability | 9/10 (a prominent button, but a mock) | 9/10. A full-width Google-branded button above "lub emailem", on both tabs. | 0 (now functional) |
| Flow integration | Password only. The sheet closes on a token change and `/login` reloads to `returnTo`. | Google sign-in reuses `applyToken`, so `AuthGuard` and `useAccountGate` behave identically. An existing password user gets a 409 and is told to use the password tab. | ✅, with ⚠️ 409 friction until D1 |
| Multi-persona | Guest, organizer and admin all sign in by password | New Google accounts are GUEST (ADR-006). Admins and organizers created through Google keep their DB permissions. Existing password users cannot use Google (D1 deferred). | ⚠️ accepted per ADR-005 |

Discoverability does not depend on documentation. The button is hidden only when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is unset, which is intended.

## Data Lifecycle Analysis

### Entity: UserIdentity (new)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Resolver on first sign-in (`POST /api/auth/google` → 201) | GIS button in `SocialAuthButtons` | `/login` and the 6 `AuthSheet` surfaces | ✅ planned |
| READ | Resolver lookup by `(provider, subject)` on every sign-in | Implicit: the sign-in succeeds | Same button | ✅ (no listing UI; D1 deferred) |
| UPDATE | Email snapshot refreshed on sign-in | none | n/a | ✅ system-managed |
| DELETE | `ON DELETE CASCADE` from `users` only | none | none | Deferred (D1 unlink, D10 deletion) |

### Entity: User / UserProfile / Party (account created by Google)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Shared `bootstrap_person_account` (GUEST, NULL hash) | Google button | 7 surfaces | ✅ planned |
| READ | Existing `GET /api/people/me` and profile pages | Existing | Existing | ✅ |
| UPDATE | Existing profile and appearance edits | Existing | Existing | ✅ (setting a first password is D4, deferred) |
| DELETE | none (true of all accounts today) | none | none | Deferred (D10) |

**Completeness**: 100% of in-scope operations. The missing pieces (unlink, deletion, setting a password) are explicit ADR-009 deferrals, not oversights.
**Orphaned Operations**: none new. Accepted risk: a Google-only user who loses their Google account cannot recover access (D4/D10), as recorded in the HLD.
**Missing Touchpoints**: none. All 7 auth surfaces share `AuthTabs`. No other login entry exists: the OAuth2 consent page reuses the aj session through `_token`.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
None. Every blocking choice (flow, handoff, collision policy, role, scope, Secure-flag source, the Facebook button) is settled by the ADRs and the clarifications.

### Important (Should Decide)
1. **display-name-source**: what display name a Google sign-up gets, given that profile-name edits are moderated (`check_text(PROFILE_NAME)` → 400/503).
   - Options: [A] the Google `name` (trimmed, ≤255) checked with `check_text`, falling back to the email-derived name on rejection or when moderation is unavailable, so sign-in never fails; [B] the Google `name` with no moderation; [C] always the email-derived name, the same as register.
   - Default: **A**.
   - Rationale: it gives the real name users expect, never blocks sign-in, and never stores an unmoderated public name. B bypasses moderation. C gives ugly names for most Gmail addresses (for example "Jkowalski85").
2. **google-409-copy**: the wording and affordance for "this email already has an aj account".
   - Options: [A] a dedicated message "Konto z tym adresem już istnieje — zaloguj się hasłem." and, on the register tab, the same inline "Zaloguj się" switch `RegisterForm` uses (pass `onSwitchToLogin` into `SocialAuthButtons`); [B] reuse `DuplicateEmailException` ("Ten email jest już zarejestrowany, zaloguj się") with no switch.
   - Default: **A**.
   - Rationale: it names the credential to use, and the switch already exists as a pattern.
3. **nonce-client-lifecycle**: when the client fetches a nonce.
   - Options: [A] fetch on mount, then a fresh nonce and re-initialize after every failed attempt and when the 10-minute TTL lapses (timer); no automatic retry of a POST; [B] fetch on mount only; [C] fetch lazily on click (not possible with the GIS rendered button, which needs the nonce at `initialize`).
   - Default: **A**.
   - Rationale: it avoids stale-button 401s after a failure, a long-open sheet or another tab.
4. **backend-unconfigured-ui**: what the button does when the frontend has a client ID but the backend answers 503 to `GET /nonce`.
   - Options: [A] hide the Google button and the divider (render as if unconfigured); [B] show the button disabled with the Polish 503 message.
   - Default: **A**.
   - Rationale: it is a misconfiguration and should leave no dead button, the same reasoning as clarification 2.
5. **button-layout**: GIS `renderButton` options.
   - Options: [A] `type: "standard"`, `theme: "outline"`, `shape: "pill"`, `size: "large"`, `locale: "pl"`, `text` = `signin_with` on the login tab and `signup_with` on the register tab, `width` = the container width clamped to 200–400 px (GIS maximum), centered, with a min-height placeholder to prevent layout shift; [B] a fixed width of 320 px.
   - Default: **A**.
   - Rationale: it matches the full-width clarification within GIS limits and the existing pill-shaped controls.
6. **jwks-outage-status**: the response when the Google JWKS cannot be fetched (timeout or 5xx).
   - Options: [A] 503 with Polish copy "Logowanie przez Google jest chwilowo niedostępne. Spróbuj ponownie." and one WARNING log; [B] 401 as the HLD integration table says.
   - Default: **A**.
   - Rationale: it is retryable, distinct from a forged token, and consistent with the error-handling standard (503 for an unavailable dependency). Still fail-closed. Either option is safe.
7. **created-flag-use**: whether the frontend acts on `created: true`.
   - Options: [A] no special behaviour (the same as password register; `loginWithGoogle` returns `{created}` for tests and later use); [B] show a welcome toast or onboarding redirect.
   - Default: **A**.
   - Rationale: parity with register and minimal implementation.
8. **google-401-copy**: the single Polish message for any verification failure (signature, aud, nonce, expiry, missing cookie).
   - Options: [A] one generic message "Nie udało się zalogować przez Google. Spróbuj ponownie." with no reason given; [B] different messages per reason.
   - Default: **A**.
   - Rationale: it leaks nothing to an attacker, and the reasons go to the logs.

## Recommendations
- Order: dependencies and config → 0107/0108 plus migration tests → the null-hash login guard → the bootstrap extraction (keep `test_registration.py` and `test_families_bootstrap.py` green before any Google code) → verifier, nonce and resolver → routes and matrix rows → frontend loader, button and context → deploy files and docs.
- Keep `create_account_and_profile`'s signature backward compatible (`password: str | None`) so the families callers do not change.
- Call `normalize_email` on the Google email before the 409 lookup and before storing it. Look the email up with `func.lower(...)` or the normalized value so the unique-index semantics hold.
- Keep `trapFocus.ts` unchanged. Add a manual check of Tab through the GIS iframe in `AuthSheet` at 375 px to the verification phase.
- Name the config settings `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `AUTH_COOKIE_SECURE` (default true). Put only empty placeholders in `.env.example`, with a comment that `AUTH_COOKIE_SECURE=false` is needed over http, including compose on :5174 and Safari.
- Frontend tests: a loader test modelled on `googleMaps.test.ts`, `SocialAuthButtons` tests (hidden without the client ID, hidden on a nonce 503, error line, tab text), `loginWithGoogle` in the `auth.test.tsx` mock defaults, and an SSR case. Remove the hard-coded SVG colours with `GoogleMark` so `themeDefects`/`themeTokenUsage` stay clean.
- Docs: `architecture.md` (:157, :159, :532, :535, :619, plus a 0107–0108 runbook), `tech-stack.md:110` (env vars, `pyjwt[crypto]`), and INDEX.md summaries.

## Risk Assessment
- **Complexity Risk**: Medium. The verification checks (alg pinning, iss in both forms, aud and azp, nonce in constant time, JWKS refresh on an unknown `kid`) must all be table-tested with locally signed RS256 tokens.
- **Integration Risk**: Low to medium. It adds an outbound JWKS dependency and the first backend `Set-Cookie`, which goes through the Next rewrite in dev and nginx in compose. A third-party iframe and popup are blocked in some in-app browsers (D6 deferred).
- **Regression Risk**: Medium. The register refactor touches the paths shared with the families code, and the nullable hash changes login. Existing tests (`test_login.py`, `test_registration.py`, `test_families_bootstrap.py`, `test_auth_cookie.py`, `auth.test.tsx`) cover these, and a NULL-hash login case is added.
- **Data/Deploy Risk**: Medium. The 0108 downgrade refuses once Google-only accounts exist, so there is no image-only rollback past 0108. A runbook is required.
