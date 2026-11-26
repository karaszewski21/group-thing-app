# Pragmatic Review (re-verification 1): Google sign-in and sign-up

## TL;DR
- Status: **Appropriate.** 0 critical, 0 warnings, 4 info (2 residual by owner choice, 2 new and minor).
- All three pragmatic warnings are closed. W3 now has one backend copy source, W5 uses the same loop shape in register and Google, and the unused GIS members from I3 are gone. W4 stays as specified, by owner decision.
- The new fixes (JWKS backoff and grace, the shared nonce request, the 1 s focus delay, the pending script promise, the dummy bcrypt hash) each guard a concrete failure mode. Each costs 5 to 25 lines. None adds a dependency, a layer or new state outside the instance that owns it, so they fit the project's scale.
- The only new nit is that `_DUMMY_PASSWORD_HASH` runs one full bcrypt `hashpw` when the router is imported. A precomputed hash literal would avoid that cost. This is optional.

## Key Decisions
- Finding IDs follow `verification/implementation-verification.md` (W3 copy, W4 snapshot, W5 retry shape, I3 GIS members, I4 `{created}`, I5 `party_id`), as listed in `orchestrator-state.yml` `verification_context`. The previous pragmatic report used its own numbering: its W1/W2/W3 correspond to W3/W4/W5 here, and its I1/I2/I3 to I3/I4/I5.
- **W4 is an accepted owner decision, not an issue.** The per-login email snapshot refresh, its commit and the `StaleDataError` → 401 branch stay, as R4.1 specifies.
- I4 and I5 were not selected for fixing. They remain residual info, and neither is a defect.
- I judged the new fixes by whether they guard a failure that can actually occur at this scale: one VPS, a single process-wide verifier, and real browsers including StrictMode in dev. I did not judge them by a minimal line count.

## Open Questions / Risks
- None blocking. The JWKS grace period (24 h) is a security/availability trade-off. It is safe because it only reuses keys that Google itself published and that were in our cache. It never accepts a `kid` we have not seen.

---

## 1. Executive Summary

| | |
|---|---|
| Overall complexity | Medium. That is proportionate for an auth surface. |
| Status | ✅ Appropriate |
| Critical | 0 |
| Warning | 0 |
| Info | 4 (I4, I5 residual; N1, N2 new) |

## 2. Resolution of Previous Findings

| ID | Finding | Status | Evidence |
|---|---|---|---|
| W3 | Polish Google copy defined twice in the backend | **Resolved** | `GoogleEmailTaken`, `GoogleEmailUnverified` and `GoogleSignInFailed` are now plain `Exception` subclasses with no message (`src/backend/app/auth/service.py:35-45`). The 503 copy exists once as `GOOGLE_UNAVAILABLE_COPY` (`src/backend/app/auth/google.py:60-62`). `GoogleKeysUnavailable` and `_GOOGLE_ERRORS[503]` (`router.py`) both reference that constant. A grep of the backend finds each Google string exactly once. The frontend `GOOGLE_ERROR_COPY` (`useGoogleSignIn.ts:15-20`) is the spec-required second stack copy and is not counted. |
| W4 | Per-login snapshot refresh is write-only | **Accepted (owner decision)** | Kept as specified in `_log_in_linked` (`service.py:67-80`) and the `StaleDataError` branch in `router.py`. This is not an issue. |
| W5 | Two retry shapes | **Resolved** | `register` (`src/backend/app/users/service.py`, end of file) and `sign_in_with_google` (`service.py:122-145`) now share the same skeleton: `for _attempt in range(2): try … except IntegrityError: <re-read> ; continue`, then commit/return, then a terminal raise after the loop. The re-reads differ only where the domain requires it, because Google also re-reads the identity. The previous asymmetry (register skipping the re-read on the second failure) is gone, and the docstring states the policy. |
| I3 | Unused GIS members; late popup signs in after unmount | **Resolved** | `GoogleIdApi` is now `initialize` + `renderButton` only, and `GoogleIdConfiguration` has no `cancel_on_tap_outside`/`use_fedcm_for_button` (`src/frontend/src/lib/googleIdentity.ts:15-38`). The callback is guarded by a `current` flag cleared in the effect cleanup (`useGoogleSignIn.ts`, render effect), and this is covered by the test "ignores a popup credential that arrives after unmount". |
| I4 | `loginWithGoogle` returns an unused `{created}` | **Residual (not selected)** | `src/frontend/src/auth/AuthContext.tsx:31,157` still returns `Promise<{ created: boolean }>`. It is harmless. |
| I5 | `party_id` costs a query on every linked login | **Residual (not selected)** | `src/backend/app/auth/service.py:76-79`. This is spec contract R5. |

## 3. Complexity Check of the New Fixes

| Fix | Size | Verdict | Reasoning |
|---|---|---|---|
| JWKS 60 s failure backoff + 24 h stale-key grace (`google.py:236-290`: `_failed_at`, `_grace_key`, two constants) | ~25 LOC, 4 tests | **Proportionate** | Without the backoff, every request queued behind the lock during a Google outage waits its own 5 s fetch, which stalls one uvicorn worker. The grace period keeps existing users signing in during a short outage, and it fails closed for unknown `kid`s and after 24 h. All state is per instance and the clock is injected, so the tests need no sleeps. There is no circuit-breaker library and no new class, just two timestamps and one helper. This is the simplest form of the behaviour. |
| Shared in-flight nonce request (`useGoogleSignIn.ts`, `nonceRequest` ref + `requestNonce`) | ~10 LOC, 1 test | **Proportionate** | It fixes a real 401: overlapping `/nonce` calls leave the cookie holding a different nonce than GIS was initialized with. StrictMode's double mount reproduces it every time in dev. Sharing one promise is the minimal fix. The ref lives on the component, so it survives the StrictMode remount, which is exactly why it is a ref and not a closure variable. |
| 1 s focus delay (`FOCUS_REFRESH_DELAY_MS`, `onFocus` → `onReturn`) | ~6 LOC | **Proportionate** | A closing popup refocuses the page just before GIS calls back. Without the delay, the refresh rotates the cookie before `inFlight` is set. A fixed short timeout re-checked through the same `onReturn` guard is the cheapest fix, and the alternatives (tracking the popup window, or a message channel) would be heavier. It is cleared on unmount. |
| Pending-promise script tag (`pendingScript` in `googleIdentity.ts`) | ~8 LOC, 1 test | **Proportionate** | A retry after the 10 s timeout used to add another listener pair to the same still-loading tag. Storing `{script, loaded}` once lets a retry reuse the pending promise. It is a module-level singleton, like `identityPromise`, so it adds no new pattern. |
| Dummy bcrypt hash in login (`router.py`, `_DUMMY_PASSWORD_HASH` + 3-line branch) | ~6 LOC | **Proportionate** (see N1) | One `verify_password` on every path makes an unknown email, a Google-only account (NULL hash) and a wrong password indistinguishable by timing. That matters now that Google-only accounts exist. The comment explains the why. |

Taken together, the fixes add about 55 production LOC across four files, with no dependencies and no new abstractions. Each new piece of state guards a named race or outage, and each has a test.

## 4. Remaining Info Items

**N1 (new, Low). `_DUMMY_PASSWORD_HASH` is computed with a full bcrypt `hashpw` when the module is imported.**
- Location: `src/backend/app/auth/router.py`: `_DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(16))`.
- Impact: about 0.2 to 0.3 s of CPU (default cost 12) on every process start and every test session import. It is not a correctness problem. The random input is also unnecessary, because any valid bcrypt hash works and no plaintext can be expected to match a fresh one.
- Suggestion: optionally replace it with a precomputed constant of the same cost, e.g. `_DUMMY_PASSWORD_HASH = "$2b$12$…"`, generated once with a comment saying it matches no password. This is not required. Fixable: yes, 5 min.

**N2 (new, Low). There is no test for the dummy-hash path itself.**
- Location: `src/backend/tests/test_login.py:91` covers the NULL-hash 401 envelope, but nothing asserts that `verify_password` runs when the user is unknown or the hash is NULL.
- Suggestion: none required. A timing test would be flaky. If wanted, add one case that monkeypatches `verify_password` and asserts it is called once for an unknown email. Fixable: yes, optional.

**I4, I5**: residual, as listed in section 2.

## 5. Developer Experience

The changes do not regress DX. The new constants are named and grouped at the top of `google.py`. `useGoogleSignIn.ts` grew to 200 lines, but its docstring now lists every timing rule (the 9 min refresh, the stale marking, the 1 s focus pause, the one shared request), so a reader does not have to reverse-engineer the effect. Tests stay sleep-free because the clock and fetch are injected on the backend and fake timers are used on the frontend.

## 6. Requirements Alignment

No feature has been added beyond the spec. The fixes change failure behaviour only: outage handling, a refresh race, timing parity and listener hygiene. W4 now matches R4.1 by explicit owner decision.

## 7. Context Consistency

- The retry policy has one shape across register and Google (W5).
- There is one backend copy source per Google error (W3). `DuplicateEmailException` keeps its own registration copy, and the Google route maps it to the Google 409 copy, which is correct and intentional.
- No dead code was introduced: `GOOGLE_UNAVAILABLE_COPY`, `pendingScript`, `nonceRequest` and `_grace_key` all have callers and tests.

## 8. Summary Statistics

| Metric | Previous review | Now |
|---|---|---|
| Backend copies of each Google error text | 2 | 1 |
| Retry loop shapes for the bootstrap race | 2 | 1 |
| Unused GIS type members | 3 | 0 |
| Unused returned fields (frontend) | 1 (`created`) | 1 (residual I4) |
| Production LOC added by the fixes | n/a | ~55 |
| New dependencies | 0 | 0 |

## 9. Conclusion

The re-verification passes from a pragmatic standpoint. W3, W5 and I3 are resolved, W4 is an accepted owner decision, and I4 and I5 remain as residual info. The verification fixes are each the smallest mechanism for a real failure mode and do not push the feature past what a small production app needs. Nothing blocks merging. N1 is an optional 5-minute polish.
