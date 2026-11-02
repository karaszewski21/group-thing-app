# Implementation Verification: Vite 8 + React Router 7 SPA → Next.js 16.4.4 App Router

## TL;DR
❌ **Failed, fixable.** 1 critical, 13 warnings, 11 info. The critical one is an open redirect through `?returnTo=`. It existed before the migration, but Next now follows absolute URLs, which makes it exploitable.
Everything planned was built. Vitest has 1469 cases with 0 regressions against A0, and pytest is 1138/0.
The dev browser smoke passed 58 of 63 runnable rows. Two of the failures are real regressions: a stale cookie lands on `/login`, and the `events` plugin's SDK is blocked by CORS.
All three must-fix items are small. The compose smoke (6 rows) is deferred to the user.

## Open Questions / Risks
- **Uncommitted work.** Everything from B1 to D exists only in the working tree, because the user asked for no commits after C6. `analysis/rollback-plan.md` still describes commits C7–C13, which do not exist. A backup (patch + untracked tarball) is in the session scratchpad, which is a temporary folder.
- **Compose not run against the real backend.** Server-side metadata through nginx, OAuth2 through nginx, `/.well-known` and Spaces uploads are only verified in dev or against a stub.
- **Root `.env` needs a rename.** It still uses `VITE_GOOGLE_MAPS_API_KEY`, so compose builds `web` without a Maps key (manual mode).
- **Not ready for public production.** Missing: TLS, healthchecks and restart policies, security headers (the OAuth2 consent page can be framed), error tracking and rate limiting. Most of this predates the migration.
- **Admin smoke (S13a) not run.** The dev DB has no working ADMIN login.

## Executive Summary
All 17 task groups are implemented and spot-checked in code. The app runs on Next 16.4.4: 62 thin pages, `proxy.ts`, server metadata and palette, an Emotion SSR registry, and a standalone deploy behind nginx. The backend accepts the `auth_token` cookie on GET/HEAD only, sends `Vary: Authorization, Cookie` and returns a JSON 404 for page paths.
Automated suites show no regressions. The browser smoke found two regressions, and code review found one critical security issue that the move to Next made exploitable. All three are small, contained fixes.

## Implementation Plan Verification (completeness-report.md)
- **Checkboxes:** 141 lines, 134 `[x]` and 7 `[~]`. Six `[~]` are skipped commits (user: no commits). The seventh is 14.7, where only the `web` image was built.
- **Marker inconsistency:** 8.8 is marked `[x]` although its commit was skipped.
- **Spot-checks:** every group's claimed code exists, including the route tree, proxy rules, facade, `api/server.ts`, the backend token, Vary, slug and 404 changes, and the deploy files.
- **R1–R21:** satisfied, except for these.

  | Requirement | Status |
  |---|---|
  | R9 (62 pages, not 61) | Documented deviation |
  | R10 (`eslint-plugin-react-refresh` kept) | Documented deviation |
  | R13 | Dead helpers left behind |
  | R15 | Smoke now run, compose part deferred |
  | R16 | Stale tracked `src/resources/static/assets/plugin-sdk.js`; plan step 10.4 named the wrong path |

## Test Suite Results
Not re-run (user choice). These are the results of the final C13 gate, taken about 30 minutes before verification with no code changes since. The completeness checker and the reality assessor each recomputed them independently.

| Suite | Result |
|---|---|
| Vitest | 1469 cases, 1457 pass / 12 fail. The 12 already fail in A0. 0 baseline-passing cases lost; the 183 missing ids are documented renames. |
| pytest | 1138 passed / 0 failed. 18 `[missing]`: 13 deleted with their routes, 5 uuid4-id false positives. |
| tsc / next build | Both pass |
| eslint | 13 errors (baseline 15) |
| ruff | 76 (equal to baseline) |
| mypy | 15 (equal to baseline) |

## Browser Smoke (e2e-smoke-report.md, smoke-checklist.md)
Dev mode: uvicorn on :8080 and `next dev` on :5173.

| Result | Rows |
|---|---|
| PASS | 58 |
| FAIL | 5: S04a, S04b, W04, S13c, and the dev half of W07 |
| BLOCKED | 1: S13a, no ADMIN login |
| DEFERRED (compose) | 6: S13e, S14e, S16a–c, W06, plus the compose halves of W03 and W07 |

- **Stale cookie → `/login` (S04a, S04b, W04).** Regression. Chain:
  1. `app/layout.tsx:13` passes the raw cookie as `initialToken`.
  2. `PublicLayout` renders logged-in chrome outside `ClientOnly`, so its queries fire before `AuthContext` reconciles the token.
  3. The backend answers 401, and `api/client.ts:38-45` redirects to login.
  
  The old `loadStoredAuth()` dropped invalid tokens at module load. `panelSessionHydration.test.tsx` passes despite the bug because the API is mocked.
- **Plugin SDK CORS (S13c, W07 dev).** Regression in dev only. `plugins/events/index.html:7` loads the SDK with `crossorigin`. Vite allowed localhost origins by default; Next sends no `Access-Control-Allow-Origin` for `public/assets`.
- **Test data left in the dev DB.** A throwaway EDIT user created everything below; delete that account. Its password appeared once in a tool transcript.
  - organization `smoke-org-1367`
  - a place
  - 2 events
  - 2 items
  - a group with a term
  - a family member
  - a conversation
  - OAuth2 client `d151a858…`

## Standards Compliance
Mostly compliant (completeness-report.md):
- **Minimal implementation:** two dead backend helpers and a stale SDK copy remain.
- **Backend security:** `GET /api/groups/{id}/join-code` writes lazily, which conflicts with the new "GET routes are side-effect free" rule.
- **Frontend testing:** all new test files use explicit vitest imports and have no response-type casts.
- **Secrets:** only presence checks were made, and no values were written anywhere.

## Documentation Completeness
Adequate. The work-log covers every group, and the docs from Groups 15 and 17 match the code. Missing: an "as built" note in spec.md and the plan (61→62 pages, react-refresh, nginx whitelist, Emotion registry, the 10.4 path), and the stale rollback plan.

## Optional Review Results
| Review | Status | Headline |
|---|---|---|
| Code review | ❌ critical_issues (1 / 2 / 12) | C1: open redirect via `returnTo`. W1: no timeout in `serverGet`. W2: raw JWT embedded in every page's HTML/RSC payload. |
| Pragmatic review | ✅ Appropriate (0 / 4 / 10) | Nothing is over-engineered. W1: dead helpers. W2: the frontend `.dockerignore` is never applied. W3: deep relative imports. W4: two hooks lint rules are off for all code. |
| Production readiness | ⚠️ GO with mitigations for the MVP; NO-GO for public production (5 / 9 / 9) | Public-production blockers: TLS, healthchecks, security headers, error tracking, rate limits. |
| Reality check | ⚠️ ready_with_fixes | Two smoke regressions confirmed in code. The open redirect predates the migration but is cheap to fix. Must-do list takes about 2 hours. |

## Overall Assessment
| Area | Status |
|---|---|
| Plan implementation | ✅ 100% (commit steps skipped by user decision) |
| Automated tests | ✅ 0 regressions |
| Browser smoke (dev) | ⚠️ 58/63 runnable rows (92%), 2 regressions |
| Standards | ⚠️ minor gaps |
| Docs | ✅ adequate (as-built note missing) |
| Security | ❌ 1 critical (open redirect) |
| Deploy | ⚠️ checked against a stub only; compose deferred |
| **Overall** | **❌ Failed, all items fixable** |

## Issues Requiring Attention
### Critical
1. **Open redirect via `?returnTo=`** (code_review, reality).
   - Where: `src/frontend/src/auth/AuthGuard.tsx:51-57` and `src/frontend/src/features/auth/OnboardingPage.tsx:48,51,62`.
   - Fix: validate with `isSafeReturnPath` from `utils/url.ts` and fall back to the home path. Add tests for `https://evil`, `//evil` and `/\evil`. Fixable.

### Warnings
2. **Stale cookie ends on `/login`** (smoke regression S04a, S04b, W04; reality G3).
   - Where: `src/frontend/src/app/layout.tsx:13`.
   - Fix: pass only a non-expired token, or better, a session flag or claims. Add a test with the 401 path left unmocked. Fixable.
3. **Raw JWT in the HTML/RSC payload of every page** (code_review W2, reality G6). Where: `app/layout.tsx:13,26`. Same fix as item 2. Fixable.
4. **Plugin SDK blocked by CORS** (smoke regression S13c and W07).
   - Where: `src/frontend/next.config.ts`, `plugins/events/index.html:7`.
   - Fix: add `headers()` with `Access-Control-Allow-Origin` for `/assets/:path*`, or drop `crossorigin` from the plugin. Fixable.
5. **No fetch timeout in `serverGet`** (code_review W1, production W5). Where: `src/frontend/src/api/server.ts:16`. Fix: `AbortSignal.timeout(3000)`. Fixable.
6. **Env files can reach the image** (production W2, pragmatic W2).
   - The root `.dockerignore` does not exclude `.env*` or `*.local`, and `src/frontend/.dockerignore` is never applied.
   - If `src/frontend/.env.local` existed, Next would copy it into the standalone image.
   - Fixable.
7. **Stale rollback plan and uncommitted work** (reality G2, production W3, completeness 3 and 6).
   - Where: `analysis/rollback-plan.md`.
   - Fix: rewrite the plan for "C6 plus working tree". The user decides whether to commit or stash. Plan fix: fixable. Committing: user decision.
8. **Compose smoke deferred and Maps key not renamed** (reality G5, production W1). User action: rename the key in the root `.env`, rebuild the backend with `hf_token`, then run the 6 deferred rows. Not fixable here.
9. **No `error.tsx` or `global-error.tsx`** (production W4). Without them, render errors show Next's default English screen. Fixable.
10. **Dead code and stale files** (completeness 1 and 2, pragmatic W1). Fixable.
    - `events/service.py:202 get_event_preview`
    - `organizations/media.py:120 load_public_cover_url`
    - the `PublicOrganizationResponse` docstring
    - the tracked `src/resources/static/assets/plugin-sdk.js`
11. **`GET join-code` writes data** (completeness 7, code_review I1, production info). It conflicts with `standards/backend/security.md:53` now that the cookie authenticates GET requests. Fix: move it to POST or record an exception. Fixable; needs a decision.
12. **Two hooks lint rules are off for all code** (pragmatic W4). `react-hooks/set-state-in-effect` and `react-hooks/refs`. Fix: set them to `warn`. Fixable.
13. **Public-production blockers** (production critical 1–5): TLS, healthchecks and `restart:` (W7), security headers including `frame-ancestors` for the OAuth2 consent page, error tracking, rate limiting. They block only a public deploy and mostly predate the migration. Partly fixable.
14. **Deep relative imports in route files** (pragmatic W3). Fix: add an `@/*` alias. Fixable.

### Info
- S13a has not run: no ADMIN login.
- nginx caches upstream IPs, so it returns 502 after `web` is recreated (production W6).
- `X-Forwarded-Proto $scheme` behind a TLS terminator, and the token `iss` follows the Host header (code_review I3, production W9).
- `resolveTo` and `setSearchParams` use the raw `usePathname()`, and navigation state is keyed with inconsistent encoding (code_review I5, I6).
- `OAuth2AuthorizePage` reads localStorage directly (code_review I12).
- Leftover `index.html` in the AUTHORIZATION_MATRIX row 9 regex.
- Plan marker 8.8 is `[x]` instead of `[~]`, and spec.md has no as-built note.
- Stray folder `.maister/tasks/migrations/2026-11-02-vite-to-nextjs-frontend/`, a stale `src/frontend/dist/`, and the Vite-template `src/frontend/README.md`.
- Backend paths are listed in three places: nginx, `next.config.ts` and the `proxy.ts` matcher.
- Test gaps: no unsafe-`returnTo` test, no SSR test for providers, no timeout test, no case or encoding variants in the proxy tests.
- `X-Powered-By` header and the nginx version are exposed.

## Recommendations
Must fix before calling the migration done, then re-run S04a, S04b, W04 and S13c plus the Vitest gate:
- item 1
- items 2 and 3 together
- item 4
- the rollback-plan rewrite from item 7

Cheap to add in the same pass: items 5, 6, 9, 10 and 12.
Follow-ups: item 8 (user compose smoke), item 11 (decision), item 13 (public production), item 14, and the info items.

## Verification Checklist
- [x] Completeness checker: completeness-report.md
- [~] Test suite: not re-run (user choice); C13 gate results used
- [x] Code review: code-review-report.md
- [x] Pragmatic review: pragmatic-review.md
- [x] Production readiness: production-readiness-report.md
- [x] Reality check: reality-check.md
- [x] Browser smoke (dev): e2e-smoke-report.md, smoke-checklist.md, smoke/
- [ ] Compose smoke: deferred to the user
- Roadmap: `.maister/docs/project/roadmap.md` does not exist, so there was nothing to update.
