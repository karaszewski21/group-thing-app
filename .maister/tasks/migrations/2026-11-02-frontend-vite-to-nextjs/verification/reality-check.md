# Reality Check: Vite 8 + React Router 7 SPA → Next.js 16.4.4 App Router

## TL;DR
- **Status: ⚠️ ready_with_fixes.** The migrated app works end to end for real users in dev: 58 of 63 runnable smoke rows pass, Vitest has 0 regressions (1469 cases), and pytest is 1138/0. The "no regressions" goal is **not met yet**. Two smoke failures are genuine regressions compared with the Vite app.
- **Regression 1 (stale cookie → `/login`)**: confirmed in code. The Vite app dropped expired or garbage tokens at module load, before any render. Next seeds `AuthProvider` with the raw cookie, so the header queries in `PublicLayout` fire once with that token. Real-user exposure is low, because the cookie's `Max-Age` tracks `exp`. The fix is small.
- **Regression 2 (plugin SDK CORS)**: dev-only. Vite's default `server.cors` allowed localhost origins; `next dev` and nginx send no ACAO header. It affects only `plugins/events`, which uses `crossorigin`. The fix is one line.
- **The open redirect (C1) is pre-existing**: the code is byte-identical at `3164a6c`. The migration widens it from `//evil` to any `https://evil`. It is cheap to fix, so fix it before calling the migration done. The biggest non-code risk is that all of B1–D exists only as uncommitted changes.

## Key Decisions
- **S04a/S04b/W04 count as a regression, rated warning.** The pre-migration `loadStoredAuth()` (`git show 3164a6c:src/frontend/src/auth/AuthContext.tsx`) ran `isTokenExpired` at module load, so a garbage or expired token never reached a render and the landing page showed. The 401 → `/login` redirect in `api/client.ts` is unchanged from `3164a6c`, and so is not the defect. The new defect is the unsanitised `initialToken`. The severity is warning, not critical: `setSession` writes `Max-Age = exp − now`, so a real user's cookie expires together with its JWT. The failure needs a garbage cookie, a cookie from another app on `localhost` (cookies ignore the port, localStorage does not), or a JWT the server rejects. That last case already redirected to login in the Vite app.
- **S13c/W07 count as a dev-only regression, rated warning.** The old `vite.config.ts` had no `server.cors` override, so Vite 8's localhost-origin default answered the `crossorigin` request. The old compose nginx served `/assets` without ACAO either, and the plugins hard-code `http://localhost:5173`, so compose and production were never covered. `box-size`, `warehouse` and `ai-description` load the SDK without `crossorigin` and keep working. `plugins/events` is "kept but not mounted" (architecture.md).
- **C1 is pre-existing but must be fixed before "done".** `AuthGuard.tsx` lines 41-47 and `pages/auth/OnboardingPage.tsx` lines 48-62 at `3164a6c` pass `returnTo` through raw, exactly as today. Under RR7 `createBrowserRouter`, only `//host` could escape, through the `pushState` SecurityError → `location.assign` fallback; I could not verify this at runtime because RR is uninstalled. Under Next, any absolute URL triggers an MPA navigation. `isSafeReturnPath` already exists, so the fix is about 5 lines.
- **The Vitest gate stands.** I recomputed it from the JSON files. 0 A0-passing ids fail in C13. The 12 failures were all `failed` in A0. The 183 A0 ids missing from C13 are all theme tests whose names embed the old `pages/…` paths, the documented renames.
- **I did not run tests, servers or compose** (`skip_test_execution: true`). Every verdict comes from code reading plus the stored gate and smoke artifacts.

## Open Questions / Risks
- **The uncommitted working tree is the only copy of B1–D.** That is about 90 paths, including all of `src/frontend/src/app/`, `proxy.ts`, `next.config.ts` and `api/server.ts`. A single `git checkout .` or `git clean` loses the migration, and the rollback plan still describes C7–C13 commits that do not exist.
- **The compose path with the real backend has never run.** Group 14 ran an isolated network with a backend *stub* (pages 200/404, assets 200, the POST authorize rewrite, 15 MB OK and 17 MB → 413), so the routing is largely covered. What remains unverified: `web` → `backend:8080` server fetches against real data (OG and palette on `/:slug` through nginx, S16c), real OAuth2 through nginx (S14e), `/.well-known` (S16b), and the photo upload through Spaces (S16a/W06). For an MVP with no production this is a user-run follow-up, not a blocker. The Maps key in the root `.env` still has the `VITE_` name, so a compose build produces Maps in manual mode.
- **S13a (ADMIN walk-through) was not run.** Admin pages mount client-only behind `ClientOnly`, the EDIT-side admin rows (S13b, W12) pass, and Emotion hydration passed on the public pages. The residual risk is low, but the user should spend 5 minutes with a real ADMIN login.
- **The JWT in the RSC payload (code review W2)** shares a root cause with regression 1: `layout.tsx` hands the raw cookie to the client. One change, passing only validated claims or `hasSession`, fixes both.

---

## Reality vs Claims

| Claim | Reality | Evidence |
|---|---|---|
| All 17 groups done (134 `[x]`, 7 `[~]`) | True for code. The 6 skipped commits are a process deviation, and it creates the rollback risk above | completeness-report.md |
| Vitest: 0 regressions | **True** (recomputed) | `gates/vitest-C13.json` vs `baseline/vitest-A0.json`: 12 failed, all failed in A0 |
| pytest: no new failures | **True**: 1138 passed (A0: 1136). The `test_public_preview.py` removal is documented | `gates/pytest-C13.txt` |
| No user-facing regressions | **False**: 2 regressions (stale cookie, plugin SDK CORS in dev) | `smoke/S04-W04-stale-cookie.json`, `smoke/S13c-W07-plugin.json` |
| Deploy (D10) works | Partly: verified with a backend stub, never with the real backend | work-log Group 14, smoke compose rows DEFERRED |
| The unit test for the stale-session flow passes | Passes, but proves nothing about the defect: the API is mocked, so the 401 → redirect path never runs | `test/panelSessionHydration.test.tsx` (noted in e2e-smoke-report) |

## Root Cause: Stale Cookie (S04a, S04b, W04), confirmed by reading the code
1. `src/frontend/src/app/layout.tsx:13` reads `auth_token` and passes it as `initialToken` without checking it.
2. `auth/AuthContext.tsx:54`: `useState(initialToken)`. The first render is "logged in".
3. `PublicLayout.tsx:46,53` renders `NotificationBell` and `PendingActionsHost` when `token` is set. `BottomNav` uses `useUnreadMessages`. Both are gated `enabled: token !== null` (`hooks/useNotifications.ts:37`, `hooks/useUnreadMessages.ts:25`). They sit outside `ClientOnly`, so they render on the first commit.
4. `useLayoutEffect` (`AuthContext.tsx:93-97`) runs `reconcileSession()`. That clears localStorage and the cookie, and calls `showToken(null)`. The resulting sync re-render first flushes the first commit's passive effects, where TanStack Query subscribes and starts fetching with the stale `enabled: true`.
5. Those requests carry no credentials, because storage has just been cleared, and get 401. `api/client.ts:38-45` then redirects to `/login?returnTo=%2F`. This handler is unchanged from `3164a6c`.
6. The rest of the chain is correct: the `proxy.ts` rewrite `/` → `/home` on any cookie, followed by `PanelGate`'s `anonymousHome` → `LandingPage`. The landing page would render if step 5 never happened.

Pre-migration: `loadStoredAuth()` applied `isTokenExpired` (garbage counts as expired because it has no `exp`) at module load, so `token` was `null` from the first render. **This is a regression.**

## Root Cause: Plugin SDK CORS (S13c, W07 dev half), confirmed by reading the code
- `plugins/events/index.html:7` (and its `dist/`): `<script src="http://localhost:5173/assets/plugin-sdk.js" crossorigin>`.
- The old `vite.config.ts` had only `server.proxy`, so Vite 8's default `server.cors` (localhost origins) answered with ACAO.
- `next.config.ts` has no `headers()`. `nginx.conf` `location /` is a plain `proxy_pass http://web:3000`.
- This is a regression in dev only. The compose and production halves never worked, because the plugins point at `:5173` and the old nginx sent no ACAO.

## Gaps

| # | Severity | Gap | Location | Regression? | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| G1 | critical | Open redirect through `?returnTo=` after login or register | `src/frontend/src/auth/AuthGuard.tsx:51-57`, `src/frontend/src/features/auth/OnboardingPage.tsx:48,51,62` | Pre-existing; the migration widens it to any absolute URL | true | Filter through `isSafeReturnPath` (`utils/url.ts`) at both consumers, ideally in one helper. Fall back to `homePath`/`"/"`. Add vitest cases for `https://evil`, `//evil`, `/\evil` |
| G2 | critical (process) | B1–D exist only as uncommitted changes; the rollback plan describes commits that don't exist | working tree; `analysis/rollback-plan.md` | n/a | true | Commit the Next migration as checkpoint commit(s) on `main` (user decision), or at least `git stash -u` / take a branch snapshot. Then update rollback-plan.md |
| G3 | warning | A stale or garbage `auth_token` cookie at `/` or `/home` lands on `/login` instead of the landing page | `src/frontend/src/app/layout.tsx:13` → `auth/AuthContext.tsx:54` → `components/layout/PublicLayout.tsx:46,53` | **Yes** | true | On the server, pass `initialToken` only when `!isTokenExpired(cookie)` (this also covers garbage). Better, pass only claims/`hasSession` (also fixes G6). Add a test that does not mock away the 401 path, or one where `enabled` is asserted false on the first commit |
| G4 | warning | `plugins/events` cannot load the SDK under `next dev`: no ACAO header | `src/frontend/next.config.ts` (no `headers()`), `plugins/events/index.html:7` | **Yes** (dev only) | true | Add `headers()` for `/assets/:path*` with `Access-Control-Allow-Origin: *` (these are public static files), or drop `crossorigin` from the plugin. Add an nginx `add_header` only if compose plugins matter |
| G5 | warning | Compose with the real backend never ran (S13e, S14e, S16a-c, W06; compose halves of W03/W07) | `docker-compose.yml`, `nginx.conf` | Unknown | true (user-run) | Rename the Maps key in the root `.env`, build the backend image with `hf_token`, run `compose up`, and walk the 6 DEFERRED rows |
| G6 | warning | The raw JWT is serialised into every page's HTML/RSC payload | `app/layout.tsx:13,26` → `app/providers.tsx` | New | true | Same change as G3 |
| G7 | warning | Server fetches have no timeout; a stalled backend hangs `/:slug`, the event and term SSR | `src/frontend/src/api/server.ts:16` | New (the SPA had no SSR) | true | `signal: AbortSignal.timeout(3000)`; the existing `catch` already maps it to `null` |
| G8 | info | ADMIN walk-through not run (S13a) | `/admin/*` | Unknown, low risk | true (user-run) | Run S13a with a real ADMIN account |
| G9 | info | The stale-session unit test passes against the real defect | `src/frontend/src/test/panelSessionHydration.test.tsx` | n/a | true | Cover the unmocked 401 path when fixing G3 |
| G10 | info | Dead backend preview helpers; the repo-root build context has no `.dockerignore`, so `.env*` would enter the image; stale tracked plugin SDK copy | `events/service.py:202`, `organizations/media.py:120`, repo root | n/a | true | Cleanups from the pragmatic, completeness and production-readiness reports |
| G11 | info | `GET /api/groups/{id}/join-code` writes lazily, now under cookie-authenticated GET | `src/backend/app/groups/application/join_code.py:83-99` | Exposure new, low | true | Follow-up: generate the code on circle creation, or make it a POST |

## Integration Points
- **Backend cookie auth (GET/HEAD only, `Vary: Authorization, Cookie`)** works and is tested (`test_auth_cookie.py`). Mutations still need Bearer or `_token`, so the CSRF stance holds.
- **The OAuth2 authorize GET page plus the POST rewrite** pass end to end in dev (W03, S14a-c). They are unverified through nginx with the real backend (S14e).
- **SSR metadata and palette** pass in dev, with server fetches anonymous and `no-store`. They are unverified in compose against the real backend (S16c). The only failure mode is a silent fallback to default metadata, plus G7.
- **Plugin contract**: assets return 200 on :5173 (S13d). `getToken` breaks only for the `crossorigin` plugin (G4).
- **Backend OG and SPA-fallback removal**: the 404 envelope and the auth matrix are verified by `test_unknown_page_404.py`. No backend route depends on `static/index.html`.

## Functional Completeness
About **92%** of the runnable user-facing checks pass (58 of 63; 1 blocked). The 5 failures reduce to 2 root causes, each a small fix. All routes, guards, rewrites, redirects, 404s, OG/palette, the unsaved-changes guard, messaging, terms, groups, events and products work in dev.

## Pragmatic Action Plan

### Must do before calling the migration done
| # | Task | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 1 | Snapshot the working tree: commit the migration (user's call), or `stash -u`/branch. Update `rollback-plan.md` | `git status` is clean, or a recoverable ref exists; the rollback plan names real commits | Critical | 15 min |
| 2 | Fix G1: validate `returnTo` with `isSafeReturnPath` in `AuthGuard` and `OnboardingPage` | Vitest cases for `https://evil`, `//evil`, `/\evil` redirect to the home path; existing auth tests pass | Critical | 30 min |
| 3 | Fix G3 (+G6): sanitise or replace `initialToken` in `app/layout.tsx` | S04a, S04b and W04 re-run: the landing renders, the cookie is cleared, a reload stays on the landing; no 401 in the network log; a valid cookie still renders logged-in with no flash | High | 1 h incl. test |
| 4 | Fix G4: `headers()` ACAO for `/assets/:path*` in `next.config.ts` (or drop `crossorigin` in `plugins/events`) | S13c re-run: the SDK loads in the iframe and `getToken` returns the JWT | High | 15 min |
| 5 | Re-run the Vitest gate after steps 2–4 | Still 0 regressions against A0 | High | 10 min |

### Follow-ups (do not block the MVP migration)
| # | Task | Success criteria | Priority | Effort |
|---|---|---|---|---|
| 6 | User-run compose smoke: rename the Maps key, build the backend with `hf_token`, `up`, walk the 6 DEFERRED rows | S13e, S14e, S16a-c and W06 PASS | Medium | 1 h |
| 7 | G7: server fetch timeout | Backend stopped: `/:slug` renders the default metadata within about 3 s | Medium | 10 min |
| 8 | S13a with a real ADMIN login | Admin pages render styled, no Emotion errors | Medium | 10 min |
| 9 | Cleanups: dead preview helpers, root `.dockerignore` (`.env*`, `node_modules`, `.next`), stale plugin SDK copy | Greps clean; `.env*` excluded from the image | Low | 30 min |
| 10 | G11: move the join-code write off GET | No state change on GET | Low | 1 h |

## Completion Verdict
**⚠️ Gaps: ready_with_fixes.** The migration is functionally real: the Next app serves every route and the backend changes are sound and tested. It is not yet "no regressions" (G3, G4), it carries a now easily exploited open redirect (G1), and it has no recovery point (G2). Steps 1–5 take about 2 hours. After them, the migration meets its stated goal for an MVP that has no production deployment. The compose run with the real backend stays as a user-run follow-up.
