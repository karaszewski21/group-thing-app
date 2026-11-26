# Implementation Verification: Google sign-in and sign-up

## TL;DR
**Verdict: ⚠️ Passed with Issues** after re-verification cycle 1. Remaining: 0 critical, 5 warning, 13 info.
- All 14 applied fixes are confirmed resolved, and the fixes introduced no bugs. The owner kept W4 as specified and approved W8.
- Full suites after the fixes show no regressions: backend 1792/1794 (2 stale baseline failures) and frontend 2084/2117 (32 baseline failures plus 1 flake that passes alone). typecheck 0, mypy 15, ruff 64.
- The 5 remaining warnings are not code defects. D12 and D13 are deferred, and W11–W13 (live run with a real client ID, Cloud Console origins, visual and 375 px check) belong to Phase 12.
- Production readiness: **GO with mitigations** (score 90). Ship with the client IDs empty and enable after D14.

## Key Decisions
- The full suite was re-run because the code changed after the fixes. Results are in `test-suite-results.md`.
- New findings from the re-checks are all info-level and optional.
- W11–W13 are marked pending for Phase 12, not failures.

## Open Questions / Risks
- **E2E is blocked on setup.** Presence checks show `GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` and `AUTH_COOKIE_SECURE` set in none of the root `.env`, `src/backend/.env` or `src/frontend/.env.local`. The running containers predate the change: the nonce POST answers 405. Phase 12 needs:
  - the IDs set
  - `http://localhost:5173` and `:5174` registered as JS origins
  - a `pg_dump`
  - backend and web rebuilt (0107/0108 migrate on start)
- **Before enabling in production:** D14 (https domain, privacy policy, brand verification), the production origin in Cloud Console, a presence-only check of the VPS `.env`, and `pip-audit` on the new native dependencies.

## Executive Summary
The fixes did what they were meant to. A failed JWKS fetch now backs off 60 s and serves stale keys for up to 24 h. Nonce fetches are serialized. Each error copy has one source. The retry has one shape. Outcome logs carry no PII. The runbook puts the kill switch first, and login timing no longer depends on whether an account has a password. Re-checks by five reviewers confirmed every fix and found only optional info items. The feature is code-complete. What remains is a live end-to-end run against real Google, plus deferred hardening.

## Implementation Plan Verification
Completeness: **passed**. 50/50 steps, R1–R18 trace to code, and all 14 fixes were spot-checked at file:line.

## Test Suite Results
Source: `test-suite-results.md`, full run after the fixes.

| Suite | Result | vs baseline |
|---|---|---|
| Backend pytest (21m35s) | 1792 passed, 2 failed | the same 2 stale tests: `test_owner_items_page` nearest_privateCircleTerm, `test_terms_circle_occurs_on_index_migration` 0053 |
| Frontend vitest | 2084 passed, 33 failed | 32 baseline + 1 flake (`DeleteGroupDialog` focus, passes 4/4 alone); no auth/Google failures |
| tsc / mypy / ruff / ESLint | 0 / 15 / 64 / 10 errors + 28 warnings | 0 / 15 / 65 / 10 + 28 |

Pass rate is 99.9% backend and 98.4% frontend. Every remaining failure predates this change.

## Standards Compliance
**Compliant.** All 18 applicable standards are followed, and the owner approved the hand-made standards edits (W8).

## Documentation Completeness
**Complete.** The work-log has a dated fix entry. The runbook (`architecture.md` ~952–963) now has the kill switch first, a warning that restoring from a dump loses later writes, and the note that local uvicorn reads `src/backend/.env`. The earlier "nonexistent auth_cookie suite" finding was a false positive (`tests/test_auth_cookie.py` exists).

## Optional Reviews (re-check)
| Review | Status | Critical / Warning / Info | Report |
|---|---|---|---|
| Code review | all 10 re-checked fixes resolved, no new bugs | 0 / 0 / 3 | `code-review-report.md` |
| Pragmatic review | ✅ appropriate; fixes proportionate (~55 lines) | 0 / 0 / 4 | `pragmatic-review.md` |
| Production readiness | GO with mitigations (90, was 85) | 0 / 2 / 6 | `production-readiness-report.md` |
| Reality check | wiring intact; pending E2E | 0 / 3 pending / 4 | `reality-check.md` |
| Completeness | passed | 0 / 0 / 2 | `completeness-report.md` |

## Visual Fidelity
`visual-fidelity.md` does not exist yet; Phase 12 writes it. This section never gates the verdict.

## Issues Requiring Attention

### Warnings (remaining)
| # | Issue | Location | Status |
|---|---|---|---|
| W9 | No rate limit on Google, login or register routes | `src/frontend/nginx.conf` | deferred (D12) |
| W10 | CSP/COOP not set. When added: GIS sources + `same-origin-allow-popups` | headers | deferred (D13) |
| W11 | No live end-to-end run with a real client ID | dev stack | pending Phase 12 |
| W12 | Cloud Console JS origins unverified | operator | pending (operator) |
| W13 | Success criterion 8 (visual) + manual 375 px Tab/popup check | `SocialAuthButtons`, `AuthSheet` | pending Phase 12 |

### Info (remaining; all optional)
| # | Source | Issue | Location |
|---|---|---|---|
| I4 | pragmatic | `loginWithGoogle` returns an unused `{created}` (not selected) | `AuthContext.tsx:31,157` |
| I5 | pragmatic | One extra `party_id` query per linked login (spec contract R5) | `app/auth/service.py` |
| I6 | pragmatic | About 4 route tests duplicate unit-level cases (not selected) | `tests/test_google_login.py` |
| I8 | code_review | `.scalar_one()` would 500 if a profile were missing (theoretical; not selected) | `app/auth/service.py` |
| I10 | code_review + reality | GIS console warning on re-initialize per tab switch or refresh | `useGoogleSignIn.ts` `[session, tab]` effect |
| N1 | code_review | The shared nonce ref is per instance. Reopening `AuthSheet` mid-fetch can cost one 401, then it recovers | `useGoogleSignIn.ts:82` |
| N2 | code_review + production | Frontend does not trim `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (backend does) | `googleIdentity.ts:45-47`, `useGoogleSignIn.ts:176` |
| N3 | code_review | During an outage a grace-period refetch holds the lock ≤5 s about once a minute | `app/auth/google.py:264-292` |
| N4 | completeness | An unknown `kid` during backoff gets 503 instead of 401 (still fails closed) | `app/auth/google.py:258-286` |
| N5 | reality | Narrow race: the post-failure refresh can reuse a pre-POST nonce request, costing one 401 | `useGoogleSignIn.ts` `requestNonce` in the `onCredential` catch |
| N6 | pragmatic | The dummy bcrypt hash is computed at import (~0.2–0.3 s per process start); a precomputed constant would avoid that | `app/auth/router.py:60` |
| N7 | pragmatic | No test asserts the dummy-hash path still calls bcrypt | `tests/test_login.py` |
| N8 | completeness | `get_google_verifier` is cached before the 503 gate (harmless; settings are startup-only) | `app/auth/google.py` |

## Fix & Re-Verification History
Cycle 1. The owner selected the fixes, two implementers applied them, and the full suite and five reviewers re-checked them.

| Issue | Fix applied | Re-check outcome |
|---|---|---|
| W1 JWKS failure backoff | 60 s failure backoff and 24 h stale-key grace on the instance, with an injected clock; 3 tests | ✅ resolved: under the lock, fails closed past grace (code review, production) |
| W2 overlapping nonce fetches | One in-flight nonce request in a ref, shared by StrictMode's second mount and every refresh; test | ✅ resolved; residual edges N1/N5 (info) |
| W3 duplicated copy | Plain exception types; `_GOOGLE_ERRORS` + `GOOGLE_UNAVAILABLE_COPY` as the single sources | ✅ resolved: a grep finds each copy once |
| W4 snapshot refresh | Owner decision: kept as specified (R4.1) | accepted |
| W5 two retry shapes | `register` rewritten to the same `for _attempt in range(2)` loop | ✅ resolved; register tests unchanged and passing |
| W6 outcome logs | INFO `ok created=`, `email_unverified`, `email_taken` with no PII; test covers 5 outcomes | ✅ resolved |
| W7 runbook | Kill switch first; dump restore loses later writes | ✅ resolved (`architecture.md` ~956/963) |
| W8 hand-made standards edits | Owner approved them as written | ✅ resolved |
| W14 static skeleton | `animate-pulse` on `bg-line` | ✅ resolved |
| I1 focus/callback race | 1 s deferred focus refresh with a re-check; `visibilitychange` requires `hasFocus` | ✅ resolved |
| I2 listener stacking | One pending promise per GIS script tag | ✅ resolved |
| I3 unused GIS members, late callback | Members removed; callback ignored after unmount (test) | ✅ resolved |
| I7 login timing | Always one bcrypt verify (dummy hash for a missing user or NULL hash) | ✅ resolved; N6/N7 optional follow-ups |
| I9 whitespace client ID | Backend validator strips it | ✅ resolved on the backend; frontend counterpart N2 (info) |
| I11 0107 downgrade lock | `SET LOCAL lock_timeout = '5s'` | ✅ resolved |
| I12 stale names, local env note | Docstrings fixed; runbook names `src/backend/.env` | ✅ resolved |

## Overall Assessment
| Dimension | Result |
|---|---|
| Implementation | ✅ 100% (50/50, R1–R18) |
| Tests | ✅ no regressions in the full suites |
| Standards | ✅ compliant |
| Documentation | ✅ complete |
| Security | ✅ all checks pass; login timing hardened |
| Production | ⚠️ GO with mitigations (feature off until D14) |
| End-to-end | ⏳ pending Phase 12 |

## Recommendations
1. Prepare and run Phase 12:
   - set both client IDs locally (never print them)
   - register the localhost origins
   - run `pg_dump`
   - rebuild backend and web
2. Optional cleanup in a later pass: N2 (frontend trim), N6/N7 (precomputed dummy hash + test), N1/N5 (module-level nonce promise; fresh request after a failed POST), I10 (split the initialize/renderButton effects).
3. Before enabling in production: D14, the production origin, a VPS `.env` presence check, pip-audit, and ideally D12 (rate limit).

## Verification Checklist
- [x] Full test suite (re-run after fixes)
- [x] Completeness checker
- [x] Code review, pragmatic review, production readiness, reality check (all re-run)
- [x] All reports present on disk
- [x] Fix & re-verification history recorded
- [ ] E2E / visual fidelity (Phase 12)
