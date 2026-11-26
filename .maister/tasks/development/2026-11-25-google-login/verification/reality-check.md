# Reality Check: Google sign-in and sign-up (re-verification after fixes)

## TL;DR
- The fixes did not break the wiring. All seven links still connect: button → single shared nonce POST → GIS `initialize`/`renderButton` → callback (now dropped after unmount) → `POST /api/auth/google` → resolution → token → `applyToken` → AuthGuard reload or sheet close.
- Test results (read from `test-suite-results.md`, not re-run): backend 1792/1794 and frontend 2084/2117. Every failure is a baseline failure or the known DeleteGroupDialog flake. There are no regressions, and all auth and Google files pass. tsc 0, mypy 15, ruff 64.
- Every previous code-level finding is resolved or accepted. The runtime proof is still missing: no client ID is set in any env file, and the running stack predates the change (the nonce POST answers 405 on :5173, :5174 and :8080). That proof is Phase 12 work.
- Verdict: **⚠️ Issues Found (pending E2E)**. The code is complete and ready for Phase 12. It is not "done" until W11–W13 pass there.

## Key Decisions
- I did not run any test suite (`skip_test_execution: true`) and did not rebuild or restart the stack. The 405 probe was a bodyless status-code check only.
- I count W11, W12 and W13 (live run, Cloud Console origins, criterion 8 and the 375 px check) as **pending Phase 12**, not as failures.
- Secrets: I only checked whether each variable is present. `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `AUTH_COOKIE_SECURE` each have a count of 0 in the root `.env`, `src/backend/.env` and `src/frontend/.env.local`. No values were printed.

## Open Questions / Risks
- Before Phase 12 can start, someone has to set both client IDs where each process reads them, register the JS origins `http://localhost:5173` and `:5174`, run `pg_dump`, and rebuild backend and web (0107 and 0108 migrate on start).
- R1 (new, Low): a nonce request that started just before a failed POST can be shared by the post-failure refresh. If its `Set-Cookie` lands before the POST's cookie-clear, the next attempt gets the generic 401, and the refresh after that fixes it. This window is very narrow because the timer and focus refreshes are blocked while the popup holds focus or a POST is in flight.

---

## 1. Inputs reviewed

| Source | State |
|---|---|
| Previous `reality-check.md` | ⚠️ G1–G3, I1–I5 |
| `implementation-verification.md` | ⚠️ 0 critical, 14 warning (W1–W14), 12 info |
| `orchestrator-state.yml` `verification_context` | Fixes W1, W2, W3, W5, W6, W7, W14, plus I1, I2, I3, I7, I9, I11, I12. W4 and W8 kept by owner decision; W9 and W10 deferred (D12, D13) |
| `test-suite-results.md` | passed_with_issues, 0 regressions |
| `git diff` | 31 tracked files changed (+908/−127) plus the untracked new files |

## 2. Path re-trace after the fixes

| # | Step | Evidence (current code) | Holds? |
|---|---|---|---|
| 1 | Button | `SocialAuthButtons.tsx`: shows a skeleton (now `animate-pulse`, W14) while loading. When ready it shows the slot `div` with `slotRef`. When hidden it renders nothing, or only the alert after a failure. Still mounted through `AuthTabs` on `/login` and `AuthSheet`. | Yes |
| 2 | Nonce POST, single in-flight | `useGoogleSignIn.ts::requestNonce` keeps one pending promise in the `nonceRequest` ref and clears it on settle. The initial fetch, the 9-minute timer, the focus/visibility return and the post-failure refresh all go through it. StrictMode's second mount reuses the first mount's request because the ref survives the remount, and the disposed closure's `setSession` is skipped (`disposed`/`generation`). So the cookie holds the nonce GIS is initialised with. Backend `google_nonce` is unchanged: 503 gate, `no-store`, cookie set. Test: "shares one pending nonce request between StrictMode's double mount and overlapping refreshes". | Yes |
| 3 | GIS initialize | Second effect `[session, tab]`: `initialize({client_id, nonce: session.nonce, callback, ux_mode:"popup", auto_select:false})`, then `renderButton(slot, …)`. The loader now keeps one pending promise per script tag (`pendingScript`), shares it on a retry after a timeout, and replaces a stale tag (I2). The public `GoogleIdApi` still has `initialize` and `renderButton`, which is all the hook uses (I3 type trim). | Yes |
| 4 | Callback, ignored after unmount | The callback closure checks the effect-local `current`, which cleanup sets false on unmount, on a tab switch and on a new session. So a late popup credential never reaches `onCredential`. A tab switch or nonce refresh re-runs `initialize`, which registers a fresh live callback. The `inFlight` guard still drops repeat callbacks. Focus refresh is deferred 1 s and re-checks `inFlight`/`hasFocus` (I1), so a closing popup's credential always wins over the refresh. Tests: "ignores a popup credential that arrives after unmount", "does not refresh while a POST is in flight". | Yes |
| 5 | `POST /api/auth/google` | `AuthContext.loginWithGoogle` is unchanged: a same-origin `fetch` that sends the Path-scoped cookie, turns a non-OK response into an `ApiError`, and calls `applyToken` on success. The route reads the cookie, calls `verifier.verify` and then `sign_in_with_google`, and every outcome clears the cookie. Each outcome now writes one INFO line with no personal data (W6). | Yes |
| 6 | Resolution | `service.py::sign_in_with_google`: an identity hit logs in (200); an unverified email gives 403; a registered email gives 409; otherwise a savepoint bootstrap gives 201. The `IntegrityError` path re-reads and retries in one `for _attempt in range(2)` loop, and register now uses the same shape (W5). Verifier: after a failed JWKS fetch it backs off 60 s and serves cached keys for up to 24 h past expiry, then fails closed with 503 (W1). Cached unexpired keys are never blocked by the backoff. Copies: `_GOOGLE_ERRORS` and `GOOGLE_UNAVAILABLE_COPY` on the backend; `GOOGLE_ERROR_COPY` on the frontend. The 401, 403, 409 and 503 strings are identical across the two stacks (checked by eye) (W3). | Yes |
| 7 | Token → `applyToken` → AuthGuard / sheet close | `encode_login_token(username, load_permissions(...))`, the same claims as password login. `AuthGuard`, `AuthSheet` and `useAccountGate` are not in the diff, so the reload-to-`returnTo` and close-on-token behaviour is unchanged. After success, the unmount also turns off the GIS callback (step 4). | Yes |

**Config gates:** `GOOGLE_CLIENT_ID` is now stripped, so a whitespace-only value counts as unset (I9). The compose, Dockerfile `ARG`/`ENV` and `.env.example` placeholders are unchanged and consistent.

**Password login (I7):** an unknown email and a NULL hash both run one bcrypt verify against `_DUMMY_PASSWORD_HASH`. The condition `user is None or password_hash is None or not password_ok` still rejects both with the same 401. The verify result is never trusted on its own.

## 3. Previous reality findings

| ID | Finding | Status |
|---|---|---|
| G1 | No end-to-end run against real Google | **Pending Phase 12 (W11).** Client IDs are still absent everywhere; the stack is old (405 on :5173, :5174 and :8080) |
| G2 | Visual fidelity and the 375 px focus-trap/popup check | **Pending Phase 12 (W13)** |
| G3 | Cloud Console origins checklist | **Pending Phase 12 (W12).** The runbook now opens with the kill switch and names `src/backend/.env` for local uvicorn (W7, I12), but the operator still has to register the origins in the Console |
| I1 | Dead end for Google-only users on password login | **Residual, accepted (D4/D10).** I7 also makes the timing identical, so the account's provider cannot be inferred |
| I2 | Repeated `initialize` on every tab switch | **Residual, Info.** The effect is still keyed on `[session, tab]`, so GIS may still warn about multiple `initialize` calls. It works; check the console in E2E |
| I3 | Verifier client ID frozen at first use | **Residual, harmless.** Changing the setting needs a restart anyway |
| I4 | Local uvicorn reads `src/backend/.env` | **Resolved (documented, I12)** |
| I5 | FedCM migration | **Residual, Info.** Watch the GIS console warnings in E2E |

## 4. Verification warnings (W1–W14) as they stand now

| ID | Status |
|---|---|
| W1 JWKS backoff and grace | Resolved (3 tests) |
| W2 overlapping nonce fetches | Resolved (test) |
| W3 duplicated copy | Resolved |
| W4 per-login snapshot refresh | Kept by owner decision |
| W5 two retry shapes | Resolved |
| W6 outcome logs | Resolved |
| W7 runbook kill switch and restore note | Resolved |
| W8 standards edited by hand | Approved by owner |
| W9 rate limit, W10 CSP/COOP | Deferred (D12, D13); not blocking while the feature is off |
| W11 live run, W12 Console origins, W13 criterion 8 and 375 px | **Pending Phase 12** |
| W14 static skeleton | Resolved |

## 5. Success criteria

Criteria 1–7 and 9 are still ✅, and the full suites confirm it (the auth and Google files all pass; tsc 0). Criterion 8 is **pending Phase 12**. **Functional completeness: about 90%** (code and tests complete; runtime proof outstanding).

## 6. New observations
- **R1 (Low):** a post-failure refresh can share a nonce request that was already in flight. Details are under Open Questions / Risks. It fixes itself after one extra failure. If it shows up in E2E, the fix is to start a new request after a POST instead of sharing one.
- **N1 (Info):** `test-suite-results.md` reports an ESLint warning (set-state-in-effect) at `AuthContext.tsx:98`. That line is in the pre-existing `useLayoutEffect`, not in `loginWithGoogle`, and the totals are unchanged.

## 7. Pragmatic action plan (Phase 12)

| # | Task | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Register the JS origins `http://localhost:5173` and `:5174` (and later the production origin) on the dev OAuth Web client | Origins listed in the Console | High | 15 min |
| 2 | Set `GOOGLE_CLIENT_ID` in the root `.env` (compose) and `src/backend/.env` (uvicorn), and `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the root `.env` and `src/frontend/.env.local`. Use presence checks only. `pg_dump`, then rebuild backend and web | The nonce POST answers 200 with `Set-Cookie: aj_google_nonce` on :5173 and :5174 | High | 20 min |
| 3 | E2E: first sign-up (201) through `/login?returnTo=/oauth2/authorize…`; repeat sign-in (200); a password-account email (409 copy plus "Zaloguj się"); `AuthSheet` on an item page closes in place; a tab switch keeps a working button | All observed, with no unexpected 401 | High | 1 h |
| 4 | Visual check against the seven mockups, plus the 375 px `AuthSheet` Tab/popup check | `visual-fidelity.md` with no ✗ entries; focus stays in the sheet | Medium | 45 min |

## 8. Completion verdict

**⚠️ Issues Found: code-complete and correctly wired after the fixes, with end-to-end proof pending.** The fixes tightened the nonce lifecycle, the late-callback handling, JWKS resilience, the copy sources, logging and login timing, and none of them broke a link in the chain. The full suites show no regressions. What remains is W11–W13, all for Phase 12. Close the task once action items 1–4 pass.
