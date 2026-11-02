# Target State Plan & Gap Analysis: Frontend Vite SPA → Next.js App Router

## TL;DR
- Target: **Next.js 16.4.x** (npm `latest` = 16.4.4 on 2026-11-02) App Router, `src/app`, `proxy.ts`, Turbopack, `output: "standalone"`, `next dev -p 5173`. Chakra v3 (admin), Tailwind v4 via `@tailwindcss/postcss`, TanStack Query v5 (`getQueryClient()`), Vitest + jsdom with an in-repo `next/navigation` memory mock.
- The user's tree is kept in spirit (route groups, `features/`, `plugins/host|slots`, `routing/`, `api/server.ts`, `theme/palettes`, proxy) but **corrected in 12 places**: one shared chrome layout above the public and panel groups, no `/` → `/home` rewrite, top-level `/product/[id]`, legacy redirects, `[[...path]]`, admin-only AppShell + PluginProvider, and a `[slug]` layout that never calls `notFound()`.
- Auth design (binding: "backend reads cookie"): the **frontend writes a readable `auth_token` cookie** in lockstep with localStorage. The **backend accepts the cookie only on GET/HEAD**, so it is CSRF-free by construction. Mutations and plugins keep Bearer. Add `Vary: Authorization, Cookie`.
- Strategy: **phased, in-repo, single switch-over**. Phase A runs on Vite and keeps the suite green: renames, SSR-hazard fixes, a navigation facade plus a `renderWithRoute` test helper, the session cookie, and the backend cookie read. Phase B swaps to Next. Phase C adds metadata and the palette on the server and retires backend OG. Phase D covers deploy and docs. Tests act as the invariant across the swap.
- Risk **high** (breadth, plus auth and OAuth2 paths); mitigated by the facade-first phasing, a fresh test baseline and a smoke checklist.

## Key Decisions
- Next 16.4.x over 15.5: 16 is the active line (LTS to 2027-10), `proxy.ts` and async params are the future API, React 19.2 is already used, and nothing blocks it. 15.5 is only on the `backport` tag.
- `src/pages` must be renamed. With `src/app` present, Next would treat `src/pages/*` as Pages Router routes. A mechanical `git mv src/pages src/features` (internal folders unchanged) is the minimum; the plural/owner-page restructure is deferred.
- `src/app/` (AppDataContext, appDataStore, AppModals) → `src/app-data/` before scaffolding Next.
- One persistent chrome layout `app/(site)/layout.tsx` (PublicLayout: top bar, BottomNav, PendingActionsHost) holds `(public)` and `(panel)`. Crossing between them only remounts the group layouts, never the chrome, which matches today.
- `/` is not rewritten. `(panel)/layout.tsx` reproduces `AppRoute` (anonymous `/` → LandingPage, anonymous `/add` → PublicAddView, else AuthGuard + AppDataProvider), so `home` needs no reservation and `viewPath("home")` stays `/`.
- Server metadata uses **anonymous** backend fetches (`cache: "no-store"`). OG bots are anonymous, and personalised data must never land in `<head>`. The cookie on the server seeds AuthProvider and proxy gating only.
- The router-coupled code goes through a facade `src/navigation/` whose API mirrors the React Router subset in use (`Link to/replace/state`, `useAppNavigate`, `useAppParams`, `useAppSearchParams` with functional setter, `useAppPathname`, `useHasInAppHistory`, `useNavigationState`, `useNavigationGuard`, `matchPath`). It is first implemented on React Router (Vite), then on `next/navigation`.
- Plugin SDK keeps its separate Vite IIFE build to `public/assets/plugin-sdk.js` (`predev`/`prebuild`). The port stays 5173.

## Open Questions / Risks
- `useBlocker` has no App Router equivalent. The custom guard covers links, programmatic navigation and tab close. Back/forward is handled best-effort (popstate re-push). See decision D4.
- Panel/admin views SSR vs client-only mount (decision D2). Client-only removes hydration risk on localStorage-heavy panel code at no SEO cost.
- OG parity: the backend text rules (`DD.MM.YYYY`, `clock.format_term_when`, "Strona organizacji …") must be re-implemented in TS. Expected strings are lifted from `tests/test_public_preview.py` into Vitest before that file is deleted.
- Behaviour deltas to accept explicitly: real 404 page for unmatched URLs (today it is React Router's default error element); `/:slug/group/:groupId` (no term) has backend OG today but no frontend route, so it becomes a 404 page; Next scrolls to top on push (search-param updates must pass `scroll: false`).
- `proxyClientMaxBodySize` (10 MB default): `proxy.ts` must **not** match `/api/*`, or photo uploads (≤15 MB) would be truncated.
- Pre-existing failures: ~13 on HEAD (2026-10-31) and a flaky OrganizerEditor. A fresh baseline is needed before Phase A.

---

## 1. Target System

### 1.1 Technologies (pinned at implementation time)

| Area | Current | Target |
|---|---|---|
| Framework | Vite 8 SPA, `createBrowserRouter` (react-router-dom 7.13) | **Next.js 16.4.x** App Router (`src/app`), Turbopack (default in 16 for dev and build) |
| React | 19.2.4 | 19.2.x (Next 16 requires ≥19.2) |
| Node | node:22-alpine (build only) | node:22-alpine runtime (Next 16 requires Node ≥20.9) |
| Edge logic | none | `src/proxy.ts` (Next 16 rename of `middleware.ts`; Node runtime only) |
| Styling | Tailwind v4 via `@tailwindcss/vite`; Chakra v3.34 (admin) | Tailwind v4 via `@tailwindcss/postcss` + `postcss.config.mjs`; Chakra v3 (3.37) in a `'use client'` provider, `<html suppressHydrationWarning>` |
| Data | TanStack Query 5.103, module-singleton `queryClient` | TanStack Query 5.10x with `getQueryClient()` (new per server render, singleton in browser), same retry policy |
| Env | `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` | `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (inlined at build, Docker ARG renamed); server-only `BACKEND_INTERNAL_URL` |
| Lint | eslint 9 + react-refresh vite preset | eslint 9 flat config + `eslint-config-next` 16.4 (`next lint` removed in 16; `npm run lint` = `eslint .`) |
| Types | `tsc -b` | `tsc --noEmit` (+ `next typegen` for `PageProps`/`LayoutProps`); tsconfig gains `plugins: [{name:"next"}]`, `@/*` alias for new files |
| Tests | Vitest 3 + jsdom + RTL + MemoryRouter | Vitest 3 + jsdom + RTL; `@vitejs/plugin-react` kept for Vitest only; global `vi.mock("next/navigation")` / `vi.mock("next/link")` backed by `src/test/navigationMock.ts` |
| Plugin SDK | `vite.sdk.config.ts` IIFE | unchanged; output copied to `public/assets/plugin-sdk.js` in `predev`/`prebuild` |
| Deploy | nginx static + backend catch-all serving `index.html` with OG | nginx (edge) → Next standalone (`web:3000`) for pages; `/api`, `/oauth2/{token,register,introspect}`, `/.well-known/*` → backend |

### 1.2 Next 16 facts that shape the code (external research)
- `middleware.ts` → **`proxy.ts`** (export `proxy`). Proxy runs on the Node.js runtime and buffers request bodies up to `proxyClientMaxBodySize` (10 MB), so it is matched narrowly.
- **Async request APIs only**: `params`, `searchParams`, `cookies()`, `headers()` are Promises; the synchronous compatibility access is removed in 16.
- **Turbopack default** for `next dev`/`next build` (`--webpack` to opt out). No custom webpack config is needed here.
- `next lint` and the `eslint` option in `next.config` are removed; `next build` no longer lints.
- Metadata streaming: `generateMetadata` blocks for crawler user agents (`htmlLimitedBots`), so OG tags reach unfurl bots in the first response.
- `fetch` is uncached by default (since 15); still pass `cache: "no-store"` explicitly in `api/server.ts`. `cacheComponents` stays **off**.
- Guides: https://nextjs.org/docs/app/guides/upgrading/version-16 and https://nextjs.org/docs/app/guides/migrating/from-vite

### 1.3 Corrected target tree

```
src/frontend/
├─ next.config.ts          output:"standalone"; rewrites (dev+prod fallbacks):
│                          /api/:p*, /oauth2/(token|register|introspect), /.well-known/:p* → BACKEND_INTERNAL_URL
├─ postcss.config.mjs      @tailwindcss/postcss
├─ vite.sdk.config.ts      unchanged (IIFE) → public/assets/plugin-sdk.js
├─ vitest.config.ts        jsdom; setup mocks next/navigation + next/link
├─ public/ favicon.svg icons.svg assets/{plugin-sdk.js (built), plugin-ui.css}
└─ src/
   ├─ proxy.ts             (1) POST /oauth2/authorize → rewrite to backend; (2) cookie-presence gate
   │                       for private prefixes from routing/paths.ts (never "/", "/add", "/login",
   │                       "/product/*", slug routes); matcher excludes /api, /_next, /assets, files
   ├─ app/
   │  ├─ layout.tsx        <html lang="pl" suppressHydrationWarning>, fonts <link>, globals.css,
   │  │                    reads cookies() → <Providers initialToken> ; <div id="root"> wrapper (replaces #root CSS)
   │  ├─ providers.tsx     'use client': QueryClientProvider(getQueryClient), ChakraProvider(system),
   │  │                    AuthProvider(initialToken), NavigationTracker
   │  ├─ not-found.tsx     NEW (today: React Router default error element)
   │  ├─ (site)/                       ← ONE persistent chrome: PublicLayout (top bar, BottomNav, PendingActionsHost;
   │  │  │                               thread page h-dvh + no BottomNav via usePathname)
   │  │  ├─ layout.tsx
   │  │  ├─ login/page.tsx             AuthGuard requireAuth={false} inside LoginPage (unchanged)
   │  │  ├─ product/[id]/page.tsx      ItemDetailPage (top-level product URL — was missing in user tree)
   │  │  ├─ product/[id]/edit/page.tsx redirect(`/product/${id}?edit=1`)
   │  │  ├─ (panel)/                   ← 'use client' layout = today's AppRoute: anon "/"→LandingPage,
   │  │  │  │                             anon "/add"→PhoneFrame+PublicAddView, else AuthGuard+AppDataProvider+AppPage frame
   │  │  │  ├─ layout.tsx
   │  │  │  ├─ page.tsx                "/" (home view / landing) — no /home rewrite
   │  │  │  ├─ meetings items wanted search profile account settings /page.tsx
   │  │  │  ├─ add/{page, product, term, event, hunting}
   │  │  │  ├─ groups/{page, new}  groups/[groupId]/edit
   │  │  │  ├─ places/{page, new}  places/[locationId]/edit
   │  │  │  ├─ family/{page, new, edit, members/new, members/[familyMembershipId]/edit}
   │  │  │  ├─ events/[eventId]/edit
   │  │  │  └─ terms/[termId]/edit
   │  │  ├─ (member)/                  ← authenticated, PublicLayout chrome, NO AppDataProvider (AuthGuard layout)
   │  │  │  ├─ layout.tsx
   │  │  │  ├─ terms/[termId]/page.tsx     TermAttendeesPage
   │  │  │  ├─ groups/[groupId]/page.tsx   GroupDetailsPage
   │  │  │  └─ messages/{page, [conversationId]/page}
   │  │  └─ [slug]/                    ← public; NO layout-level notFound(); `krag` + UUID parties pass
   │  │     ├─ (owner)/layout.tsx      server: best-effort anonymous organizer theme (skip krag/UUID/404)
   │  │     │                          → initial palette vars into OrganizerThemeScope
   │  │     │  ├─ page.tsx             OwnerPage (UUID → PartyProfilePage, else PublicOrganizationPage) + generateMetadata
   │  │     │  ├─ items/ meetings/ terms/ page.tsx
   │  │     │  ├─ product/page.tsx     redirect(`/${slug}`)
   │  │     │  └─ product/[id]/{layout.tsx (OrganizerItemContext replaces useOutletContext), page.tsx, edit/page.tsx → ?edit=1}
   │  │     ├─ event/[eventId]/page.tsx              generateMetadata + own theme (slug cosmetic)
   │  │     └─ group/[groupId]/term/[termId]/page.tsx generateMetadata + own theme (slug cosmetic)
   │  ├─ (standalone)/                 ← AuthGuard, no chrome
   │  │  ├─ layout.tsx
   │  │  ├─ onboarding/ organization/ page.tsx
   │  │  └─ oauth2/authorize/page.tsx  GET only; POST is rewritten to the backend by proxy.ts
   │  └─ admin/                        ← AuthGuard; PluginProvider + AppShell (Chakra) ONLY here;
   │     │                               role gate admits ADMIN or PLUGIN_MANAGEMENT (today: auth-only + in-component checks)
   │     ├─ layout.tsx  page.tsx (redirect → /admin/products)
   │     ├─ products/{page, new, [id]/{page, edit}}  categories/{page, new, [id]/edit}
   │     ├─ groups/ terms/ photos/
   │     └─ plugins/{page, new, [pluginId]/{detail, edit, [[...path]]}}   ← optional catch-all; no [pluginId]/page.tsx
   ├─ features/            ← git mv of src/pages (internal folder names unchanged in this migration)
   ├─ app-data/            ← renamed src/app (AppDataContext, appDataStore, AppModals)
   ├─ navigation/          ← facade: Link, useAppNavigate, useAppParams, useAppSearchParams, useAppPathname,
   │                         useHasInAppHistory, useNavigationState, useNavigationGuard, matchPath
   ├─ components/{layout/, shared/, pending/}
   ├─ plugins/             host/ + slots/ split optional; PluginProvider stays admin-scoped (not root)
   ├─ plugin-sdk/          unchanged
   ├─ api/{client.ts (browser, Bearer), server.ts (server-only, anonymous by default, no-store), queryClient.ts (getQueryClient), …}
   ├─ auth/{AuthContext.tsx (SSR-safe, seeded by initialToken), AuthGuard.tsx, session.ts (localStorage + cookie lockstep)}
   ├─ theme/{system.ts, orgPalette.ts, palettePresets.ts, OrganizerThemeScope (accepts initial vars)}
   ├─ routing/{paths.ts (viewPath, eventPath, …, PROTECTED_PREFIXES), reservedSlugs.ts}
   ├─ hooks/ lib/ utils/
   └─ test/  (navigationMock.ts, renderWithRoute.tsx, routeManifest.test.ts, reservedSlugs.test.ts, metadata parity tests)
```

**Layout remount behaviour.** In the App Router, a layout persists while navigation stays below it, and only the layouts that differ are remounted. With one root layout, crossing route groups never triggers a full reload.
- `(site)/layout` (chrome: NotificationBell, PendingActionsHost, BottomNav) persists across public ↔ panel ↔ member ↔ slug navigation. This is the same as today's pathless `PublicLayout`.
- `(panel)/layout` (AppDataProvider + 10 s polling) persists across all panel sections, replacing the "same `AppRoute` element" trick. It remounts when leaving to `/product/x` or `/messages`, which matches today: those routes are outside `AppRoute`.
- `(site)` ↔ `(standalone)` ↔ `admin` remount the chrome, which also matches today: they are separate trees in `router.tsx`.

### 1.4 Reconciliation with the user's tree

| # | User tree | Correction | Reason (current behaviour) |
|---|---|---|---|
| 1 | `(public)` and `(panel)` as sibling layouts with their own chrome | Shared `(site)` chrome layout above both | PublicLayout is the chrome for public **and** panel pages; sibling layouts would remount NotificationBell/PendingActionsHost |
| 2 | `(panel)` uses AppShell | AppShell is admin-only | Sidebar/Header/MobileDrawer are Chakra, used only in `/admin` |
| 3 | `middleware.ts` rewrites `/` → `/home` | No rewrite; `(panel)/page.tsx` at `/` with layout branching | Matches `AppRoute`; avoids reserving `home`, a `viewFromPath("home")` mismatch and a reachable `/home` duplicate |
| 4 | `(public)/page.tsx` landing, `(panel)` gated | `/` and `/add` sit in `(panel)` but are not gated by proxy | Anonymous `/` → LandingPage, anonymous `/add` → PublicAddView |
| 5 | Only `[slug]/product/[id]` | Add top-level `/product/[id]` | The main item URL (MyItemsView, ThreadPage, TakeSuccessSheet, ItemCreateView, pendingActions) |
| 6 | Edit via `?edit=1` only | Keep `/product/:id/edit`, `/:slug/product/:id/edit` → `?edit=1`, `/:slug/product` → `/:slug` | Legacy URLs. Implement as page-level `redirect()`; `next.config` redirects would also hit `/api/...` |
| 7 | `terms/[termId]`, `messages*` inside `(panel)` | Separate `(member)` group: AuthGuard, no AppDataProvider | Today they are outside `AppRoute`; the thread page is h-dvh with no BottomNav |
| 8 | `[slug]/layout` fetches owner + `notFound()` | `[slug]/(owner)/layout` best-effort theme, never `notFound()`; event/term resolve their own theme | `krag` pseudo-slug, UUID party ids; the slug is cosmetic for term/event |
| 9 | Admin gate = admin role | Admit ADMIN **or** PLUGIN_MANAGEMENT (`homePath` already routes both to `/admin/products`) | Otherwise plugin managers lose access |
| 10 | `[...path]` | `[[...path]]` | `plugins/:pluginId/*` matches an empty splat today |
| 11 | `<PluginHost>` in root layout | PluginProvider stays in `admin/layout` | Root mount would fetch plugins for anonymous visitors |
| 12 | `(panel)/home`, `[slug]/meetings` etc. | `home` dropped; `meetings` kept (new uncommitted route) | — |

Kept from the user's intent: route groups, `features/`, `plugins/` split, `routing/paths.ts` + `reservedSlugs.ts` with a parity test, `api/server.ts`, `theme/palettes` on the server, proxy, the `(standalone)` group, the SDK split build.

---

## 2. Gaps

### 2.1 Router API replacements (91 source files, 55 test files)

| React Router feature | Uses | Target (behind `src/navigation/`) |
|---|---|---|
| `Link` (`to`, `replace`, `state`) | 58 files / ~289 | Facade `Link` keeping the `to` prop → `next/link` (`href`, `replace`, `scroll`). `state` goes to the navigation-state store. Call sites only change the import path |
| `useNavigate` | 28 | `useAppNavigate()` → `router.push/replace`, `-1` → `router.back()`; consults the guard registry |
| `useParams` | 25 | `useAppParams()` → `useParams()` (client; catch-all returns arrays → normalise) |
| `useLocation` | 23 | `useAppPathname()`, `useAppSearchParams()`, `useHasInAppHistory()`, `useNavigationState()` |
| `useSearchParams` + functional `setSearchParams(fn,{replace})` | 12 | Facade returns `[params, set]`; `set` builds `URLSearchParams` → `router.replace(url, { scroll: false })` |
| `Navigate` (5, incl. relative `..?edit=1`) | 5 | Server `redirect()` in `page.tsx` (async params); client `Navigate` (AuthGuard) → effect + `router.replace` |
| `Outlet` / `useOutletContext` (ItemDetailPage) | 3 / 1 | Layout `children`; `OrganizerItemContext` provided by `[slug]/(owner)/product/[id]/layout.tsx` |
| `useMatch` (PublicLayout thread mode) | 1 | `matchPath(pattern, usePathname())` from `routing/paths.ts` |
| `location.state` (EventCreateView→EventPage toast, ItemCreateView→ItemDetailPage:113, PlaceCreateView→LocationPicker:59) | 3 flows | `navigate(to, { state })` writes a module store keyed by the target URL; `useNavigationState()` consumes it once. Lost on hard reload (acceptable; RR persisted it in history) |
| `location.key !== "default"` (ThreadPage:97, OwnerItemsPage:244, PartyProfilePage:27, ItemBackButton:15) | 4 | `useHasInAppHistory()`: `NavigationTracker` in providers records whether any client navigation happened since the document load (session depth counter, decremented on popstate) |
| `useBlocker` (EditorSheet:66; pathname-change predicate) | 1 | `useNavigationGuard(when, onBlocked)`: capture-phase click interception of same-origin `<a>` with a different pathname, facade `navigate` check, `beforeunload` (new: tab close), popstate best-effort (re-push the current URL, then the same confirm dialog; `proceed()` → `history.go(-1)`/push target). `next-navigation-guard` 0.2.0 peers only `next ^14 \|\| ^15` and is stale, so it is not used |
| `useNavigationType` (organizerMediaBlocks test) | 1 | Covered by `useHasInAppHistory`/tracker; adapt the test |
| `matchRoutes`/route-table imports in tests (`addRoute`, `messagesRoutes`, `EventPage`) | 3 tests | `test/routeManifest.test.ts` globs `src/app/**/page.tsx` → URL patterns, and asserts the inventory and that `paths.ts` helpers resolve to existing patterns |
| `createMemoryRouter` (8), `Routes`+probes (~18), MemoryRouter-only (~22), `vi.mock("react-router-dom")` (2) | 55 files / ~611 cases | One `renderWithRoute(ui, { url, pattern })` helper. Phase A: implemented with MemoryRouter+Routes. Phase B: with the `next/navigation` mock (pathname/search/params from the pattern; `router` records push/replace/back; `redirect`/`notFound` throw sentinels) |

Scroll: Next scrolls to top on `push`. Search-param-only updates (`?tab=`, `?edit=1`, `?mode=register`, filters) must pass `scroll: false` to match today. ThreadPage's own `scrollTo` is unaffected.

### 2.2 SSR hazards (must not crash during server render of client components)
- **Module-level**: `AuthContext.tsx:70` `loadStoredAuth()`. Replace with `initialToken` from the server cookie plus a client effect that reconciles with localStorage (and mirrors a localStorage-only token into the cookie: migration of existing dev sessions).
- **Render-time**: `OAuth2AuthorizePage:99`, `HomeView:21`, `PendingActionsHost:42`→snoozeStore, `useEventSignUp:21`→`readValidGuestProfile`, `useGuestMerge:20`, `useJoinCodeLink:63` (sessionStorage + hash), `OrganizationPage:126`, `EventPage:219`, `ItemStatusCard:125`, `TakeSuccessSheet:59`, `SwapAcceptSuccessSheet:75` (`window.location.origin`), `useState(() => document.activeElement)` in `appComponents:163`, `ConfirmDeleteDialog:39`, `ModalSheet:30`, `PhotoViewer:31`. Fix pattern: `useSyncExternalStore` with a server snapshot, or move the read into an effect/handler.
- **Module singletons**: `queryClient` → `getQueryClient()`. `snoozeStore`, `openSheets`, organizerSteps `createdCircle`, googleMaps `placesPromise` and `iframeRegistry` are browser-only by use but are module state shared across server requests. They must never be written during render; verify each.
- `api/client.ts` 401 handler (`window.location`): guard with `typeof window`. Server code uses `api/server.ts` only (absolute `BACKEND_INTERNAL_URL`, `import "server-only"`).
- With decision D2 (client-only mount of panel/member/standalone/admin views), the hazards that matter for hydration narrow to the public subtree: chrome, login, product, slug pages. All are still fixed, because the same components are shared.

### 2.3 Auth cookie (binding: backend reads the cookie) — recommended minimal safe design

| Aspect | Design |
|---|---|
| Writer | **Frontend** `auth/session.ts` `setSession(jwt)` / `clearSession()`: localStorage `auth_token` **and** cookie `auth_token` together. Called by login, register, `applyExternalToken` (guest merge), logout, the 401 handler and the boot reconciliation. A backend `Set-Cookie` would miss `applyExternalToken`/token-exchange flows and would need a new logout endpoint |
| Attributes | `Path=/; SameSite=Lax; Max-Age=<jwt exp − now>; Secure` when `location.protocol === "https:"`. **Not HttpOnly**: the same JWT stays in localStorage for Bearer calls and plugin `getToken`, so HttpOnly would add no XSS protection |
| Backend read | `_extract_token`: header Bearer → `_token` query → `_token` form → **`auth_token` cookie only when `request.method in {"GET","HEAD"}`** |
| CSRF | No cookie-authenticated mutation exists, so there is no CSRF surface; `SameSite=Lax` is defence in depth. `POST /oauth2/authorize` keeps the hidden `_token` form field (unchanged). Implementation check: confirm that no GET route in `AUTHORIZATION_MATRIX` mutates state |
| Cache | `cache_headers.py`: `Vary: Authorization, Cookie`. Update the exact-header assertions in backend tests and `standards/backend/security.md` |
| Server use | Root layout reads `cookies()` → `initialToken` for AuthProvider (no hydration flip on `/`). `proxy.ts` checks cookie **presence** only (no JWT verification; expiry is still handled client-side by AuthGuard/401). Metadata fetches stay anonymous |
| Backend tests | `test_auth_cookie.py` (new): GET with cookie resolves the principal; POST with cookie only → 401 on an AUTHENTICATED route; Bearer wins over the cookie; invalid cookie → anonymous on OptionalPrincipal routes; `Vary` value |

### 2.4 OAuth2 GET page vs POST backend
- Today, `/oauth2/*` goes to the backend (Vite proxy / nginx), and GET `/oauth2/authorize` reaches the backend `spa_fallback`, which serves `index.html`.
- Target: `app/(standalone)/oauth2/authorize/page.tsx` serves GET. `proxy.ts` (matcher `/oauth2/authorize`) rewrites `POST` to `${BACKEND_INTERNAL_URL}/oauth2/authorize` with the body intact (small form). `/oauth2/token|register|introspect` and `/.well-known/oauth-authorization-server` reach the backend via `next.config` rewrites (dev), and via nginx `location` blocks (prod).
- Tests: a unit test of the proxy function (GET passes through, POST rewrites), plus a manual round-trip in the smoke list.

### 2.5 OG / metadata and palette on the server (replacing backend injection)
- `generateMetadata` in `[slug]/(owner)/page.tsx` (organization: name, "Strona organizacji {name}.", cover image), `event/[eventId]` (name, Polish `format_term_when` + " · place" + description, banner w1600), `group/[groupId]/term/[termId]` (circle name, "Najbliższy termin: DD.MM.YYYY." + description, or the join text), plus a default `metadata` in the root layout (title "Krąg grupy").
- og:type `website`; twitter card `summary_large_image` when there is an image, else `summary`.
- Data comes from the existing public endpoints, fetched anonymously (`/api/events/{id}` has `banner_url`; the public organization response has `cover`; the public circle view).
- Format naive Warsaw strings without TZ conversion (string/dayjs local parse; no `timezone` plugin needed). The container sets `TZ=Europe/Warsaw` as a safeguard.
- Opportunity, not required: metadata for `/product/[id]`, `/:slug/items|meetings|terms`, UUID profiles.
- Palette: `(owner)/layout` and the event/term pages fetch the theme anonymously and pass initial CSS vars to `OrganizerThemeScope` via the pure `buildOrgThemeVars`/`palettePresets`. The client keeps live editor updates.
- Backend removal: `app/system/public_preview.py`, the preview routes and `spa_fallback` in `app/system/router.py` (keep `/api/health` and the JSON 404), `static/index.html` usage, `tests/test_public_preview.py` (11 tests; expected strings ported to Vitest first), plus any matrix rows or docs that reference them.

### 2.6 Reserved slugs
- Backend slugs are `[a-z0-9-]` (`slugify`), so `_next`, `favicon.svg`, `icons.svg` and `.well-known` can never collide. Every top-level static segment of the corrected tree (`login`, `oauth2`, `onboarding`, `organization`, `admin`, `product`, `terms`, `groups`, `messages`, `meetings`, `items`, `profile`, `settings`, `places`, `family`, `account`, `search`, `wanted`, `add`, `events`) is already in `RESERVED_SLUGS`.
- No backend addition is needed, unless D6 picks the `/home` rewrite (then add `home`). Update the `slugs.py` docstring (`router.tsx` → `src/app`).
- `routing/reservedSlugs.ts` + `test/reservedSlugs.test.ts`: (a) every top-level static `src/app` segment outside route groups is in the frontend list; (b) every list entry that `slugify` could produce appears in `src/backend/app/organizations/slugs.py` (parsed as text). Verify that slugs are validated with the same pattern when set directly, not only via `slugify`.

### 2.7 Other gaps
- **Fonts**: keep the Google Fonts `<link>` (Bricolage Grotesque, Figtree) in the root layout `<head>` for parity. `next/font` is an optional follow-up.
- **CSS cascade**: `globals.css` = the current `index.css` with `@layer reset, base, tokens, recipes, theme, components, utilities;` first, then `@import "tailwindcss"`. It is imported in the root layout, so it precedes Emotion's styles. `#root` rules → `<div id="root">` in the root layout. Visually check admin (Chakra) and organizer palettes.
- **React StrictMode**: on by default in the App Router (parity with `main.tsx`).
- **`<title>` in 5 pages**: React 19 hoisting still works in client components, but where a page also gets `generateMetadata`, drop the duplicate.
- **Google Maps**: `lib/googleMaps.ts` lines 41/59, `vi.stubEnv` in 3 tests, `.env.example`, Dockerfile ARG, compose build args.
- **Plugin SDK**: `predev`/`prebuild` = the existing `build:sdk`. Root `package.json` `web`/`dev:all` switch `vite` → `next dev -p 5173`. The 4 plugins keep `http://localhost:5173/assets/plugin-sdk.js` + `plugin-ui.css` (served from `public/`). `plugins/server-sdk.ts` import in `plugin-sdk-auth.test.ts` stays. Delete the stale `src/resources/static/assets/plugin-sdk.js` copy.
- **Removed files**: `router.tsx`, `main.tsx`, `index.html`, `vite-env.d.ts`, `vite.config.ts` (the `vitest.config.ts` and `vite.sdk.config.ts` remain), the react-refresh ESLint preset, the `react-router-dom` dependency.
- **Deploy**: Dockerfile → stages deps / build (`next build` + SDK, ARG `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) / runner (`.next/standalone`, `.next/static`, `public`, `node server.js`, `PORT=3000`, `HOSTNAME=0.0.0.0`). Compose: delete `frontend-build`, the `frontend_index` volume, the backend `/app/static` mount and its `depends_on`. Add `web` (Next, `BACKEND_INTERNAL_URL=http://backend:8080`). Keep `frontend` = nginx on 5174:80 with `/api/` (16m body), `/oauth2/` (except `= /oauth2/authorize` → web), `/.well-known/` → backend and `/` → `web:3000`. Fix the architecture.md 5173-vs-5174 line.
- **Docs/standards**: `standards/testing/frontend-testing.md` (renderWithRoute + navigation mock), `standards/frontend/data-fetching.md` (`getQueryClient`, `providers.tsx`), `standards/frontend/components.md` (paths `features/term/...`, facade rule: never import `next/navigation` directly), `standards/frontend/accessibility.md` (paths), `standards/backend/security.md` (cookie on safe methods, `Vary`), `standards/backend/plugin-auth.md`, `project/tech-stack.md` (frontend section), `project/architecture.md` (deploy, OG via Next, ports), `plugins/CLAUDE.md`, INDEX.md.

---

## 3. Migration Classification & Strategy

**Type**: code + architecture. This is a framework/runtime swap, plus a deploy topology change and a cross-cutting auth change in the backend.

**Strategy: phased in-repo, single switch-over (no dual-run).** There is no production, so running Vite and Next side by side gains nothing. A pure big-bang would change 91 router files, 55 test files, auth and deploy at once, so a regression could come from any of them. The phased approach moves every behaviour-changing refactor onto the Vite app, where the existing suite verifies it. The Next swap then becomes a re-implementation of a few seams (facade, test helper, entry points), which the same tests verify.

| Phase | Steps | Gate |
|---|---|---|
| **A0 Baseline** | Fresh `vitest run` pass/fail list + case count; backend `pytest` baseline; ruff/mypy baselines (mypy 15) | Recorded in `verification/` |
| **A1 Renames** | `src/app` → `src/app-data`; `src/pages` → `src/features` (git mv, imports fixed, no logic change) | Suite == baseline |
| **A2 SSR-safety** | Fix the ~15 render/module-time browser reads; `getQueryClient()` | Suite == baseline |
| **A3 Navigation facade (on React Router)** | `src/navigation/*` on RR; migrate 91 files; `location.state`/`location.key`/`useOutletContext`/`useBlocker` semantics behind the facade; `renderWithRoute` helper (MemoryRouter impl) and migration of the 55 test files to it; `routing/paths.ts`, `reservedSlugs.ts` | Suite == baseline, case count unchanged |
| **A4 Session cookie + backend** | `auth/session.ts` lockstep cookie; backend `_extract_token` cookie on GET/HEAD, `Vary: Authorization, Cookie`, backend tests | Both suites green vs baseline |
| **B1 Scaffold Next** | deps, `next.config.ts`, postcss, tsconfig, eslint-config-next, root layout/providers, globals.css, fonts, env rename | `next build` passes |
| **B2 Route tree** | Thin `page.tsx`/`layout.tsx` per the corrected tree; server redirects; `(panel)` layout = AppRoute; admin gate | Route manifest test |
| **B3 Swap seams** | Facade impl → `next/navigation`/`next/link`; `renderWithRoute` → navigation mock; delete router/main/index.html/vite.config; replace the route-table tests | Suite == baseline (case count preserved, documented replacements only) |
| **B4 proxy.ts** | OAuth2 POST rewrite + cookie-presence gate; unit tests | Proxy tests |
| **C SSR metadata/palette** | `api/server.ts`; `generateMetadata` ×3 + root; palette initial vars; ported OG expected strings; remove backend OG + catch-all + 11 tests | Vitest parity + pytest green |
| **D Deploy & docs** | Dockerfile/nginx/compose, `.env.example`, root scripts, launch.json check, standards/docs; manual/Playwright smoke | Smoke checklist passes |

**Smoke checklist**: anonymous `/`, `/add`; login → returnTo; panel section switching (no AppData reload); `/krag/group/:g/term/:t`; `/:slug`, UUID party, `/:slug/items|meetings|terms`; `/product/:id` and `/:slug/product/:id` (+ legacy `/edit` redirects); `/messages/:id` layout; EventCreate → toast; PlaceCreate → LocationPicker pick; organizer editor dirty-leave prompt (link, back, tab close); admin as PLUGIN_MANAGEMENT; plugin iframe + SDK from :5173; OAuth2 authorize round trip; OG tags via `curl -A facebookexternalhit`; photo upload of 15 MB via nginx.

---

## 4. Risk & Breaking Changes

**Risk level: high** (breadth: ~340 files, 55 router-coupled test files; auth and OAuth2 paths; deploy topology). The phasing, the baseline and the smoke list bring the residual risk to medium.

**Breaking changes**
1. Dev/build commands: `vite` → `next dev -p 5173` / `next build`; `preview` removed; `next lint` unavailable (use `eslint .`).
2. Env var `VITE_GOOGLE_MAPS_API_KEY` → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (`.env`, `.env.example`, compose build args, Dockerfile ARG).
3. Directory moves: `src/pages` → `src/features`, `src/app` → `src/app-data`; `router.tsx`, `main.tsx`, `index.html`, `vite-env.d.ts`, `vite.config.ts` removed; `react-router-dom` dropped.
4. Backend no longer serves frontend HTML: `spa_fallback`, OG preview routes, `public_preview.py`, the `static/index.html` volume and `test_public_preview.py` removed; unknown non-API paths on the backend return 404 JSON.
5. Backend accepts an `auth_token` cookie on GET/HEAD; `Vary` becomes `Authorization, Cookie`.
6. New `auth_token` cookie written by the frontend; logout/401 clear it.
7. Deploy topology: new `web` (Next standalone) service; `frontend-build` + `frontend_index` removed; nginx proxies pages to Next.
8. `/oauth2/authorize` POST now passes through Next `proxy.ts`; `/.well-known/*` and `/oauth2/{token,register,introspect}` need explicit routing (previously reached via the nginx fallback).
9. Unmatched URLs render `not-found.tsx` (previously React Router's default error element); `/:slug/group/:groupId` without a term now shows the 404 page (previously a blank SPA page with backend OG).
10. Navigation scrolls to top on push (previously kept the position); search-param updates explicitly keep the scroll position.
11. Test infrastructure: MemoryRouter-based `renderWithProviders` replaced by `renderWithRoute` + the navigation mock; route-table tests replaced by a route-manifest test.
12. `location.state` no longer survives a hard reload (module store).
13. Admin layout gate: PLUGIN_MANAGEMENT/ADMIN checked in the layout (previously auth-only + in-component checks). Non-admin users get a redirect instead of in-page messages; verify parity of the messages shown.

---

## 5. Decisions Needed

### Critical
- **D1 Next version**: Options: 16.4.x (latest) / 15.5 (backport). **Rec 16.4.x**: active major with LTS; `proxy.ts` and async APIs are where the docs point; React 19.2 is already present. 15.5 would mean a second migration later.
- **D2 Rendering of authenticated views**: Options: (a) SSR every client view (all hazards fixed, cookie-seeded auth); (b) **client-only mount for `(panel)`, `(member)`, `(standalone)`, `admin`** (a `ClientOnly` gate in their layouts) and SSR for the public subtree (chrome, login, product, slug pages); (c) client-only everywhere. **Rec (b)**: authenticated pages gain nothing from SSR and are the most localStorage-heavy, and Chakra/Emotion SSR ordering stops mattering in admin. Public pages still get server metadata and palette, as decided.
- **D3 Auth cookie design** (refines the binding "backend reads cookie"): Options: (a) **frontend-written readable cookie, backend reads it on GET/HEAD only, Bearer for mutations and plugins**; (b) backend `Set-Cookie` HttpOnly on login/register + logout endpoint + double-submit CSRF token on all mutations; (c) cookie on all methods with SameSite=Lax as the only CSRF defence. **Rec (a)**: no CSRF surface, covers `applyExternalToken`, plugins' `getToken` unchanged, and the smallest backend diff. HttpOnly adds nothing while the token also sits in localStorage.
- **D4 `useBlocker` replacement**: Options: (a) **custom `useNavigationGuard`**: link interception + programmatic + `beforeunload` + best-effort popstate; (b) the same without back/forward handling (accept the regression); (c) restructure the editor so leaving is non-destructive (auto-save draft). **Rec (a)**: closest parity, and it adds a tab-close guard. OrganizerEditor's blocked-navigation tests are adapted to the facade.

### Important
- **D5 OG text source**: Options: (a) **port the 3 formatters to TS `generateMetadata` over existing public endpoints, with expected strings copied from `test_public_preview.py`**; (b) replace HTML injection with a backend JSON `GET /api/public-previews/...` that reuses the Python formatters. **Rec (a)**: matches the decision to delete `public_preview.py`; the formatters are three short functions. (b) is the fallback if date-format parity proves fiddly.
- **D6 `/` handling**: Options: (a) **no rewrite: `(panel)` layout branches like today's AppRoute**; (b) the user's proxy rewrite `/` → `/home` when the cookie is present (+ reserve `home`, fix `viewFromPath`). **Rec (a)**: zero behaviour change, no backend slug change, no stale-cookie misroutes.
- **D7 `features/` restructure scope**: Options: (a) **mechanical `git mv src/pages src/features` now, plural/owner-page reorganisation deferred**; (b) the full reorganisation per the user's tree in this migration. **Rec (a)**: the rename itself is mandatory (Next's Pages Router would claim `src/pages`); the reorganisation multiplies import churn and hides regressions.
- **D8 proxy gating**: Options: (a) **cookie-presence redirect to `/login?returnTo=` for private prefixes from `routing/paths.ts` (excluding `/`, `/add`, public routes), client AuthGuard stays authoritative**; (b) proxy handles only the OAuth2 split, with client guards as today. **Rec (a)**: it was requested and removes the flash of guarded pages; expired-token handling stays client-side.
- **D9 Test navigation mocking**: Options: (a) **in-repo `navigationMock.ts` + `renderWithRoute` (supports `useParams` from a route pattern, router call capture, redirect/notFound sentinels)**; (b) `next-router-mock` 1.0.5 (`next/navigation` support lacks `useParams`/`redirect`). **Rec (a)**.
- **D10 Edge server**: Options: (a) **keep nginx in front of Next** (`/api` 16m body, `/oauth2/*`, `/.well-known` → backend; `/` → Next); (b) Next alone with `next.config` rewrites to the backend. **Rec (a)**: keeps the upload limit and the forwarded headers as they are; the rewrites remain for dev.
- **D11 `/:slug/group/:groupId` (circle without term)**: Options: (a) **404 page (parity with the SPA, which had no route)**; (b) add a page/redirect to the circle's next term. **Rec (a)**, with a follow-up if old links matter.
- **D12 Fonts**: Options: (a) **keep Google Fonts `<link>`**; (b) `next/font/google` + CSS variables. **Rec (a)** for pixel parity; (b) as a follow-up.

---

## 6. External Research
- Performed: yes (npm registry `dist-tags` for `next`: latest 16.4.4, backport 15.5.28, canary 16.5.0-canary.36; release trackers; `next-navigation-guard` 0.2.0 peers `next ^14 || ^15`; `next-router-mock` 1.0.5; `@chakra-ui/react` 3.37.0 peers react ≥18 + @emotion/react; `eslint-config-next` 16.4.4).
- Category: frontend framework migration (SPA bundler + client router → full-stack React framework, major version 16).
- Guides: https://nextjs.org/docs/app/guides/upgrading/version-16, https://nextjs.org/docs/app/guides/migrating/from-vite
