# Phase 6 Smoke Checklist: Vite SPA → Next.js 16.4

## TL;DR
- 70 rows: 57 cover the 16 spec §12 items (S01–S16, split into checkable steps), 13 come from the work-log "re-check in the Phase 6 smoke" notes (W01–W13). A coverage table maps every spec item and every requirements §3.5 route to its rows.
- Runtimes: **dev** = backend :8080 + `next dev -p 5173`; **compose** = `docker compose up`, nginx on :5174. Run the dev rows first, then the compose rows (S16, W06, the compose halves of S13e, S14 and W03).
- Fill **Result** with `PASS`, `FAIL` or `N/A` and a note. Evidence goes into `verification/smoke/` under the row id (see `smoke-run-instructions.md`).
- No secrets in this file or in the evidence: no tokens, passwords, keys, cookie values or client secrets. Write "set" / "present" instead.

## Key Decisions
- One row is one observable check, so a failure points to exactly one behaviour. Spec items with several URLs are split (S07a–S07d, etc.).
- The risk tags from the plan are kept as a column: **RW** = rewrite pathname / BottomNav state, **HYD** = hydration warning, **EMO** = Emotion FOUC / SSR styles, **OAH** = OAuth2 forwarded host, **BODY** = 15 MB body through nginx. Rows without one of these risks use `-`.
- The work-log re-checks get their own W rows even when a spec row touches the same page. The pass condition differs, for example "under `next dev`" or "fresh dev server, never 500".
- Accepted deltas (spec §3) are marked as the expected result, so they do not get logged as regressions: real 404, `/:slug/group/:g` → 404, `/` rewrite, `/home` → 307, scroll-to-top, lost `location.state` on reload, proxy login redirect before JS, guard on tab close.

## Open Questions / Risks
- S16a and W06 need all `SPACES_*` values in the root `.env`. Check presence only. Without them, uploads return 409 "disabled", and the row becomes `N/A` with that reason rather than `FAIL`.
- Compose rows need the backend image rebuilt. It needs the `hf_token` build secret, and `docker compose up` runs `alembic upgrade head` on the compose DB. Both were deferred out of the C13 gate on purpose. The user starts compose.
- S13d needs a plugin dev server and a registered plugin manifest (`plugins/CLAUDE.md`). Without one, the row is `N/A`, with the plugin SDK rows (S13e) still required.
- S14 needs a registered OAuth2 client (DCR via `/oauth2/register`). The `client_secret` from the response must never be written down.

## Checklist

Columns: **ID** · **Run** (dev / compose) · **URL / action** · **Expected** · **Evidence** (snap = Playwright snapshot, shot = screenshot, con = console messages, net = network requests, curl = command output with headers) · **Risk** · **Result**

### S01 Landing and login
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S01a | dev | Anonymous (no `auth_token` cookie, empty localStorage): open `/` | LandingPage renders, document 200, no redirect | snap, con, net | HYD | PASS: landing, document 200, no redirect, 0 console errors (S01a-landing-snap.yml, S01a-console.txt) |
| S01b | dev | Open `/login`, then `/login?mode=register` | Login form; with `?mode=register` the register tab is selected | snap ×2 | - | PASS: login tab selected; ?mode=register selects 'Załóż konto' (S01b-login.json) |

### S02 Logged-in home through the rewrite
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S02a | dev | Log in as ADMIN on `/login` | Lands on `/`, address bar stays `/` (never `/home`), home view rendered | snap, net (document `GET /` 200, no 307) | RW | PASS (EDIT-only throwaway user; ADMIN password unknown): login → client nav to /, no /home, no 307, home view (S02-S03-W05-loggedin.json) |
| S02b | dev | Hard reload `/` while logged in | Home view again. Console has no hydration mismatch / "did not match" warning | con | HYD, EMO | PASS: reload → document GET / 200, home view, 0 hydration/Emotion warnings (only 404 /api/organizations/mine, user has no org) |
| S02c | dev | On `/`: BottomNav state | "Start" is the active item (`aria-current` / active style) | snap, shot | RW | PASS: Start has aria-current, others not (S02c-start-active.png) |

### S03 `/home` typed directly
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S03a | dev | Logged in: type `/home` in the address bar | 307 to `/`; home view; Start active | net (307 + Location `/`), snap | RW | PASS: /home 307 → /, home view, Start active (S02-S03-W05-loggedin.json) |
| S03b | dev | `curl -sI "http://localhost:5173/home?x=1"` | `307`, `location: /?x=1` | curl | RW | PASS: 307, location: /?x=1 (S03b-curl.txt) |

### S04 Stale cookie
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S04a | dev | Set a garbage `auth_token` cookie, clear localStorage, open `/` | Landing renders (not the panel), the cookie is cleared, a reload stays on the landing | snap, con, cookie list (names only) | RW, HYD | FAIL: lands on /login?returnTo=%2F, not the landing; cookie cleared, reload stays on /login. Header queries fire with the stale token and get 401, then api/client.ts redirects (S04-W04-stale-cookie.json, S04a-garbage.png) |
| S04b | dev | Same with an expired JWT-shaped cookie (`exp` in the past) | Same as S04a | snap, cookie list (names only) | RW | FAIL: same as S04a with the fake expired JWT (S04-W04-stale-cookie.json, S04b-expired.png) |

### S05 Panel sections, `/add`, gated prefixes
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S05a | dev | Logged in: switch through every panel section via in-app navigation: `/`, `/meetings`, `/groups`, `/groups/new`, `/items`, `/profile`, `/settings`, `/places`, `/places/new`, `/family`, `/family/new`, `/family/edit`, `/family/members/new`, `/account`, `/search`, `/wanted`, `/add`, `/add/product`, `/add/term`, `/add/event`, `/add/hunting` | Each section renders inside the same panel. The AppData bootstrap requests are **not** repeated on section switches (only section-specific queries) | net (filter `/api`), snap per section | RW | PASS: 21 sections via router.push, 0 document requests, bootstrap (/people/me, /families/mine, …) not repeated; only section queries (S05a-panel-sections.json) |
| S05b | dev | Logged in: hard-load the id routes with real ids: `/groups/:groupId/edit`, `/places/:locationId/edit`, `/family/members/:familyMembershipId/edit`, `/events/:eventId/edit`, `/terms/:termId/edit` | Each renders its editor (200, no 500) | snap, net | - | PASS: group/place/family-member/event/term editors render, 200 (S05b-*.png, S05b-S05g-S06-S07-S11-loggedin.json) |
| S05c | dev | Anonymous `/add` | PublicAddView in the PhoneFrame, no redirect | snap | - | PASS: /add anonymous → 'Co dodajesz?' public add view, no redirect (S05c-add-anon.png) |
| S05d | dev | Logged in `/add` | The logged-in add view (panel) | snap | - | PASS: /add logged in renders inside the panel with BottomNav (S05a-panel-sections.json) |
| S05e | dev | Anonymous `/add/product` | Redirect to `/login?returnTo=%2Fadd%2Fproduct`. After login, back on `/add/product` | net, snap | - | PASS: /add/product → /login?returnTo=%2Fadd%2Fproduct; after login back on /add/product (anon-pages-probe.json, S05b-S05g-S06-S07-S11-loggedin.json) |
| S05f | dev | `curl -sI` without a cookie on `/meetings`, `/messages`, `/admin`, `/onboarding`, `/groupsx` | First four: 307 to `/login?returnTo=…` (proxy, before JS). `/groupsx`: no login redirect (segment boundary) | curl | - | PASS: /meetings /messages /admin /onboarding → 307 /login?returnTo=…; /groupsx 200 (S05f-curl.txt) |
| S05g | dev | Logged in `/onboarding` and `/organization` | Standalone pages without site chrome, AuthGuard passes | snap | - | PASS: /onboarding and /organization render without header/BottomNav (S05g-*.png) |

### S06 Messages, member pages
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S06a | dev | `/messages`, then open a thread `/messages/:conversationId` | Inbox and thread render full height (h-dvh), no BottomNav | snap, shot | - | PASS: thread h-dvh (800/800) without BottomNav, also after reload; inbox keeps min-h-dvh + BottomNav, same as the pre-migration PublicLayout (S06a-*.png) |
| S06b | dev | `/terms/:termId` (attendees) and `/groups/:groupId` (details) | Both render for a member | snap | - | PASS: /terms/:id 'Zapisani' and /groups/:id 'Smoke grupa' render for the organizer (S06b-*.png) |

### S07 Product URLs
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S07a | dev | `/product/:id` anonymous (ACTIVE listed item) and logged in | Item detail renders in both cases | snap ×2 | EMO | PASS: item detail anonymous and logged in (S07a-product-anon.png, S07a-product-loggedin.png) |
| S07b | dev | `/product/:id/edit` | 307 to `/product/:id?edit=1`; editor open (for the owner) | net, snap | - | PASS: /product/:id/edit 307 → ?edit=1, owner editor open (S07b-editor-open.png) |
| S07c | dev | `/:slug/product/:id`, then `/:slug/product/:id/edit` | Organizer item in the org chrome; `/edit` redirects to `/:slug/product/:id?edit=1` | net, snap | EMO | PASS: org item in org palette #7a2a4f; /edit 307 → /:slug/product/:id?edit=1 (anon-pages-probe.json) |
| S07d | dev | `/:slug/product` | Redirect to `/:slug` | net | - | PASS: /rodzinny-grajdolek/product redirects to /rodzinny-grajdolek (anon-pages-probe.json) |

### S08 Slug pages
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S08a | dev | `/:slug` (an Organization) anonymous and logged in | Organization page with its palette, no console errors | snap, con | EMO, HYD | PASS: org page with palette #7a2a4f, 0 console errors anonymous and logged in (S08a-org-anon.png, W01-W13.json) |
| S08b | dev | `/<party-uuid>` (a party profile) | Party profile renders, no OG/palette provider (UUID slug) | snap | - | PASS: UUID party profile 'E2E Gifter', default palette (S08b-party.png) |
| S08c | dev | `/:slug/items`, `/:slug/meetings`, `/:slug/terms` | Each renders inside the org chrome | snap ×3 | - | PASS: items/meetings/terms render with org palette (anon-pages-probe.json) |

### S09 Event and term pages
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S09a | dev | `/:slug/event/:eventId` | Event page with the organizer theme | snap, con | EMO | PASS: event page with org palette, 0 console errors (S09a-event.png) |
| S09b | dev | `/:slug/group/:groupId/term/:termId` | Term page with the organizer theme | snap, con | EMO | PASS: term page with org palette, 0 console errors (S09b-term.png) |
| S09c | dev | `/krag/group/:groupId/term/:termId` | Term page with the default theme | snap | - | PASS: /krag term page, default palette #1b8168 (S09c-krag-term.png) |

### S10 Server metadata and palette (curl)
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S10a | dev | OG curl (instructions §6) on `/:slug` | `<title>` = name; `og:title`, `og:description` "Strona organizacji {name}.", `og:type` website, `twitter:card` (`summary_large_image` with a cover, else `summary`); `og:image`/`twitter:image` when there is a cover | curl | - | PASS: title, og:title/description/type/image, twitter summary_large_image + image (S10a-og.txt) |
| S10b | dev | OG curl on `/:slug/event/:eventId` | Title = event name; description `{dzień} DD.MM o HH:mm[ · place][ description]`; `og:image` = banner when set | curl | - | PASS: 'sob 31.10 o 13:07 · Dom' + banner og:image; no-banner event → summary (S10b-og.txt) |
| S10c | dev | OG curl on `/:slug/group/:g/term/:t` | Title = circle name; `Najbliższy termin: DD.MM.YYYY.` (+ term description) | curl | - | PASS: circle name + 'Najbliższy termin: 04.11.2026.' (+ description case) (S10c-og.txt) |
| S10d | dev | OG curl on a UUID party slug, a reserved word and an unknown slug | Default title "Krąg grupy" only, no `og:` tags | curl | - | PASS: UUID slug, /krag, /event, /notifications, unknown slug → 'Krąg grupy' only, no og: tags (S10d-og.txt; /admin and /settings are proxy 307) |
| S10e | dev | `curl -s` on an org with a custom palette, look for the `display:contents` wrapper | First HTML carries the inline `--color-primary:…` vars; a screenshot of the first paint shows organizer colours, with no flash of default colours or unstyled Chakra | curl excerpt, shot | EMO | PASS: first HTML has the display:contents wrapper with --color-primary:#7a2a4f; JS-disabled first paint shows the plum palette (S10e-curl.txt, S10e-first-paint-nojs.png) |

### S11 Create flows with handed-over state
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S11a | dev | `/add/event`: create an event | Navigates to the new event page with the success toast | snap, shot | - | PASS: POST /api/events 201 → new event page with toast 'Wydarzenie „Smoke wydarzenie 2” zapisane' (S11a-event-toast.png) |
| S11b | dev | From the LocationPicker, "add place" → `/places/new` → save | Back in the picker with the new place selected | snap | - | PASS: '+' → /places/new?returnTo=…&picker=… → save → back on /add/event with 'Smoke sala' selected, name kept (S11b-picker-new-place-selected.png) |
| S11c | dev | `/add/product`: create an item | Item detail shows the "created" state | snap | - | PASS: item created → /product/:id with the created-state notice (photo refused) (S11c-item-created-state.png) |
| S11d | dev | Hard reload right after S11a–S11c | The page renders; the toast/created state is gone (accepted delta 6) | snap | - | PASS: reload of event and item pages → page renders, toast/notice gone (S11d-item-after-reload.png) |

### S12 Organizer editor unsaved-changes guard (EditorSheet)
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S12a | dev | Owner on `/:slug`: open the editor, change a field, click an in-app link | Confirm dialog (Polish). "Stay" keeps the edits and the URL; "Leave" navigates | snap ×2 | - | PASS: Polish alertdialog; Stay keeps edits and URL; Leave → /meetings once (S12a-*.png, S12-W11-editor-guard.json) |
| S12b | dev | Dirty editor: trigger a programmatic navigation (e.g. a BottomNav or header button that calls `navigate`) | Guarded the same way as S12a | snap | - | PASS: BottomNav 'Czat' button guarded the same way; Leave → /messages (S12b-programmatic-guard.png) |
| S12c | dev | Dirty editor: browser Back, then (after Stay) Forward | Guarded; after Stay the URL is the editor page again | snap, URL notes | - | PASS: Back guarded, after Stay the URL is the editor page; Forward a no-op; Leave → /meetings (S12c-back-guard.png) |
| S12d | dev | Dirty editor: reload / close tab | Browser `beforeunload` prompt (accepted delta 8) | dialog event (`browser_handle_dialog`) | - | PASS: reload with a dirty editor raised the native beforeunload dialog; dismiss kept the edits (S12-W11-editor-guard.json) |

### S13 Admin and plugins
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S13a | dev | As ADMIN: `/admin` → `/admin/products`, then products new/:id/:id/edit, categories (+new, :id/edit), groups, terms, photos, plugins (+new, :pluginId/detail, :pluginId/edit) | `/admin` redirects to `/admin/products`. Every page renders with Chakra styling (no unstyled flash, no Emotion console errors) | snap, shot, con | EMO, HYD | BLOCKED: no ADMIN credentials (seeded admin@example.com password changed, login 401) and no backend tooling grants ADMIN |
| S13b | dev | As the EDIT-only editor: `/admin/products` | ProductListPage opens (the admin layout gate is AuthGuard-only). ADMIN-only data shows the API error, not a crash | snap, con | - | PASS: EDIT-only user opens /admin/products, Chakra-styled list, 0 console errors (S13b-admin-products.png) |
| S13c | dev | Plugin full-screen page `/admin/plugins/:pluginId/<path>` (plugin dev server running) | The plugin iframe loads, `getToken` returns the JWT (the plugin shows logged-in data), no origin errors | snap, con | - | FAIL: plugin iframe loads but plugin-sdk.js from :5173 is blocked by CORS (no Access-Control-Allow-Origin), so no SDK/getToken (S13c-plugin-page.png, S13c-W07-plugin.json) |
| S13d | dev | `curl -sI http://localhost:5173/assets/plugin-sdk.js` and `/assets/plugin-ui.css` | 200, JavaScript / CSS content types | curl | - | PASS: both 200, application/javascript and text/css (S13d-curl.txt) |
| S13e | compose | Same two URLs on `http://localhost:5174` | 200 through nginx → web | curl | - | DEFERRED (compose: backend image rebuild needs the hf_token secret; up migrates the compose DB) |

### S14 OAuth2 authorize round trip
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S14a | dev | Anonymous: `GET /oauth2/authorize?…` (instructions §7) | Redirect to `/login?returnTo=…`; after login, the consent page | net, snap | - | PASS: anonymous GET → 307 /login?returnTo=/oauth2/authorize…; after login the consent page (S14-oauth2-flow.json) |
| S14b | dev | Logged in: consent page shows the client name and scopes `mcp:read`/`mcp:edit` | Page renders from `/api/oauth2/client-info` | snap | - | PASS: consent shows 'Smoke client', Read data + Edit data (mcp:read/mcp:edit), client-info 200 (S14b-consent.png) |
| S14c | dev | Approve (form `POST /oauth2/authorize`) | `src/proxy.ts` rewrites it to the backend; 302 to `redirect_uri?code=…&state=…` with the same `state` | net (status + Location, code value masked) | OAH | PASS: POST /oauth2/authorize 302 → localhost:9999/callback?code=<present>&state=smoke1 (S14-oauth2-flow.json, W03-backend-log.txt) |
| S14d | dev | Exchange the code at `POST /oauth2/token` (PKCE verifier) | 200 with `access_token`, `refresh_token` keys (record key names only) | curl (values masked) | - | PASS: 200 with access_token, token_type, expires_in, refresh_token, scope (S14-oauth2-flow.json) |
| S14e | compose | Repeat S14a–S14c on :5174 | Same result through nginx → web → backend | net | OAH | DEFERRED (compose: backend image rebuild needs the hf_token secret; up migrates the compose DB) |

### S15 Not found
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S15a | dev | `/does/not/exist` | The Next 404 page, status 404 (accepted delta 1) | snap, curl -I | - | PASS: 404 status, 'Nie znaleziono strony' (S15a-curl.txt, S15a-notfound.png) |
| S15b | dev | `/:slug/group/:groupId` | 404 (accepted delta 2) | curl -I, snap | - | PASS: /:slug/group/:g → 404 (S15b-W09-curl.txt) |
| S15c | dev | `curl -s http://localhost:8080/some-page` | Backend JSON 404 envelope (`"error": "Not Found"`), no HTML | curl | - | PASS: backend JSON 404 envelope, application/json (S15c-curl.txt) |

### S16 Compose / nginx
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| S16a | compose | Upload a ~15 MB photo to an item via the UI on :5174 | Upload succeeds (no 413). A 17 MB file gets 413 from nginx or the backend's size error | net, snap | BODY | DEFERRED (compose: backend image rebuild needs the hf_token secret; up migrates the compose DB) |
| S16b | compose | `curl -s http://localhost:5174/.well-known/oauth-authorization-server` | 200 JSON metadata from the backend | curl | - | DEFERRED (compose: backend image rebuild needs the hf_token secret; up migrates the compose DB) |
| S16c | compose | `curl -sI` on `/`, `/login`, `/:slug`, plus the OG curl on `/:slug` via :5174 | 200, OG tags present (Next behind nginx) | curl | - | DEFERRED (compose: backend image rebuild needs the hf_token secret; up migrates the compose DB) |

### W Work-log re-checks
| ID | Run | URL / action | Expected | Evidence | Risk | Result |
|---|---|---|---|---|---|---|
| W01 | dev | Emotion SSR registry under `next dev` (not only the production build): hard-load `/`, `/:slug`, `/:slug/event/:id`, `/:slug/group/:g/term/:t`, `/product/:id` | 0 hydration / Emotion insertion errors in the console on each | con ×5 | HYD, EMO | PASS: 0 hydration/Emotion console errors on all 5 pages, anonymous and logged in (anon-pages-probe.json, W01-W13.json) |
| W02 | dev | On a **freshly started** `next dev`: `/notifications` (resolves to the `[organizationSlug]` route) and two org slugs | Never 500. Unknown slug → its not-found state; the dev terminal shows no jest-worker crash | curl -I, terminal excerpt | - | PASS: fresh next dev: /notifications, 2 org slugs and an unknown slug all 200, unknown → not-found state; no jest-worker crash (W02-curl.txt, W02-terminal.txt) |
| W03 | dev + compose | `POST /oauth2/authorize` end to end with the real backend (S14c, S14e); optionally the header-echo check in the instructions §8.4 | The backend access log shows `POST /oauth2/authorize` → 302 and the browser reaches `redirect_uri` with `code` + the same `state`. With the echo: `Host` is the backend address (expected for a rewrite) and `X-Forwarded-Host`/`-Proto`/`-For` carry the public values | backend log line, net, echo output | OAH | PASS (dev half): backend log POST /oauth2/authorize 302, browser reaches redirect_uri with code + state; echo: Host localhost:8099, X-Forwarded-Host/-Proto/-For set (a client-sent X-Forwarded-Host is replaced by Next's own Host). Compose half DEFERRED (compose: backend image rebuild needs the hf_token secret; up migrates the compose DB) (W03-*.txt) |
| W04 | dev | Stale cookie landing at `/` **and** `/home` (S04a + `/home` variant) | `/home` → 307 `/` → landing, cookie cleared | snap, cookie names | RW | FAIL: /home 307 → / then ends on /login?returnTo=%2F instead of the landing; cookie cleared (S04-W04-stale-cookie.json, W04-home-garbage.png) |
| W05 | dev | `/home` → `/` 307 and `/` → `/home` rewrite: navigate client-side from `/meetings` to Start, then hard-load `/` | `usePathname` gives `/`: BottomNav "Start" active in both cases, never `/home` in the URL | snap ×2 | RW | PASS: client nav from /meetings to Start and a hard load of / both give / with Start active (S02-S03-W05-loggedin.json, W05-client-nav-start.png) |
| W06 | compose | 15 MB upload via nginx (= S16a; record here whether the nginx 16m limit or the backend's 15 MB cap answered the 17 MB case) | 15 MB OK; >16 MB → 413 from nginx | net | BODY | DEFERRED (compose: backend image rebuild needs the hf_token secret; up migrates the compose DB) |
| W07 | dev + compose | Plugin SDK + `plugin-ui.css` on :5173 and through nginx (= S13d/S13e), plus a plugin page loading the SDK from `http://localhost:5173/assets/plugin-sdk.js` | 200 everywhere; the plugin's SDK request succeeds | curl, net | - | FAIL (dev half): assets 200 on :5173, but the events plugin's SDK request from :3004 is CORS-blocked (W07-cors-curl.txt, S13c-W07-plugin.json). Compose half DEFERRED (compose: backend image rebuild needs the hf_token secret; up migrates the compose DB) |
| W08 | dev | Private-circle term page: OG curl on `/:slug/group/:privateGroupId/term/:termId` | Default-style preview (circle name, no term details; anonymous fetch) | curl | - | PASS: private circle term → circle name + 'Dołącz i zobacz najbliższe spotkania.', no term details (W08-og.txt) |
| W09 | dev | `/:slug/group/:groupId` → 404 (= S15b) | 404 | curl -I | - | PASS: 404 (S15b-W09-curl.txt) |
| W10 | dev | Scroll-to-top: scroll down a long page (e.g. `/:slug/items`), click an item link (push); then Back; then change a filter that updates the query string | Push → new page at the top (accepted delta 5). Back → browser restores. Query-only updates keep the scroll position | shot ×2, notes | - | PASS: push → y 0; Back → restored (910); query-only ?edit=1 not reset to top (W10-scroll.json, W10-*.png) |
| W11 | dev | EditorSheet guard on link, programmatic and back/forward navigation (= S12a–S12c) | All three guarded; "Leave" proceeds exactly once | snap | - | PASS: link, programmatic and back/forward all guarded; Leave proceeds once (S12-W11-editor-guard.json) |
| W12 | dev | Admin AuthGuard-only gate (= S13b): EDIT-only user opens `/admin/products` | ProductListPage renders; anonymous `/admin` → login | snap, curl -I | - | PASS: EDIT-only user sees ProductListPage; anonymous /admin → 307 login (S13b-admin-products.png, W12-curl.txt) |
| W13 | dev | Maps manual mode without a key: `next dev` with `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` absent (presence check), open `/places/new` | Manual place entry works; no `maps.googleapis.com` request; no console error | net, con, snap | - | PASS: no .env.local key; /places/new manual entry works, 0 maps.googleapis requests, 0 console errors (W01-W13.json, W13-places-new-manual.png) |

## Coverage

### Spec §12 (16 items)
| Spec item | Rows |
|---|---|
| 1 Landing, login, register tab | S01a, S01b |
| 2 Login → `/` home, URL `/`, no hydration warning, Start active | S02a–S02c, W05 |
| 3 `/home` → `/` | S03a, S03b |
| 4 Stale cookie | S04a, S04b, W04 |
| 5 Panel sections, `/add` anon/logged in, `/add/product` → login | S05a–S05g |
| 6 `/messages` + thread, `/terms/:id`, `/groups/:id` | S06a, S06b |
| 7 Product URLs and redirects | S07a–S07d |
| 8 Org, UUID party, `/:slug/items|meetings|terms` | S08a–S08c |
| 9 Event, term, `krag` term | S09a–S09c |
| 10 OG curl + palette on first paint | S10a–S10e, W08 |
| 11 EventCreate toast, PlaceCreate pick, ItemCreate state | S11a–S11d |
| 12 Editor guard: link, back, tab close | S12a–S12d, W11 |
| 13 Admin as ADMIN and EDIT-only, plugin page, SDK on :5173 | S13a–S13e, W07, W12 |
| 14 OAuth2 GET → POST → redirect | S14a–S14e, W03 |
| 15 Unknown URL 404, `/:slug/group/:g` 404 | S15a–S15c, W09 |
| 16 Compose: 15 MB upload, `/.well-known` | S16a–S16c, W06 |

### Requirements §3.5 routes
| Route / check | Rows |
|---|---|
| Landing (anonymous `/`) | S01a |
| `/login` + register tab | S01b |
| Logged-in `/` (home via rewrite) | S02a, W05 |
| Every panel section | S05a, S05b |
| `/add` anonymous and logged in | S05c, S05d |
| `/messages` + thread | S06a |
| `/terms/:id`, `/groups/:id` | S06b |
| `/product/:id` | S07a, S07b |
| `/:slug` org + UUID party profile | S08a, S08b |
| `/:slug/items|meetings|terms` | S08c |
| `/:slug/product/:id` | S07c, S07d |
| `/:slug/event/:id` | S09a |
| `/:slug/group/:g/term/:t` incl. `krag` | S09b, S09c |
| OG meta in the HTML of public pages | S10a–S10d, S16c, W08 |
| `/admin/*` with Chakra styling | S13a, S13b |
| Plugin full-screen page | S13c |
| Plugin SDK at `/assets/plugin-sdk.js` | S13d, S13e, W07 |
| OAuth2 authorize GET page + POST | S14a–S14e |
| Organizer editor unsaved-changes guard | S12a–S12d |
| 404 | S15a, S15b |

### Work-log re-check items
| Work-log item | Rows |
|---|---|
| Emotion hydration fix under `next dev` | W01, S02b |
| `/notifications` and `/[org]` 500 from a crashed dev jest-worker | W02 |
| `POST /oauth2/authorize` forwarded Host / X-Forwarded-* end to end | W03, S14c, S14e |
| Stale-cookie landing at `/` and `/home` | W04, S04a, S04b |
| `/home` → `/` 307, `/` → `/home` rewrite, usePathname / BottomNav Start | W05, S02a–S03b |
| 15 MB upload via nginx | W06, S16a |
| Plugin SDK + plugin-ui.css on 5173 and through nginx | W07, S13d, S13e |
| Private-circle OG fallback | W08 |
| `/:slug/group/:groupId` → 404 | W09, S15b |
| Scroll-to-top on push | W10 |
| EditorSheet guard on link, programmatic, back/forward | W11, S12a–S12c |
| Admin AuthGuard-only gate (EDIT-only user opens ProductListPage) | W12, S13b |
| Maps manual mode without a key | W13 |

## Run summary (fill in at the end)
| Runtime | Rows | PASS | FAIL | N/A | Notes |
|---|---|---|---|---|---|
| dev | 64 | 58 | 5 | 0 | 1 BLOCKED (S13a); FAIL: S04a, S04b, W04, S13c, W07 (dev half); W03/W07 compose halves deferred |
| compose | 6 | 0 | 0 | 0 | 6 DEFERRED (S13e, S14e, S16a, S16b, S16c, W06): backend image rebuild needs the hf_token secret; up migrates the compose DB |
