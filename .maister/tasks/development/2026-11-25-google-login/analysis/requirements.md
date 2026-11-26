# Requirements: Google sign-in and sign-up

## TL;DR
Add "Zaloguj / Zarejestruj się przez Google" wherever `AuthTabs` renders (`/login` and the six `AuthSheet` surfaces). It uses a GIS popup, a server nonce cookie and `POST /api/auth/google`, and returns the usual aj JWT. A new account is a GUEST created through a bootstrap shared with password registration. An existing email that is not linked to Google gets a Polish 409, never a merge. The feature is gated on the client ID being set on both stacks. The approved mockups and copy are binding.

## Key Decisions
- Architecture: the research ADR-001…009 apply unchanged. Technical-approach clarification was skipped because the research decided it.
- Nonce cookie `Secure` flag: from a config setting (default true, false in dev over http). It is never derived from headers.
- The Facebook mock is removed.
- The Phase 2 defaults (all 8) are in `scope-clarifications.md`.
- Register switches to permissions loaded from the DB and maps the concurrent-duplicate race to the Polish 409. Its response shape stays `{token, party_id, role}`.

## Open Questions / Risks
- Production prerequisites (domain, privacy policy, brand verification, D14) are outside the code.
- Popup blocking in in-app browsers is unmeasured (D6 fallback deferred).

## Initial description
Implement Google sign-in and sign-up in aj per research `.maister/tasks/research/2026-11-25-google-login` (copies in `analysis/research-context/`).

## Q&A (all rounds)
### Phase 1
- Secure flag → config setting, default true.
- Facebook button → remove.
- A dev client ID exists; the user puts it in `.env`. It is never printed.

### Phase 2 (decision gate)
- Display name → Google `name` through `check_text(PROFILE_NAME)`, falling back to the email-derived name on a reject or a moderation outage. Sign-in never fails because of the name.
- 409 → "Konto z tym adresem już istnieje — zaloguj się hasłem." plus the inline "Zaloguj się" switch on the register tab.
- Nonce lifecycle → fetched on mount, re-fetched and GIS re-initialized after a failure and when the 10-minute TTL lapses. No automatic POST retry.
- Backend unconfigured (503 on `/nonce`) → button and divider hidden.
- Button → GIS standard / outline / pill / large, `locale: "pl"`, `signin_with` on the login tab and `signup_with` on the register tab, width following the container clamped to 200–400 px and centered, 44 px min-height placeholder.
- JWKS outage → Polish 503 and one WARNING log line.
- `created: true` → no special frontend behaviour.
- 401 → one generic message, "Nie udało się zalogować przez Google. Spróbuj ponownie."

### Phase 4 (mockups approved)
- 403 copy: "Ten adres w Google nie jest potwierdzony. Potwierdź go w Google albo załóż konto emailem."
- 503 copy: "Logowanie przez Google jest chwilowo niedostępne. Zaloguj się emailem albo spróbuj później."

### Phase 5
- User journey: only the existing `AuthTabs` surfaces, for all users (guests, returning users, admins). `/login` reloads to `returnTo` or home; `AuthSheet` closes in place. No new entry points (header, settings, consent page).
- Reuse list confirmed (below).
- No extra visual assets beyond the approved mockups.

## Similar features / reuse
- Backend:
  - `app/core/security.py::encode_login_token`
  - `app/auth/router.py::_load_permissions` and the hand-built 401
  - `app/users/schemas.py::normalize_email`
  - `app/users/service.py::derive_username_from_email`, `_derive_display_name`, `create_account_and_profile`, the `register` body → `bootstrap_person_account`
  - `app/families` `create_solo_family_for_party`
  - `check_text(TextField.PROFILE_NAME)` (`app/users/service.py:116` usage)
  - the `begin_nested` + `IntegrityError` pattern in `app/events/service.py:401-408`
  - the `ServiceUnavailableException` / `BusinessConflictException` / `AccessDeniedException` envelopes
  - the `Settings` optional-field + `*_configured` property pattern
  - `httpx` (already a runtime dependency) for the JWKS fetch
- Migrations: helpers from `0103_points_tables.py`; guarded downgrade as in `0073`/`0076`; tests modelled on `tests/test_item_visibility_migration.py`.
- Frontend:
  - the `src/lib/googleMaps.ts` loader pattern (+ `googleMaps.test.ts`)
  - `AuthContext.applyToken` and the raw-fetch `login`/`register` pattern
  - the `LoginForm`/`RegisterForm` alert classes and the inline switch
  - `useClientValue`/`ClientOnly` for SSR safety, `ssrSafety.test.tsx`

## Visual assets
`analysis/design-context/INDEX.md`, 7 screens (binding): login tab, register tab, AuthSheet at 375 px, loading placeholder, 409 with the switch, 401/403/503 alerts, Google unavailable (email only). Design resources: `analysis/design-context/design-resources.md`.

## Functional requirements
1. `GET /api/auth/google/nonce` (PUBLIC) returns `{nonce}` (≥128-bit random) and sets a signed HttpOnly, SameSite=Lax cookie with a 10-minute lifetime, `Path=/api/auth/google`, and `Secure` from config. It returns a Polish 503 when `GOOGLE_CLIENT_ID` is unset.
2. `POST /api/auth/google {credential}` (PUBLIC, JSON). It verifies the cookie's signature and age and clears the cookie. It verifies the ID token: RS256 only, Google JWKS cached about 1 h and refreshed on an unknown `kid`, `iss` in both forms, `aud` = client ID, `azp` when present, `exp`/`iat` with ≤30 s leeway, and the nonce compared in constant time. It never logs the credential.
3. Resolution:
   - linked `(GOOGLE, sub)` → 200 and the email snapshot is refreshed
   - unverified email → 403
   - unlinked with an email already present in any profile (`normalize_email`) → 409
   - otherwise → create a GUEST account and the identity in one transaction → 201
   - a race on the identity → roll back and re-read (log in); a race on the email → 409
4. The response is `{token, created, party_id}`. The token comes from `encode_login_token` with the permissions read from the DB.
5. Failures: 401 → one generic Polish message, details only in the logs. JWKS outage → Polish 503 + WARNING. Feature unconfigured → Polish 503.
6. Password login with a NULL hash → the same 401 "Invalid username or password", with no hint that the account uses Google.
7. Register uses the shared bootstrap and DB-loaded permissions; a concurrent duplicate gives the Polish 409. Its contract is otherwise unchanged.
8. Migrations: 0107 `user_identities` (BaseEntity, `user_id` FK ON DELETE CASCADE, string-backed `provider`, `subject`, `email` snapshot, `email_verified`, unique `(provider, subject)` and `(user_id, provider)`). 0108 makes `users.password_hash` nullable, with a guarded downgrade that refuses while NULL hashes exist. Runbook in `architecture.md`.
9. Two PUBLIC rows in the authorization matrix next to register, with tests.
10. Frontend:
    - the GIS loader (`loadGoogleIdentity`, `isGoogleLoginConfigured`)
    - `SocialAuthButtons` rewritten as one Google slot (Facebook removed) following the mockups, taking `tab` and `onSwitchToLogin`
    - `AuthContext.loginWithGoogle(credential)` going through `applyToken`
    - SSR-safe mounting
    - hidden without `NEXT_PUBLIC_GOOGLE_CLIENT_ID` or on a 503 from `/nonce`
11. Config/deploy:
    - `GOOGLE_CLIENT_ID` and the cookie-Secure setting in `Settings` and compose `backend.environment`
    - `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in compose `web.build.args` and the Dockerfile ARG/ENV
    - placeholders in both `.env.example` files, including the Safari / http note
    - `pyjwt[crypto]` + `uv.lock`
12. Docs: `tech-stack.md`, `architecture.md` (incl. fixing the outdated line 535 and the 0107/0108 runbook), `INDEX.md`.

## Scope boundaries
- In scope: the items above.
- Out of scope (deferred): D1 link/unlink, D2 role parameter, D3 avatar, D4 setting a password, D5 One Tap/FedCM, D6 code-flow fallback, D7 token cutoff/RISC, D8 email verification, D9 Facebook, D10 password reset / account deletion, D11 `resolve_base_url`, D12 nginx `limit_req`, D13 CSP, D14 legal/brand.

## Technical considerations
- `cryptography` is absent from `uv.lock`, so this adds `pyjwt[crypto]`.
- Use an async JWKS fetch over `httpx`, not the blocking `PyJWKClient`, or wrap the latter in a threadpool.
- The verifier is a FastAPI dependency so tests can override it. Tests use locally signed RS256 tokens and make no network calls.
- The GIS callback is page-global, so only one live `SocialAuthButtons` can exist per page.
- The baseline failures on HEAD (33 vitest, 2 backend, mypy 15, ruff 65) are not regressions.
- Never print secrets. No commits without asking.
