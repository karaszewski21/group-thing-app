# Code Review Report (re-verification, cycle 1)

## TL;DR
- All 10 fixes I was asked to re-check hold up: W1, W2, W3, W6, I1, I2, I3, I7, I9 and I11. None leaves a warning-level residual.
- The fixes introduced no new critical issues and no new warnings.
- There are 3 new informational notes. W2 still has a cross-instance edge, because the in-flight nonce request lives in a ref and not in the module. The frontend client ID is not trimmed, so I9 is only half done across the stacks. A JWKS fetch during the grace period holds the lock, so it can stall concurrent logins for up to 5 s once a minute.
- Status: ⚠️ Issues Found (info only), 0 critical, 0 warnings, 3 info.

**Date**: 2026-11-25
**Path**: working tree on `feature/global-search-group-description` (Google sign-in change set)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found (info only)

## Key Decisions
- I did not re-raise W4, the per-login snapshot refresh. The owner chose to keep it.
- I did not re-raise risks the spec accepted.
- The frontend `GOOGLE_ERROR_COPY` table is not counted as a W3 duplicate. The frontend matches the server copy exactly, by design. W3 is about the backend sources: the exception messages versus `_GOOGLE_ERRORS`.
- I7 timing is judged for Google-only accounts (NULL hash) against accounts registered through this backend. Both are bcrypt cost 12 via `bcrypt.gensalt()`. Email existence already shows through the registration 409, so I raise no residual for legacy hash costs.

## Open Questions / Risks
- None blocking. The three informational notes below are optional polish.

## Summary
- **Critical**: 0
- **Warnings**: 0
- **Info**: 3 (new). No residuals from the previous findings.

## Verdicts on the previous findings

| ID | Verdict | Evidence |
|----|---------|----------|
| W1 | **resolved** | `src/backend/app/auth/google.py:249-299`. Backoff, throttle and refresh all run under `self._lock`, with a cache re-check after taking it. While `_failed_at` is less than 60 s old, every queued waiter takes `_grace_key` and none refetches, so there is no fetch storm. The clock is injected (the `clock` argument, `time.monotonic` by default) and used for `now`, `_cached_key` and the timestamps. `_grace_key` fails closed at `now >= _expires_at + JWKS_GRACE_SECONDS`, and also with no keys at all (`_expires_at = -inf` at start). `CancelledError` is not swallowed: `except Exception` does not catch `BaseException`. Covered by three tests (`tests/test_google_token_verifier.py:231,256,273`). |
| W2 | **resolved** (one informational edge, N1) | `src/frontend/src/features/auth/useGoogleSignIn.ts:82,111-120`. A single `nonceRequest` ref is shared by the initial fetch, the timer, focus refreshes, the post-failure refresh and StrictMode's second mount, because refs survive the mount, cleanup and remount cycle. `generation` drops the stale caller's result. `request.then(clear, clear)` leaves no unhandled rejection. A refresh after a failed POST that joins a still-pending request is safe: that response arrives after the POST's cookie clear, so its Set-Cookie wins. Test at `SocialAuthButtons.test.tsx:236`. |
| W3 | **resolved** | `GoogleEmailTaken`, `GoogleEmailUnverified` and `GoogleSignInFailed` are now plain exceptions with no message (`app/auth/service.py:38-48`). The 401, 403 and 409 copies live only in `_GOOGLE_ERRORS` (`app/auth/router.py:118-126`). The 503 copy lives only in `GOOGLE_UNAVAILABLE_COPY` (`app/auth/google.py:60`), which `_GOOGLE_ERRORS` and `GoogleKeysUnavailable` both reference. A grep finds no other copies in `app/`. |
| W6 | **resolved** | The outcome lines are `reason=<code>`, `reason=email_unverified`, `reason=email_taken` and `ok: created=<bool>` (`app/auth/router.py:164,202,205,208`). None of them logs an email, subject, name, user id, party id, credential or nonce. The JWKS warning logs only the exception type name. The log test asserts the exact lines (`tests/test_google_login.py:454-487`). |
| I1 | **resolved** | `onFocus` debounces to `FOCUS_REFRESH_DELAY_MS = 1000` (`useGoogleSignIn.ts:152-155`). `onReturn` re-checks `stale`, `inFlight`, visibility and `hasFocus()` when it fires (`:147-150`). `onCredential` sets `inFlight` synchronously, before its first `await`, so a credential that lands within the 1 s window wins. `visibilitychange` also requires `hasFocus()`. The focus timer is cleared on unmount. Tests at `:314,352`. |
| I2 | **resolved** | `src/frontend/src/lib/googleIdentity.ts:83-113`. `pendingScript` pairs the injected tag with its one `loaded` promise. A retry after a timeout reuses that promise, adding no new tag and no new listeners. An errored tag removes itself, so the next call injects a fresh one. A tag that loaded but left no `google.accounts.id` (`dataset.loaded`) is replaced. Rejections are always observed through `Promise.race`, or later through the caller's `await`. Test at `googleIdentity.test.ts:89`. |
| I3 | **resolved** | The unused GIS members are gone (`googleIdentity.ts:15-38`). The `current` flag is set to false in the init effect's cleanup (`useGoogleSignIn.ts:174-196`), so after unmount the page-global callback is a no-op. After a tab change, `initialize` installs the new callback, so a popup opened before the tab switch is still handled. Test at `SocialAuthButtons.test.tsx:268`. |
| I7 | **resolved** | `_DUMMY_PASSWORD_HASH` is computed once at import (`app/auth/router.py:60`). The login route always runs exactly one `verify_password`, against the real hash or the dummy one (`:93-98`). It denies when `user is None or password_hash is None or not password_ok`, so the dummy can never let anyone in. Test: `tests/test_login.py::test_login_accountWithoutPassword_returnsSame401`. |
| I9 | **resolved** on the backend (frontend counterpart: N2) | The `mode="before"` validator strips the value (`app/config.py:73-77`). `google_login_configured` is `bool("")`, so whitespace-only counts as unset. `get_google_verifier` uses `settings.google_client_id or ""`. |
| I11 | **resolved** | `downgrade()` sets `SET LOCAL lock_timeout = '5s'` before `drop_table` (`alembic/versions/0107_user_identities.py:70-72`), matching the upgrade and 0108. |

I also read W5 (the register retry loop in `app/users/service.py`) as a related fix. The savepoint-per-attempt shape is correct. An `IntegrityError` re-reads the email as a 409, or retries with a freshly derived username. Two failures give the same 409. I found no new bug.

## Critical Issues
None.

## Warnings
None.

## Informational

### N1: the in-flight nonce request is per instance, not per page
- **Location**: `src/frontend/src/features/auth/useGoogleSignIn.ts:82`
- **Description**: `nonceRequest` is a `useRef`. StrictMode and same-instance refreshes are covered. A real unmount and remount is not: closing and reopening `AuthSheet` while a `/nonce` request is pending starts a second request. If the first response arrives last, the cookie holds a nonce the new GIS button was not initialized with, and that one sign-in gets a 401. The window is a single request's latency, and the existing error-then-refresh path recovers on its own.
- **Suggestion**: optional. Move the shared promise into a module-level variable, so all instances on the page share one in-flight request. The hook already assumes one live instance per page.
- **Fixable**: true

### N2: the frontend client ID is not trimmed
- **Location**: `src/frontend/src/lib/googleIdentity.ts:45-47`, `src/frontend/src/features/auth/useGoogleSignIn.ts:176`
- **Description**: the backend strips `GOOGLE_CLIENT_ID`, but `NEXT_PUBLIC_GOOGLE_CLIENT_ID` goes into `Boolean()` and `initialize` untrimmed.
  - **Whitespace-only value**: the skeleton shows briefly, then the `/nonce` 503 hides the block. This is harmless.
  - **Padded real ID**: GIS gets a different `client_id` from the audience the backend checks.
  - This is a build-time misconfiguration only.
- **Suggestion**: read the value once through a small `googleClientId()` helper that trims it, and use it in both places.
- **Fixable**: true

### N3: a grace-period refetch holds the JWKS lock for up to 5 s
- **Location**: `src/backend/app/auth/google.py:264-268,288-292`
- **Description**: during a Google outage the cache is past its TTL, and the 60 s backoff has lapsed. The first request then fetches under the lock, which can take up to `JWKS_FETCH_TIMEOUT_SECONDS = 5`. Concurrent sign-ins queue behind it, then get the grace key. That adds at most 5 s of latency to Google sign-ins once per minute during an outage. Password logins are unaffected, and this is far better than before the fix.
- **Suggestion**: none needed at current scale. If it matters later, serve the grace key at once and refresh in a background task (stale-while-revalidate).
- **Fixable**: false (a design trade-off)

## Metrics
- Max function length in the changed code: about 36 lines (`google_sign_in` in `router.py`)
- Max nesting depth: 3 levels
- Potential vulnerabilities: 0
- N+1 query risks: 0
- Secrets in code: none. `_DUMMY_PASSWORD_HASH` is a random value generated at runtime.

## Prioritized Recommendations
1. (Optional) N2: trim the frontend client ID, so the two stacks treat whitespace the same way.
2. (Optional) N1: move the shared nonce promise to module scope.
3. (Defer) N3: stale-while-revalidate for JWKS only if outage latency is ever observed.
