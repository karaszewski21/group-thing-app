# Codebase Analysis Report: Frontend Current State (Vite SPA → Next.js App Router)

**Date**: 2026-11-02
**Task**: Migrate `src/frontend` from Vite 8 + React Router 7 SPA to Next.js App Router
**Description**: "migracja frontend na Next.js. Bez regresji, to MVP, brak produkcji" (no regressions; MVP; no production deployment). User target tree: `analysis/user-target-structure.md`
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Migration Target)

---

## TL;DR
- The app is a large client-only SPA: about 340 source files (~32.9k LOC) and 131 test files (~920 cases). React Router is used in 91 source files and 55 test files (~611 cases). Auth lives only in `localStorage`, and the backend accepts only a Bearer token.
- Migrating is feasible if nearly everything is a Client Component under App Router layouts. Server-side rendering and gating need a cookie mirror of the token, which the codebase does not have today.
- Hard blockers with no 1:1 equivalent in Next: `useBlocker` (organizer editor), `useOutletContext`, `location.state` flows, `location.key` history detection, the OAuth2 GET/POST split, and the `src/app/` name collision.
- The user's proposed tree has 8 mismatches with current behavior. The main ones: AppShell is admin-only (not panel), the top-level `/product/[id]` is missing, anonymous `/` and `/add` must stay public, and the admin gate must also admit `PLUGIN_MANAGEMENT`.
- Deployment (nginx fallback to backend, backend OG injection into `index.html`, compose `frontend-build` volume) assumes a static SPA. Next replaces this, and that has backend and compose impact outside `src/frontend`.

## Key Decisions
- **Phase 1 should be "client-first" App Router**: every existing page becomes a thin `page.tsx` around a `'use client'` view. Server Components and data prefetching are optional follow-ups. Rationale: "no regressions" combined with localStorage-only auth means the server cannot render personalized content without auth changes.
- **Keep the panel's shared chrome in one persistent layout**: one route group covers both public and panel pages, using PublicLayout (top bar + BottomNav + PendingActionsHost). AppShell + PluginProvider stays only under `/admin`. Rationale: this matches today's behavior, and splitting `(public)`/`(panel)` would remount NotificationBell and PendingActionsHost.
- **Keep AppDataProvider persistence**: mount it in a layout that covers all panel view paths so it does not remount on navigation, replacing today's "same AppRoute element" trick. Rationale: about 25 views rely on the shared state and its 10 s polling.
- **Mirror the token into a cookie (non-HttpOnly) for `proxy.ts`/middleware gating; keep Bearer-from-localStorage for API calls**. Rationale: the backend needs no change, which keeps the scope MVP-sized. HttpOnly or backend cookie auth means CSRF work and is out of scope.
- **Keep Vitest + RTL. Replace router wrappers with `next/navigation`/`next/link` mocks** (or `next-router-mock`) through one shared test helper. Rationale: this keeps the ~920 cases running.
- **Dev port stays 5173 (`next dev -p 5173`); the plugin SDK keeps its separate Vite IIFE build, output to `public/assets/plugin-sdk.js`**. Rationale: 4 plugins, backend CORS and launch.json hardcode the port and SDK URL.
- **Rename the `src/frontend/src/app/` folder** (AppDataContext, appDataStore, AppModals), for example to `src/app-data/`, before creating the Next `src/app/` dir.

## Open Questions / Risks
- **Auth model**: are a non-HttpOnly cookie mirror and client-side guards (as today) acceptable for the MVP? Or does the user expect server-side protection or SSR of personalized pages?
- **OG previews**: today the backend injects OG/Twitter tags into `index.html` for `/{slug}`, `/{slug}/group/{g}`, term and event routes (11 backend tests). Under Next, should `generateMetadata` replace this, or should the backend keep serving index.html? Moving it means retiring `public_preview.py` and the catch-all. Which side owns the work?
- **OAuth2 `/oauth2/authorize`**: GET must render the Next page, while POST must reach the backend. A Next page captures all methods, so the split has to happen in `proxy.ts`/middleware or the form must post elsewhere. This is security-sensitive.
- **`useBlocker`** in `pages/organizer/editor/EditorSheet.tsx:66` (unsaved-changes guard; OrganizerEditor.test.tsx has 28 tests and is flaky): needs a custom replacement (beforeunload + intercepted links/router), and behavior parity may not be perfect.
- **Concurrent work**: the working tree has uncommitted owner/party/meetings pages and route changes. There is also a second task folder `.maister/tasks/migrations/2026-11-02-vite-to-nextjs-frontend/`. Decide on a baseline commit before migrating.
- **Baseline test failures**: about 13 vitest failures already exist on HEAD (2026-10-31), and OrganizerEditor is flaky. Capture a fresh baseline so "no regression" is measurable.
- **Reserved slugs**: the backend `RESERVED_SLUGS` list lacks `home`, `_next`, `favicon.svg`, `icons.svg`. If the `/` → `/home` rewrite is adopted, `home` must be reserved, which is a backend change.
- **Timezone**: dayjs is loaded with `utc` but not `timezone`, so any server-rendered dates may differ from the browser's. This risk exists only if SSR of dates is introduced.
- **Chakra/Tailwind cascade**: the `@layer reset, base, tokens, recipes, theme, components, utilities;` order must still come before Emotion-injected styles in the SSR `<head>`. Verify this visually on admin pages.
- **Next version**: Next 16 renames `middleware.ts` → `proxy.ts`, uses Turbopack by default and removes `next lint`. The only Next in the repo is `plugins/ai-description` on 15.5 (Pages Router). Pick the version deliberately.

---

## Summary

`src/frontend` is a Vite 8 + React 19 SPA using React Router 7 (`createBrowserRouter`), TanStack Query v5, Chakra UI v3 (admin only) and Tailwind v4 (public/panel). It has no code splitting, no SSR assumptions, and auth held entirely in `localStorage["auth_token"]`. The router is the main coupling point: 91 source files and 55 test files depend on `react-router-dom`. Several features rely on router capabilities that App Router lacks. Deployment is built around a static `index.html` that the backend serves with OG injection. All of this makes the move to Next a broad but mostly mechanical "client-first" rewrite of routing, with a handful of hard design decisions (auth cookie, OAuth2 method split, OG ownership, unsaved-changes guard).

---

## Files Identified

### Primary Files

**src/frontend/src/router.tsx** (281 lines)
- The full route table. It maps directly to the `app/` tree and is imported by tests (addRoute, messagesRoutes, EventPage via `matchRoutes`).
- Has uncommitted changes (`/:organizationSlug/meetings`, OwnerPage).

**src/frontend/src/main.tsx**
- Provider stack: StrictMode > QueryClientProvider > ChakraProvider(system) > AuthProvider > RouterProvider. This becomes the root layout plus a client `providers.tsx`.

**src/frontend/src/auth/AuthContext.tsx**, **AuthGuard.tsx**, **authPaths.ts**, **homePath.ts** (4 files / 262 lines)
- `AuthContext.tsx:70` reads localStorage at module top level (`const initialAuth = loadStoredAuth()`), which crashes on SSR import.
- `AuthGuard` handles the client-side redirect to `/login?returnTo=`, and `requireAuth={false}` redirects logged-in users away from `/login`.
- `homePath`: ADMIN or PLUGIN_MANAGEMENT → `/admin/products`, else `/`.

**src/frontend/src/app/AppDataContext.tsx** (816 lines) + `appDataStore`, `AppModals` (3 files / 867 lines)
- Holds all panel state, derives the view from `location.pathname`, reloads on entering the panel, and polls photo moderation every 10 s (visibilitychange).
- Its folder name collides with the Next `src/app`.

**src/frontend/src/pages/home/AppPage.tsx** (130), **LandingPage.tsx** (108), **HomeView.tsx** (168)
- AppPage switches between about 25 `*View` components by pathname. Anonymous `/` shows LandingPage. `HomeView:21` reads localStorage in its `useState` initializer.

**src/frontend/src/utils/appHelpers.ts** (280 lines)
- `View`, `viewPath`, `ID_PATH_VIEWS`, `viewFromPath`, `isPartyId`, `eventPath`, `ownerPagePath`, `*EditPath`. These path helpers are the canonical URL contract.

**src/frontend/src/api/client.ts** (108), **queryClient.ts** (17), **problem.ts**
- Relative `/api` base and a Bearer token read on each call. A 401 removes the token and sets `window.location` to `/login?returnTo`.
- `queryClient` is a module singleton (no retry on 4xx, up to 2 on network/5xx). It needs a `getQueryClient()` pattern under Next.

**src/frontend/src/components/layout/** (9 files / 570 lines)
- `PublicLayout` (66): sticky top bar, BottomNav, PendingActionsHost; `useMatch` puts the thread page in h-dvh mode with no BottomNav. This is the chrome for both public and panel pages.
- `AppShell` (26), `Sidebar` (105), `Header` (86), `MobileDrawer` (108): **admin-only**, Chakra.

**src/frontend/src/pages/organizer/editor/EditorSheet.tsx**
- `useBlocker` at line 66 has no App Router equivalent.

**src/frontend/src/pages/auth/OAuth2AuthorizePage** (in pages/auth, 4 files / 538 lines)
- Reads localStorage in JSX (line 99) and posts a hidden `_token` to backend `POST /oauth2/authorize`.

**src/frontend/src/plugins/** (8 / 694) and **src/frontend/src/plugin-sdk/** (6 / 331)
- Host: PluginProvider (admin layout only), PluginFrame sandboxed iframes, message handler with origin and iframe-registry checks.
- SDK: a separate IIFE build. It touches `window` at module top level, which is fine because it is not bundled into the app.

**src/frontend/src/index.css**, **src/frontend/src/theme/** (4 / 572)
- `@layer` order declaration before `@import "tailwindcss"`. `@theme` has 13 themable role colors. `#root {max-width:1200px; margin-inline:auto}` needs a replacement selector.
- `orgPalette.ts`, `palettePresets.ts` (synced with backend `palettes.py`) and `OrganizerThemeScope` are pure and SSR-safe.

**Config**: `vite.config.ts` (proxy /api, /oauth2 → :8080; port 5173), `vite.sdk.config.ts`, `vitest.config.ts`, `tsconfig*.json` (bundler, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, no path aliases), `eslint.config.*` (reactRefresh vite preset), `index.html` (lang=pl, title "Krąg grupy", Google Fonts Bricolage Grotesque + Figtree), `package.json` (build = `tsc -b && vite build && vite build -c vite.sdk.config.ts`).

**Deployment**: `src/frontend/Dockerfile` (node:22-alpine builder with ARG `VITE_GOOGLE_MAPS_API_KEY` → nginx:1.27-alpine), `src/frontend/nginx.conf` (/api, /oauth2 → backend; `/` try_files → `@backend_fallback`), root `docker-compose.yml` (`frontend-build` copies `dist/index.html` into the `frontend_index` volume at backend `/app/static`; frontend 5174:80).

### Related Files

- **src/frontend/src/pages/** routers and views: product (20 / 2313), term (~26 / 2300), admin (12 / 2040), organizer (7 / 590 + blocks 26 / 1784 + editor 9 / 1120 + layouts 2 / 190), add (1056), events (846), messages (767), items (710), meetings (702), owner (4 / 637; OwnerPage, OwnerMeetingsPage, PartyProfilePage are untracked), family, groups, places, profile, search. `person/` is empty.
- **src/frontend/src/components/shared/** (32 / 3190): ModalSheet, trapFocus, openSheets (module counter), ConfirmDeleteDialog, PhotoViewer, CategoryTreePicker (`createPortal(document.body)`), appComponents.
- **src/frontend/src/components/pending/** (4 / 432): PendingActionsHost uses snoozeStore (localStorage + module memory fallback).
- **src/frontend/src/hooks/** (38 / 2601): TanStack Query wrappers (29 files; 2 `useInfiniteQuery`, 8 `refetchInterval`, no `useMutation`), useJoinCodeLink (sessionStorage + `location.hash`), useEventSignUp, useGuestMerge.
- **src/frontend/src/api/** (26 / 2677): `groups.ts` (619) includes `readValidGuestProfile` (localStorage).
- **src/frontend/src/lib/googleMaps.ts** (167): `import.meta.env.VITE_GOOGLE_MAPS_API_KEY` (lines 41, 59), script injection, module `placesPromise`.
- **src/frontend/src/utils/messagesPaths.ts**: other path helpers. `utils/dayjs.ts` sets the pl locale (no timezone plugin).
- **src/frontend/src/test/** (135 files / ~25k LOC): `setup.ts`, `queryClient.tsx`, `page.ts`, `themeContrast.ts`.
- **src/frontend/public/**: favicon.svg, icons.svg, assets/plugin-sdk.js (gitignored build copy), assets/plugin-ui.css. Stale copy at `src/resources/static/assets/plugin-sdk.js`.
- **Backend (outside scope but impacted)**: `src/backend/app/system/router.py` + `public_preview.py` (OG injection + catch-all), `app/organizations/slugs.py` (RESERVED_SLUGS), `app/core/_auth/token.py::_extract_token` (Bearer → `_token` query → `_token` form; no cookies), `app/core/cache_headers.py`, CORS `CORS_ALLOWED_ORIGINS` (default `http://localhost:5173`, `allow_credentials=True`), `tests/test_public_preview.py` (11 tests).
- **Plugins (external consumers)**: `plugins/warehouse`, `box-size`, `events` (Vite), `ai-description` (Next 15 Pages Router) hardcode `http://localhost:5173/assets/plugin-sdk.js` + `plugin-ui.css`. Also `plugins/sdk.ts`, `plugins/server-sdk.ts` (`HOST_BASE_URL` default `:8080`; imported by `plugin-sdk-auth.test.ts`), `plugins/CLAUDE.md`.
- **Root**: `package.json` (`web`, `dev:all` = build:sdk + vite dev + 4 plugin dev servers), `.dockerignore` (already excludes `**/.next`), `.claude/launch.json` (frontend on 5173). No CI config exists.

---

## Current Functionality

### Route inventory (from router.tsx)

| Group | Routes | Guard / wrapper |
|---|---|---|
| Standalone (AuthGuard, no PublicLayout) | `/oauth2/authorize`, `/onboarding`, `/organization` | AuthGuard |
| PublicLayout → AppRoute (shared element, AppDataProvider) | `/` (anon → LandingPage), `/meetings`, `/groups`, `/groups/new`, `/items`, `/profile`, `/settings`, `/places`, `/places/new`, `/family`, `/family/new`, `/family/edit`, `/family/members/new`, `/account`, `/search`, `/wanted`, `/add` (anon → PublicAddView in PhoneFrame), `/add/product`, `/add/term`, `/add/event`, `/add/hunting`, `/groups/:groupId/edit`, `/places/:locationId/edit`, `/family/members/:familyMembershipId/edit`, `/events/:eventId/edit`, `/terms/:termId/edit` | AppRoute → AuthGuard → AppPage (view via `viewFromPath`) |
| PublicLayout, AuthGuard, **no** AppDataProvider | `/terms/:termId` (TermAttendeesPage), `/groups/:groupId` (GroupDetailsPage), `/messages` (InboxPage), `/messages/:conversationId` (ThreadPage, h-dvh, no BottomNav) | AuthGuard |
| PublicLayout, public | `/login` (`?mode=register`; AuthGuard requireAuth=false), `/product/:id` (ItemDetailPage; non-public item → login inside the component), `/product/:id/edit` → `..?edit=1` | none |
| PublicLayout, org-scoped public | `/:slug/product` → `..`; `/:slug/product/:id` (OrganizerItemLayout = OrganizerThemeScope + PhoneFrame + `Outlet context=org`; index ItemDetailBody; `edit` → `..?edit=1`); `/:slug/group/:groupId/term/:termId` (TermPage); `/:slug/event/:eventId` (EventPage); `/:slug/terms`; `/:slug/items` (UUID = party, else slug); `/:slug/meetings` (new); `/:slug` (OwnerPage: UUID → PartyProfilePage, else PublicOrganizationPage) | none |
| `/admin` (PluginProvider + AppShell) | index → `products`; `products`, `products/new`, `products/:id`, `products/:id/edit`, `categories`, `categories/new`, `categories/:id/edit`, `groups`, `terms`, `photos`, `plugins`, `plugins/new`, `plugins/:pluginId/detail`, `plugins/:pluginId/edit`, `plugins/:pluginId/*` (PluginPageRoute) | AuthGuard only; roles checked inside components |

There is no `errorElement` and no `*` 404 route. The `krag` pseudo-slug is used for terms of groups without an organization (`/krag/group/:g/term/:t`). The slug segment is cosmetic in term and event routes, because those pages resolve their own owner and theme.

### Key Components/Functions

- **AuthContext**: holds token, username (sub), permissions, displayName and registeredRole. Login and register use raw `fetch` to `/api/auth/login|register`. `applyExternalToken` handles the guest merge. `logout` sets `window.location.href = "/login"`.
- **api client**: Bearer from localStorage on every call. A 401 is a hard redirect. `ApiError`, `extractProblemMessage`, `hasStatus`, `serverMessageOr` (Polish).
- **AppDataProvider / AppPage**: the panel state machine. Persistence depends on all panel paths sharing one route element.
- **Pure view-state modules** (`termViewState`, `eventViewState`, `threadViewState`, `itemActionsViewState`): router-agnostic and easy to carry over.
- **Plugin host**: `resolveExtensionPoints` (enabled, pluginId filter, priority sort) for `menu.main`, `product.detail.tabs`, `product.list.filters`, `product.detail.info`, and `add.event` (not rendered in prod). Message handler (`aj.plugin.` requestId, registered-iframe source, exact origin). `pluginFetch` is limited to `/api/` with no `..`. `uploadImage` is limited to the event banner. `getToken` returns the raw JWT. `resize` is not handled. `usePluginMessageHandler` is used only in tests.
- **Org theming**: OKLCH `buildOrgThemeVars` applied as inline CSS vars through `OrganizerThemeScope`. Layout registry + LayoutRenderer + blocks. Live editor via the `?tab=` sheet.

### SSR hazards (render-time or module-time browser access, ~15 files)
`AuthContext:70` (module), `OAuth2AuthorizePage:99`, `HomeView:21`, `PendingActionsHost:42` → `snoozeStore`, `useEventSignUp:21` → `readValidGuestProfile`, `useGuestMerge:20`, `useJoinCodeLink:63` (sessionStorage + hash), `OrganizationPage:126`, `EventPage:219`, `ItemStatusCard:125`, `TakeSuccessSheet:59`, `SwapAcceptSuccessSheet:75` (`window.location.origin` in render), and `appComponents:163`, `ConfirmDeleteDialog:39`, `ModalSheet:30`, `PhotoViewer:31` (`useState(() => document.activeElement)`).
Module singletons: queryClient, snoozeStore memoryFallback, openSheets counter, organizerSteps `createdCircle`, googleMaps `placesPromise`, `iframeRegistry`.
About 17 more files touch browser APIs only in effects or handlers, which is safe in Client Components.

### Router-specific features without App Router equivalents
- `useBlocker`: `EditorSheet.tsx:66`.
- `useOutletContext`: `ItemDetailPage` (org from OrganizerItemLayout). Replace with a React context provided by the layout.
- `location.state`: EventCreateView → EventPage toast (cleared after), ItemCreateView → `ItemDetailPage:113`, PlaceCreateView → `LocationPicker:59` (`pickedLocation`). Replace with a small store, sessionStorage or query params.
- `location.key !== "default"` (whether there is in-app history for back): ThreadPage:97, OwnerItemsPage:244, PartyProfilePage:27, ItemBackButton:15.
- `useMatch` (PublicLayout) → `usePathname`. Relative `<Navigate to="..">` redirects → `redirect()` in `page.tsx` or `next.config` redirects. Function-form `setSearchParams(fn, {replace})` → `router.replace` with `URLSearchParams`.
- Usage counts: Link in 58 files (~289 uses), useNavigate 28, useParams 25, useLocation 23, useSearchParams 12, Navigate 5, Outlet 3.

### Data Flow
Browser → `api/client.ts` (relative `/api`, Bearer from localStorage) → dev Vite proxy or prod nginx → FastAPI `:8080`. Panel state flows through AppDataProvider (imperative loads). Other data goes through TanStack Query hooks in `src/hooks/` wrapping `src/api/*.ts`.
Initial HTML: nginx → `@backend_fallback` → backend serves `static/index.html`, injecting OG/Twitter tags for slug, group, term and event routes.
Personalised public endpoints send `private, no-store` / `public, s-maxage=60` with `Vary: Authorization`, so any SSR fetch must be `cache: "no-store"`.

---

## Dependencies

### Imports (What This Depends On)
- react-router-dom 7: routing (to be removed)
- @tanstack/react-query v5: data fetching (kept; per-request client on the server)
- @chakra-ui/react v3 + Emotion: admin UI and theme system (needs a `'use client'` provider and `suppressHydrationWarning`)
- tailwindcss v4 via the Vite plugin: becomes `@tailwindcss/postcss` + `postcss.config.mjs`
- dayjs (pl, utc): kept
- Google Fonts `<link>`: keep it, or switch to `next/font/google` with CSS variables used by `@theme` and the Chakra theme
- Vite: stays as a devDependency for the plugin SDK IIFE build (and Vitest)

### Consumers (What Depends On This)
- **plugins/warehouse, box-size, events, ai-description**: load `http://localhost:5173/assets/plugin-sdk.js` and `plugin-ui.css`
- **Backend system router / public_preview**: serves the frontend's `index.html` with OG injection
- **docker-compose `frontend-build`**: produces `index.html` for the backend volume
- **Backend CORS default**, **`.claude/launch.json`**: port 5173
- **`plugins/server-sdk.ts`**: imported by a frontend test

**Consumer Count**: about 8 external consumers
**Impact Scope**: High. The URL surface, SDK asset path, port and deployment topology are all contracts.

---

## Test Coverage

### Test Files
- 131 `*.test.*` files, about 920 cases, Vitest + jsdom + RTL + jest-dom.
- **Router-coupled: 55 files / ~611 cases.**
  - Hardest: `addRoute.test.tsx`, `messagesRoutes.test.tsx`, `EventPage.test.tsx` (import routes from `router.tsx` / `matchRoutes`); `OrganizerEditor.test.tsx` (28 tests, data router for `useBlocker`, flaky).
  - `createMemoryRouter` (8): OrganizerTermsPage, OwnerItemsPage, OwnerMeetingsPage, PartyProfilePage, PublicOrganizationPage, and others.
  - State, navigation and redirects: LocationPicker (state), organizerMediaBlocks (`useNavigationType`), ItemDetailPage and OrganizerItemRoute (Navigate).
  - `Routes` + `useLocation` probes: AppPage, AuthGuard, PendingActionsHost, PublicLayout, TermPage, useOpenConversation, themeScopeNavigation.
  - `Routes` for params: CategoryFormPage, EventComponents, extension-points, GroupDetailsPage, ItemCreateView, NotificationBell, OnboardingHandoff, PlacesView, ProductCategoryDisplayByCategoriesHook, TermAttendeesPage, ThreadPage.
  - Plain MemoryRouter wrapper only: about 22 files (easy).
  - `vi.mock("react-router-dom")`: auth.test.tsx, AccountMergeAuthHandoff.test.tsx.
- **Router-independent**: about 76 files.
- **Other couplings**: `vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY")` in googleMaps, LocationPicker, PlacesView; `window.location` mocks in 9 files; `renderWithProviders` defined separately in 10 files; `vi.mock` used in 80 files (AuthContext 41, api/groups 20).

### Coverage Assessment
- **Test count**: about 920 cases. The baseline has ~13 known failures and OrganizerEditor is flaky.
- **Gaps**: no end-to-end or browser tests of real navigation, SSR or hydration. No tests of nginx/deploy routing. OG injection is tested only on the backend. Async Server Components cannot be tested with RTL, so test the client views instead.

---

## Coding Patterns

### Naming Conventions
- **Components**: PascalCase files (`*Page.tsx`, `*View.tsx`, `*Sheet.tsx`)
- **Functions/hooks**: `useX` in `src/hooks/`; pure `resolve…View()` in `*ViewState.ts`
- **Files**: `api/<resource>.ts` with snake_case DTOs; tests in flat `src/test/*.test.tsx`

### Architecture Patterns
- **Style**: functional React 19 (`<Context value>`, `<title>` in 5 pages), Polish UI strings, Tailwind class constants; Chakra only in admin (27 files)
- **State Management**: TanStack Query for server data; the large AppDataProvider context for the panel; small module stores (snooze, openSheets)
- **Standards to update after migration**: `standards/testing/frontend-testing.md` (renderWithProviders + MemoryRouter), `standards/frontend/data-fetching.md` (singleton queryClient in main.tsx), `standards/frontend/components.md` (references `pages/term/...` paths), `project/tech-stack.md` (no frontend section), `project/architecture.md` (deployment and port lines; the doc says 5173 but compose maps 5174), `standards/backend/plugin-auth.md`, `plugins/CLAUDE.md`.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | ~340 source files / ~32.9k LOC; 135 test files / ~25k LOC | High |
| Dependencies | router in 91 files; Chakra 27; Query 29 | High |
| Consumers | ~8 external (4 plugins, backend OG/catch-all, compose, CORS, launch.json) | High |
| Test Coverage | ~920 cases, 55 router-coupled files | Good coverage, high rework cost |

### Overall: Complex

The migration is broad rather than algorithmically deep. Most of the work is mechanical (Link/useNavigate/useParams swaps, `'use client'` boundaries, test wrapper replacement). A handful of items need design decisions: auth cookie, OAuth2 method split, OG ownership, `useBlocker`, AppDataProvider persistence and deploy topology.

---

## Key Findings

### Strengths
- Business logic is well separated into pure view-state modules and `api/` + `hooks/` layers that do not depend on the router.
- Theming (orgPalette, OrganizerThemeScope) is pure and SSR-safe.
- Only one env var (`VITE_GOOGLE_MAPS_API_KEY`) is used.
- There is a large test suite to act as the regression net.
- The plugin host is entirely client-side and isolated to `/admin`.

### Concerns
- Auth exists only in localStorage, so the server cannot know who the user is. Any middleware gating requires a new cookie mirror.
- `src/app/` name collision.
- About 15 files read browser APIs at render or module time, which causes hydration mismatches or crashes even in Client Components during SSR prerender.
- `useBlocker`, `useOutletContext`, `location.state` and `location.key` semantics have no direct replacement.
- The deploy topology (backend serving `index.html` + OG) is incompatible with a Node Next server without backend and compose changes.
- The user's proposed tree diverges from current behavior in 8 places (see Recommendations).

### Opportunities
- `generateMetadata` could provide OG for routes the backend does not cover today: product, `/:slug/terms|items|meetings`, UUID profiles.
- Add a real `not-found.tsx` and `error.tsx` (none exist today).
- Route-level code splitting comes automatically.
- A frontend `RESERVED_SLUGS` constant could be kept in sync with the backend.

---

## Impact Assessment

- **Primary changes**: `router.tsx` → `src/app/**` route tree; `main.tsx` + `index.html` → `app/layout.tsx` + `providers.tsx`; `auth/*` (SSR-safe init, cookie mirror, client guards); `api/client.ts`, `api/queryClient.ts`; `src/app/` → renamed folder; `components/layout/*` (`useMatch` → `usePathname`); every file importing `react-router-dom` (91); the ~15 SSR-hazard files; `lib/googleMaps.ts` (`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`); `EditorSheet.tsx`; config (next.config, tsconfig, eslint, postcss, package.json scripts, `next-env.d.ts`).
- **Related changes**: Dockerfile (Node standalone runtime), nginx.conf (fallback → Next), docker-compose (drop `frontend-build`/`frontend_index`, add the Next service, build ARG rename), `.env.example`, backend `public_preview.py`/catch-all and `RESERVED_SLUGS` (outside `src/frontend`), docs and standards listed above.
- **Test updates**: a shared test helper with `next/navigation` + `next/link` mocks (or next-router-mock); rewrite 55 router-coupled files; replace route-table tests (`addRoute`, `messagesRoutes`, `EventPage`) with an abstraction over the new route tree or the path helpers; rename env stubs; the vitest config keeps jsdom.

### Risk Level: Medium-High

There is no production deployment, which reduces operational risk. However, "no regressions" across ~920 tests, an auth model change, the OAuth2 security path and the deploy topology change together push risk above medium.

---

## Recommendations

### Migration strategy (incremental, client-first)
1. **Prep on the Vite app (no behavior change)**: rename `src/app/` → `src/app-data/`; make the ~15 render-time and module-time browser reads lazy or effect-based; move `location.state` flows to a tiny store or sessionStorage; replace `useOutletContext` with a context; centralize `RESERVED_SLUGS` and path helpers. Run the suite after each step, against a fresh baseline.
2. **Introduce a router facade** (`src/navigation/`: `Link`, `useAppNavigate`, `useAppParams`, `useAppPathname`, `useAppSearchParams`, `useHasInAppHistory`, an unsaved-changes guard). First implement it on top of React Router and migrate the 91 files and test helpers to it. Then swap the implementation to `next/navigation`. This splits the riskiest mechanical change into two verifiable steps.
3. **Scaffold Next 16 App Router** in `src/frontend` (`next dev -p 5173`, `output: "standalone"`, rewrites `/api/:path*` → backend, `@tailwindcss/postcss`, Chakra client provider with `suppressHydrationWarning`, `getQueryClient()` browser singleton / per-request server, fonts kept as `<link>` initially).
4. **Port routes 1:1 as thin `page.tsx` → `'use client'` views**, preserving every URL in the inventory above, including legacy redirects.
5. **Auth**: on login, register, applyExternalToken and logout, also write or clear a non-HttpOnly `auth_token` cookie (SameSite=Lax). Keep the client AuthGuard behavior (returnTo, requireAuth=false redirect, homePath). Optional `proxy.ts` gating should only redirect, and must not gate `/`, `/add` or public slug routes.
6. **OAuth2**: in `proxy.ts`, forward `POST /oauth2/*` (and all `/oauth2/token|register|introspect`) to the backend, and let `GET /oauth2/authorize` render the Next page. Add a test that covers this.
7. **Deploy/dev** (MVP, no prod): update Dockerfile, nginx and compose to run Next standalone. Decide OG ownership (recommended: Next `generateMetadata` reusing the public endpoints with `no-store`, then retire backend injection in a follow-up task with its 11 tests).
8. **Plugin SDK**: keep `vite.sdk.config.ts` and output straight to `public/assets/plugin-sdk.js` via a `prebuild`/`predev` step. Verify the 4 plugins load it from `:5173`.

### Corrections to the user's proposed target tree
1. Add a top-level **`/product/[id]`** (main item URL linked from MyItemsView, ThreadPage, TakeSuccessSheet, ItemCreateView and pendingActions).
2. Keep **legacy redirects**: `/product/:id/edit` and `/:slug/product/:id/edit` → `?edit=1`, and `/:slug/product` → `/:slug`.
3. **Anonymous `/` → LandingPage and anonymous `/add` → PublicAddView** must stay public, so middleware must not protect them.
4. `/terms/[termId]`, `/groups/[groupId]`, `/messages`, `/messages/[id]` are authenticated, but have **no AppDataProvider** and use **PublicLayout chrome**. The thread page needs h-dvh with no BottomNav.
5. **AppShell (Sidebar/Header/MobileDrawer) is admin-only** with PluginProvider. The panel uses the PublicLayout chrome. Do not split public and panel into sibling layouts that remount the top bar.
6. The **admin gate** must admit ADMIN **and** PLUGIN_MANAGEMENT (or stay auth-only as today).
7. `plugins/:pluginId/*` → **`[[...path]]`** (optional catch-all, since an empty splat matches today).
8. **PluginProvider stays in `/admin/layout`**, not at the root (otherwise anonymous pages would fetch plugins).
9. A `[slug]/layout.tsx` must **not fetch the owner and call `notFound()`**. That would break `krag` and UUID-party routes; TermPage and EventPage resolve their own owner.
10. If `/` → `/home` is rewritten: `viewFromPath("home")` returns null, `viewPath("home")` is `/`, and BottomNav links `/`. Check `usePathname` under the rewrite, the direct `/home` reachability, and add `home` to the backend reserved slugs. **Simpler alternative**: a single `app/page.tsx` that renders LandingPage or HomeView on the client.

### Testing strategy
- Capture a fresh baseline (`vitest run` pass/fail list) before step 1, and compare after each step. "No regression" means no new failures relative to that baseline.
- Keep route-coverage tests by asserting against a generated list of `app/**/page.tsx` paths (or the path helpers) instead of `router.tsx`.
- Add a small manual or Playwright smoke script for: anonymous `/`, `/add`, `/login` → panel, `/krag/group/:g/term/:t`, `/:slug`, UUID party, `/product/:id`, `/messages/:id` layout, admin with PLUGIN_MANAGEMENT, the OAuth2 authorize round trip, and a plugin iframe in admin.

---

## Next Steps

Invoke the gap analyzer with this report and `analysis/user-target-structure.md`. Then confirm the open questions with the user (auth cookie approach, OG ownership, Next version, baseline commit and the duplicate task folder) before writing the migration specification.
