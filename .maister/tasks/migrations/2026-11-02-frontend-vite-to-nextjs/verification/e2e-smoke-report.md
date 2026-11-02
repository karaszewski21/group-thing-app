# Phase 6 Browser Smoke (dev mode): Vite SPA → Next.js 16.4

## TL;DR
- Ran all 64 dev rows against uvicorn :8080 and `next dev -p 5173`, using the Playwright MCP browser and curl. Result: **58 PASS, 5 FAIL, 1 BLOCKED**. The 6 compose-only rows are **DEFERRED**.
- **FAIL 1, stale cookie (S04a, S04b, W04)**: a garbage or expired `auth_token` cookie at `/` or `/home` ends on `/login?returnTo=%2F`, not on the landing page. The cookie does get cleared, and a reload stays on the login page, not the panel.
- **FAIL 2, plugin SDK under `next dev` (S13c, dev half of W07)**: the `events` plugin loads `/assets/plugin-sdk.js` with `crossorigin`. `next dev` sends no `Access-Control-Allow-Origin` header, so the SDK is blocked and `getToken` is unavailable.
- BLOCKED: S13a (ADMIN walk-through). There are no ADMIN credentials: the seeded admin password was changed, and no backend tooling grants ADMIN.
- Everything else passes: rewrite and redirect, OG/palette, guards, OAuth2, 404s and Emotion hydration. Every process, the container and the browser were stopped afterwards.

## Key Decisions
- **Accounts**: the seeded `admin@example.com` login returns 401 (its password was changed) and there is no `editor` user any more. I registered a throwaway **EDIT-only** user (`smoke-a-1793651367@example.com`, guest role) through `/login?mode=register`. All logged-in rows used it, including S02, which the checklist assigns to ADMIN; nothing in S02 needs ADMIN. I did not use SQL grants, because the brief allows roles only through backend tooling. So S13a is BLOCKED.
- **Test data was created through the app on the dev DB**, under user A: place `ec5ce0ad…` (Smoke sala), events `3a97ffab…` and `a909b30b…`, items `e5718025…` and `f322a2d9…`, group `4a96f78a…`, term `23c7b14f…`, family member `75c7e389…`, organization `smoke-org-1367` (owner editor for S12), conversation `58b74f3e…` with the E2E Gifter account, and OAuth2 public client `d151a858…`. Rows needing an organizer theme used the existing `rodzinny-grajdolek` org (cover + PLUM palette), read anonymously; I never logged in as that account.
- **Clicks**: Playwright pointer clicks hung on this page set (the click never returned). Clicks were sent as DOM `element.click()` from `browser_run_code_unsafe`. This exercises the same React and Next `Link` handlers.
- **S12d**: the reload with a dirty editor raised a native `beforeunload` dialog, which was dismissed.
- **W03 echo**: Next refuses a second `next dev` in the same directory. I stopped my :5173 server once all other dev rows were done, then ran the echo check on :5176 → :8099.
- **S13c**: I started `plugins/events` (vite :3004) for the row and stopped it afterwards.

## Open Questions / Risks
- **The SDK CORS gap probably also hits compose and production.** Neither `next.config.ts` (no `headers()`) nor `nginx.conf` adds `Access-Control-Allow-Origin` for `/assets/plugin-sdk.js`. A plugin page that uses `crossorigin` will be blocked behind nginx too. Check this in the deferred compose run. The other plugins (`box-size`, `warehouse`) load the SDK without `crossorigin` and are not affected.
- **One credential exposure**: the registration script for the throwaway user A was echoed once in the tool transcript, including its random password. Later scripts fetched the password at runtime. The account is a dev-DB throwaway; delete it, or at least never reuse it. No other password, token, cookie value or client secret was printed or saved.
- **The ADMIN rows need a real ADMIN login** (S13a). Either the user provides one, or a supported grant path is needed.
- **Compose is deferred to the user**: S13e, S14e, S16a–c, W06, plus the compose halves of W03 and W07. Building the backend image needs the `hf_token` secret, and `up` migrates the compose DB.
- **The stale-cookie flow behaves differently from what `panelSessionHydration.test.tsx` asserts.** That test passes, presumably because the API is mocked, so the 401 path never runs.

## Counts
| Runtime | Rows | PASS | FAIL | BLOCKED | DEFERRED |
|---|---|---|---|---|---|
| dev | 64 | 58 | 5 | 1 | 0 |
| compose | 6 | 0 | 0 | 0 | 6 |
| **Total** | **70** | **58** | **5** | **1** | **6** |

W03 and W07 are "dev + compose" rows and are counted under dev. W03 passes for dev; W07 fails for dev. Their compose halves are deferred. Per-row notes are in the Result column of `smoke-checklist.md`.

## Failures

### S04a / S04b / W04: stale cookie lands on the login page, not the landing
- **Expected**: with a garbage cookie (S04a), an expired JWT-shaped cookie (S04b) or `/home` (W04, after its 307 to `/`), the landing page renders, the cookie is cleared, and a reload stays on the landing.
- **Observed**: the document `/` returns 200, `/home` returns 307 → `/`, and the panel shell boots. Then `GET /api/conversations/unread-count` and `GET /api/notifications/mine` return 401 and the page hard-navigates to `/login?returnTo=%2F`. The cookie and the localStorage token are cleared, and a reload stays on `/login`, not the panel. Timeline: `78ms nav /` → `304ms 401 unread-count` → `311ms 401 notifications/mine` → `412ms nav /login?returnTo=%2F`.
- **Evidence**: `smoke/S04-W04-stale-cookie.json`, `smoke/S04a-garbage.png`, `smoke/S04b-expired.png`, `smoke/W04-home-garbage.png`.
- **Likely cause** (from reading the code, not fixed):
  1. `src/app/layout.tsx:13` passes the raw cookie as `initialToken`. `AuthProvider` (`src/auth/AuthContext.tsx:54`) starts with `token = initialToken`. The token is only reconciled to `null` in a `useLayoutEffect` (`AuthContext.tsx:93-97`).
  2. `PublicLayout` (`src/components/layout/PublicLayout.tsx`) sits outside `ClientOnly` and renders on that first commit. Its `NotificationBell` (`token ? <NotificationBell/> : …`), `PendingActionsHost` and `BottomNav` → `useUnreadMessages` run queries gated on `token !== null` (e.g. `src/hooks/useNotifications.ts:37`). Those queries subscribe and fetch before the reconciled `null` takes effect.
  3. The requests go out with no credentials (reconcile has already cleared storage and cookie) and get 401. `src/api/client.ts:38-45` then calls `clearSession()` and sets `window.location.href = /login?returnTo=…`, without checking whether a token was sent at all.
  - Possible directions: gate auth-only queries on the reconciled session; only redirect on 401 when a token was attached; or render the header and BottomNav auth parts under `ClientOnly`.

### S13c and W07 (dev half): plugin SDK blocked by CORS under `next dev`
- **Expected**: the plugin full-screen page loads the plugin iframe, the plugin's SDK request to `http://localhost:5173/assets/plugin-sdk.js` succeeds, and `getToken` works, with no origin errors.
- **Observed**: `/admin/plugins/events` renders, and the iframe `http://localhost:3004/#RENDER{…}` loads (200). Inside the iframe the console shows: `Access to script at 'http://localhost:5173/assets/plugin-sdk.js' from origin 'http://localhost:3004' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present`. The iframe has no SDK globals, so `getToken` is unavailable. With `Origin: http://localhost:3004`, curl gets 200 but no `Access-Control-*` header.
- **Evidence**: `smoke/S13c-plugin-page.png`, `smoke/S13c-W07-plugin.json`, `smoke/W07-cors-curl.txt`, `smoke/S13d-curl.txt` (the plain 200s still pass).
- **Likely cause**: `plugins/events/index.html:7` loads `<script src="http://localhost:5173/assets/plugin-sdk.js" crossorigin>`, which makes it a CORS request. Under Vite, the dev server's default `server.cors` allows localhost origins, so the header was sent; the old `vite.config.ts` had no override. Next serves `public/assets/*` with no CORS header, and `src/frontend/next.config.ts` defines no `headers()` for `/assets/:path*`. This breaks the plugin contract ("`/assets/plugin-sdk.js` on :5173", spec §3 preserve list) for plugins that use `crossorigin`. Possible directions: add a `headers()` entry for `/assets/plugin-sdk.js` and `/assets/plugin-ui.css` (and the nginx equivalent), or drop `crossorigin` from the plugin.

## Blocked
- **S13a**: an ADMIN walk-through of `/admin/*`. No ADMIN credentials are available, and no in-app or backend tool grants ADMIN. The EDIT-only side (S13b, W12) passes.

## Other observations (not failures)
- **S06a**: `/messages` (the inbox) keeps `min-h-dvh` and the BottomNav. Only the thread gets `h-dvh` without the BottomNav. This matches the pre-migration `PublicLayout` (`git show f20cdf9^:src/frontend/src/components/layout/PublicLayout.tsx`), so the checklist's "inbox h-dvh" wording is broader than the old behaviour.
- **S12**: the guard dialog says "Wybrany układ i kolory nie zostały zapisane." even when only the description changed. This copy is pre-existing (`features/owner-page/editor/UnsavedChangesDialog.tsx:48`, unchanged since A1).
- **W03 echo**: Next replaces a client-sent `X-Forwarded-Host` with its own incoming Host (`localhost:5176`) and keeps `X-Forwarded-Proto`. Behind nginx this is fine, because nginx sets `Host $host`. Note that `$host` has no port.
- **W10**: the items filter is local state, and the URL does not change. The query-only update `?edit=1` did not scroll to the top (300 → 194, a layout change).
- **S14b**: the consent page shows the scopes as "Read data" and "Edit data" (labels for `mcp:read` and `mcp:edit`).
- The OAuth2 register response carries a `client_secret` key even for `token_endpoint_auth_method: none`. Its value was not printed.

## Cleanup
- **Stopped**:
  - uvicorn tree (uv 20528 → uvicorn 29416 → python 9208 → 25468)
  - `next dev -p 5173` tree (npm 22876 → cmd 5036 → node 36772 → next-server 2156 + turbopack workers 18348, 23908)
  - second `next dev -p 5176` tree (37412 → 33920 → 15392 → 27324)
  - echo stub on :8099 (32212)
  - events plugin vite on :3004 (35528 → 13492)
  - a localhost-only credential helper on :8097 (37896), used to keep the throwaway password out of the transcript
- **Postgres**: `group-thing-app-postgres-1` was stopped at the start, so I started it, and it is `Exited (0)` again.
- **Browser**: closed.
- **Ports**: after cleanup, nothing listens on 3004, 5173, 5176, 8080, 8097 or 8099 (`netstat` shows no listener, and curl to each port fails).
- **Files**: `src/frontend/AGENTS.md` never appeared. The 15 `.playwright-mcp/` files I created were removed; the console logs were copied first to `smoke/session-console-*.log`, and the 513 pre-existing files were left alone. Throwaway credential files in the scratchpad were deleted.
- **Repository**: no source, config or test file was modified, and nothing was committed.
