# Work Log

## 2026-11-25T15:20:01Z - Implementation Started

**Total Steps**: 50
**Task Groups**: 1 Data Model & Migrations; 2 Backend Config, Dependency & Google Verifier; 3 Users Bootstrap, Register & Password Login Guard; 4 Google Sign-In Service, Routes & Authorization Matrix; 5 Deploy Configuration; 6 Frontend GIS Loader, Nonce API & AuthContext; 7 Frontend Google Slot UI; 8 Documentation & Standards; 9 Test Review & Gap Analysis
**Execution**: parallel waves — W1 {1,2,5,6}, W2 {3,7}, W3 {4}, W4 {8}, W5 {9}

## Standards Reading Log

### Loaded Per Group
(Entries added as groups execute)

### Group 1: Data Model & Migrations
**From Implementation Plan**: standards/backend/models.md, standards/backend/migrations.md, standards/testing/backend-testing.md
**From INDEX.md**: standards/global/commenting.md, standards/global/minimal-implementation.md
**Discovered During Execution**: none

### Group 5: Deploy Configuration
**From Implementation Plan**: standards/global/conventions.md (environment variables), CLAUDE.md secrets rule

### Group 6: Frontend GIS Loader, Nonce API & AuthContext
**From Implementation Plan**: standards/frontend/data-fetching.md, standards/frontend/components.md, standards/testing/frontend-testing.md
**From INDEX.md**: standards/global/minimal-implementation.md, standards/global/commenting.md

## 2026-11-25T15:24:43Z - Group 1 Complete (wave 1)
**Steps**: 1.1–1.5
**Tests**: 2 passed (tests/test_user_identities_migration.py); alembic heads = 0108; ruff clean
**Files Modified**: app/auth/models.py; alembic/versions/0107_user_identities.py, 0108_nullable_password_hash.py (created); tests/test_user_identities_migration.py (created)
**Notes**: mypy 16 vs baseline 15: the new error is app/auth/router.py:70 (verify_password receives str | None), resolved by Group 3's NULL-hash guard. The 0108 downgrade sets lock_timeout before the guard count, and its refusal names the pre-0108 dump.

## 2026-11-25T15:24:43Z - Group 5 Complete (wave 1)
**Steps**: 5.1–5.5
**Tests**: docker compose config --quiet exits 0; key-name greps find every placeholder
**Files Modified**: docker-compose.yml, src/frontend/Dockerfile, .env.example, src/frontend/.env.example
**Notes**: the empty AUTH_COOKIE_SECURE= placeholder resolves to true under compose; Group 2 was asked to treat "" as unset in Settings. No secrets were read or printed.

## 2026-11-25T15:24:43Z - Group 6 Complete (wave 1)
**Steps**: 6.1–6.6
**Tests**: 34 passed in 6 files; typecheck 0; lint shows 3 problems in AuthContext.tsx, all already on HEAD
**Files Modified**: src/lib/googleIdentity.ts, src/api/auth.ts (created); auth/AuthContext.tsx; test/googleIdentity.test.ts, test/authApi.test.ts (created); test/auth.test.tsx, CategoryListPage.test.tsx, Sidebar.test.tsx, useItemActions.test.tsx
**Notes**: the script id is google-identity-services, as in the spec. A GIS load event without window.google.accounts.id counts as a failure, and the stale tag is replaced on retry. GoogleIdApi and GoogleButtonOptions types are exported for Group 7.

### Group 2: Backend Config, Dependency & Google Verifier
**From Implementation Plan**: standards/backend/security.md, standards/global/error-handling.md, standards/testing/backend-testing.md, standards/global/minimal-implementation.md
**From INDEX.md**: standards/global/validation.md
**Discovered During Execution**: the app/core/errors.py ModerationUnavailable pattern (a 503 with a Polish default message)

## 2026-11-25T15:25:20Z - Group 2 Complete (wave 1)
**Steps**: 2.1–2.6
**Tests**: 38 cases passed (tests/test_google_token_verifier.py, no network); ruff and mypy clean on the touched files; ruff . 64 (baseline 65); mypy app 16 (the +1 is Group 1's password_hash change, fixed in Group 3)
**Files Modified**: app/config.py, pyproject.toml (pyjwt[crypto]), uv.lock (+cryptography, cffi, pycparser), app/auth/google.py (created), tests/test_google_token_verifier.py (created)
**Notes**:
- The auth_cookie_secure validator treats "" as True.
- GoogleKeysUnavailable subclasses ServiceUnavailableException and carries the Polish 503.
- GoogleTokenInvalid(reason) gives log-safe reason codes.
- get_google_verifier is a functools.cache singleton; the route has to check google_login_configured first.
- On this machine uv lock/sync needs --system-certs (corporate TLS), and uv sync needs --group ml to keep the ML packages; the venv was restored.

## 2026-11-25T15:25:20Z - Wave 1 resolved (groups 1, 2, 5, 6); dispatching wave 2 {3, 7}

### Group 3: Users Bootstrap, Register & Password Login Guard
**From Implementation Plan**: standards/backend/queries.md, standards/global/error-handling.md, standards/global/validation.md, standards/backend/security.md, standards/testing/backend-testing.md
**From INDEX.md**: standards/global/commenting.md, standards/global/minimal-implementation.md

## 2026-11-25T15:30:17Z - Group 3 Complete (wave 2)
**Steps**: 3.1–3.6
**Tests**: 16 passed (test_registration, test_login, test_families_bootstrap; 6 new tests, all red before the change); 52 passed in the families/guardians/category/migration suites; ruff clean; mypy app 15 (back to baseline)
**Files Modified**: app/auth/service.py (created: load_permissions); app/auth/router.py (NULL-hash guard returns the same 401); app/users/service.py (bootstrap_person_account, is_email_registered with lower(), derive_display_name, the register savepoint with re-read and one retry); app/users/router.py (DB permissions); tests/test_registration.py; tests/test_login.py
**Notes**: bootstrap_person_account stores the email exactly as passed, so Group 4 must normalize it first. Stale docstrings mentioning the old private names remain in tests/test_category_module.py:64 and tests/test_lightweight_family_members.py:65 (comments only).

### Group 7: Frontend Google Slot UI
**From Implementation Plan**: standards/frontend/components.md, standards/frontend/accessibility.md, standards/frontend/css.md, standards/testing/frontend-testing.md
**From INDEX.md**: standards/frontend/data-fetching.md, standards/global/error-handling.md, standards/global/minimal-implementation.md
**Discovered During Execution**: the eslint react-hooks/set-state-in-effect and react-hooks/refs rules, avoided by adjusting state during render and using useEffectEvent

## 2026-11-25T15:31:46Z - Group 7 Complete (wave 2)
**Steps**: 7.1–7.7
**Tests**: 40 passed (SocialAuthButtons 8, ssrSafety 19 incl. the new case, auth 13); typecheck 0; eslint clean on the touched files; regression suites 355 passed / 3 failed, all 3 known baseline failures (Wróć ×2, TermPage place card), none in auth
**Visual compliance**: all 9 references ✓. The one deviation: the loading skeleton is static bg-line, without the mockup's shimmer, because the hex gradient breaks the tokens-only rule.
**Files Modified**: features/auth/useGoogleSignIn.ts (created), SocialAuthButtons.tsx (rewritten, Facebook removed), AuthTabs.tsx; test/SocialAuthButtons.test.tsx (created), test/ssrSafety.test.tsx
**Notes**:
- A generation counter drops stale nonce results.
- A tab change re-initializes GIS with the same nonce.
- Candidate standard: give third-party DOM renderers an empty React-childless node.

## 2026-11-25T15:31:46Z - Wave 2 resolved (groups 3, 7); dispatching wave 3 {4}

### Group 4: Google Sign-In Service, Routes & Authorization Matrix
**From Implementation Plan**: standards/backend/security.md, standards/backend/api.md, standards/backend/queries.md, standards/global/error-handling.md, standards/global/validation.md, standards/testing/backend-testing.md
**From INDEX.md**: standards/global/commenting.md, standards/backend/models.md

## 2026-11-25T15:37:15Z - Group 4 Complete (wave 3)
**Steps**: 4.1–4.5
**Tests**: 197 passed (google_login 8 functions with tables, authorization_matrix, login, registration, google_token_verifier, auth_cookie, families_bootstrap); ruff clean; mypy app 15 (baseline)
**Files Modified**:
- app/auth/service.py: sign_in_with_google, typed exceptions, display-name moderation fallback, savepoint with re-read and one retry
- app/auth/router.py: POST /api/auth/google/nonce (body {} with extra=forbid, Cache-Control no-store) and POST /api/auth/google (the cookie is cleared on every route-built response)
- app/core/authorization_matrix.py: rows 72/73 POST PUBLIC after row 47
- tests/test_google_login.py (created)
- tests/test_authorization_matrix.py
**Notes**:
- StaleDataError during the snapshot refresh → rollback + 401 (reason=stale_identity).
- The 503 gate runs before the cookie is read; body validation (400) runs before the gate.
- The full backend suite has not been run yet; it runs at finalize.

## 2026-11-25T15:37:15Z - Wave 3 resolved (group 4); dispatching wave 4 {8}

### Group 8: Documentation & Standards
**From Implementation Plan**: the INDEX.md documentation rule, the CLAUDE.md secrets rule, standards/backend/migrations.md (runbook style)

## 2026-11-25T15:42:47Z - Group 8 Complete (wave 4)
**Steps**: 8.1–8.6
**Tests**: 2 grep checks pass ("calls neither Google" gone; runbook heading at architecture.md:952; env var names present, no values)
**Files Modified**: .maister/docs/project/tech-stack.md, project/architecture.md (Google sign-in section, line fixes, 0107–0108 runbook), standards/backend/security.md (auth-flow cookies, third-party ID tokens), standards/frontend/data-fetching.md (imperative nonce exception), INDEX.md (4 summaries)
**Notes**: the standards were edited directly (a subagent cannot invoke /maister:standards-update), keeping INDEX.md in sync. Unrequested short additions: the CSP/COOP note for GIS (D13) and a JavaScript-origin note (D14).

## 2026-11-25T15:42:47Z - Wave 4 resolved (group 8); dispatching wave 5 {9}

### Group 9: Test Review & Gap Analysis
**From Implementation Plan**: standards/testing/backend-testing.md, standards/testing/frontend-testing.md
**From INDEX.md**: standards/backend/security.md (the _token form source for the consent test)

## 2026-11-25T15:47:18Z - Group 9 Complete (wave 5)
**Steps**: 9.1–9.4
**Tests**: 6 added:
- backend: OAuth2 consent pass-through, 4096/4097 credential cap, single nonce cookie replaced/cleared, one reason log line without secrets
- frontend: 403/503/foreign/network alert copies, refresh paused while the popup is open

Results: 205 backend feature tests passed; 51 frontend feature tests passed; mypy 15 (baseline); ruff 64 (≤65); typecheck 0; eslint clean
**Files Modified**: tests/test_google_login.py, src/test/SocialAuthButtons.test.tsx
**Notes**: no real bug found. Manual checks left for verification: the 375 px AuthSheet Tab/popup check and a real sign-in with the dev client ID.

## 2026-11-25T16:07:25Z - Implementation Complete

**Total Steps**: 50 completed (9 groups, 5 waves)
**Total Standards**: 20 distinct standard files applied (see the per-group log)
**Test Suite**: passed against the baseline. The only failures are ones already on HEAD:
- **Backend, full run**: 1785 passed, 2 failed. The two failures are test_owner_items_page nearest_privateCircleTerm and test_terms_circle_occurs_on_index_migration 0053, the same stale tests recorded on HEAD.
- **Frontend, full run**: 2082 passed, 33 failed across 12 files. That matches the baseline total of 33.
  - AppPage shows 13 failures here. Run alone it shows exactly the 12 known ones; the extra "term edit page" test passes when isolated, so it is a timing flake in the full run.
  - PublicLayout shows 2 failures (baseline 3).
  - No failing test touches auth.
- **Static checks**: typecheck 0, mypy 15 (baseline), ruff 64 (baseline 65).
- **Feature tests**: 205 backend and 51 frontend, all passing.
**Manual checks still open** (left for verification): Tab and popup behaviour of the GIS iframe in AuthSheet at 375 px; one real sign-in with the dev client ID (never printed).

## 2026-11-25T18:23:45Z - Verification fixes applied (Phase 11, cycle 1)
**Fixed**: W1, W2, W3, W5, W6, W7, W14, I1, I2, I3, I7, I9, I11, I12. The owner chose to keep W4 as specified and approved W8.
**Tests**: backend 233 passed (9 feature/regression files); frontend 279 passed (7 files incl. theme tests); typecheck 0; eslint clean; ruff clean; mypy 15
**Files**:
- backend:
  - app/auth/{google,router,service}.py
  - app/users/{service,schemas}.py
  - app/config.py
  - alembic 0107
  - tests (verifier, google_login, category_module, lightweight_family_members)
- frontend:
  - features/auth/useGoogleSignIn.ts, SocialAuthButtons.tsx
  - lib/googleIdentity.ts
  - tests (SocialAuthButtons, googleIdentity, ssrSafety)
- docs: .maister/docs/project/architecture.md (runbook)
**Note**: test_auth_cookie.py exists, so the completeness checker's "nonexistent suite" note on line 95 was a false positive and needs no change.

## 2026-11-26 — Phases 12–14 and workflow summary

- Environment: client IDs set (presence check only), `AUTH_COOKIE_SECURE` left at the default true (fine for Chromium on localhost, Safari needs false). `pg_dump` at 0106 in `%USERPROFILE%\aj-backups\aj-pre-0107-2026-11-26.dump`; backend and web rebuilt, DB migrated to 0108, nonce route 200.
- Phase 12 E2E: GO with caveats. 10/11 scenarios pass, 0 fail; the real Google popup sign-in stays a manual owner check. M1 (env): `http://localhost:5174`/`:5173` missing from the client's JS origins (GIS button 403 "origin is not allowed"). m1: GIS `initialize()` warning on every tab switch (`useGoogleSignIn.ts` `[session, tab]` effect). Visual fidelity 7 match / 2 minor.
- Phase 13: Polish user guide `documentation/user-guide.md`, 11 reused E2E screenshots; error screenshots show the `[stub]` test button.
- Open after the workflow (owner): add JS origins, manual popup check (first sign-up 201, repeat 200, password-account email 409), repeat the 375 px AuthSheet focus check on the real GIS frame, retake the guide screenshots; before production: D14, production origin, VPS `.env` presence check, pip-audit, D12/D13. Optional cleanups: m1/I10, N2, N6/N7, N1/N5.
- No commits made (owner rule).
