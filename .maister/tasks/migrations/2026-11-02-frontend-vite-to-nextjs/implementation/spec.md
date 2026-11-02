# Specification: Frontend Migration — Vite 8 + React Router 7 SPA → Next.js 16.4 App Router

## TL;DR
- `src/frontend` moves to Next.js 16.4.x App Router (Turbopack, `output: "standalone"`, `next dev -p 5173`) in 13 commit checkpoints on `main`. All behaviour-changing refactors land first on Vite, where the existing ~920-case suite guards them: the full `features/` reorganisation (D7), SSR-safety fixes, a navigation facade in `src/routing/`, and the auth cookie.
- The Next swap only re-implements a few seams: facade, test helper, entry points. `proxy.ts` rewrites `/` → `/home` for cookie holders (D6), redirects direct `/home` visits to `/`, gates private prefixes and sends `POST /oauth2/authorize` to the backend.
- Public pages get server `generateMetadata` and the organizer palette, built from anonymous fetches. Backend OG injection and the SPA catch-all are removed. The backend reads the `auth_token` cookie on GET/HEAD only, sends `Vary: Authorization, Cookie`, and reserves `home`.
- No regression means: Vitest pass-set ⊇ the A0 baseline, pytest/ruff unchanged, mypy ≤ 15, `next build` + typecheck clean, and a Playwright MCP smoke checklist.

## Key Decisions
- D1 Next 16.4.x — active line; `proxy.ts` and async request APIs; React 19.2 is already in place.
- D2 Client-only mount for `(panel)`, `(member)`, `(standalone)`, `admin` (a `ClientOnly` gate in their layouts). The SSR shell is limited to `(site)` chrome, `/`, `/login`, `/product/*` and slug pages — no hydration risk on localStorage-heavy code.
- D3 The frontend writes a JS-readable `auth_token` cookie in lockstep with localStorage. The backend reads it on GET/HEAD only, so there is no CSRF surface. Bearer is kept for mutations and plugins.
- D4 Custom `useNavigationGuard` (links, programmatic navigation, `beforeunload`, best-effort back/forward). It returns a `useBlocker`-shaped object so `EditorSheet` barely changes.
- D5 The three OG formatters are ported to TS. Expected strings come from `tests/test_public_preview.py` before that file is deleted.
- D6 (user override) `/` → `/home` rewrite in `proxy.ts` when the `auth_token` cookie is present. A direct `/home` request is redirected to `/`, so `/home` is never a visible URL. `useAppPathname()` normalises `/home` → `/`, which keeps `viewFromPath`/`viewPath("home") === "/"`/BottomNav untouched. On a stale cookie, the panel layout clears the session and renders LandingPage in place, as today's `AppRoute` does. `home` is added to backend `RESERVED_SLUGS`, with a parity test.
- D7 (user override) Full `features/` reorganisation, done as step A1 on Vite: file moves plus import-specifier rewrites only. The exact mapping is in §4. **No file is split or merged.** Requested sub-structure that would need splitting file contents (`plugins/host/handlers/*` + `permissions.ts`, one file per owner-page layout, `theme/palettes.ts` merging `orgPalette`, `plugins/server.ts`) is not created. Files move to the closest folder instead.
- D8 Proxy cookie-presence gate on `PROTECTED_PREFIXES` → `/login?returnTo=`. The client `AuthGuard` stays authoritative.
- D9 In-repo `next/navigation` + `next/link` mocks, wired through Vitest `resolve.alias` (immune to `vi.resetAllMocks()`) behind `renderWithRoute`.
- D10 nginx stays in front. D11 `/:slug/group/:groupId` → 404. D12 Google Fonts `<link>` is kept.
- Panel route parity: `(panel)/layout.tsx` renders today's `AppRoute` frame (gate + `AppDataProvider` + `AppPage`) and does not render `children`. Each panel `page.tsx` is a stub that returns `null`, so `AppPage` and its local state persist across sections exactly as with today's shared route element.
- Dynamic folder names keep today's param keys (`[organizationSlug]`, not `[slug]`), so `useAppParams()` call sites are unchanged. The facade maps `[[...path]]` to RR's `params["*"]`.
- The admin layout gate stays **AuthGuard-only** (parity). The gap analysis proposed ADMIN||PLUGIN_MANAGEMENT, and the user tree proposed "rola admin". Either would lock out EDIT-only users of `/admin/products` (`ProductListPage` checks `EDIT`; the seeded `editor` uses admin product creation).
- The navigation facade lives in `src/routing/` (the user's folder), not a new `src/navigation/`. ESLint `no-restricted-imports` bans `react-router-dom` (after A3) and `next/navigation`/`next/link` (after B3) outside `src/routing/`.

## Open Questions / Risks
- `usePathname()` under a proxy rewrite may report `/` or `/home`, depending on the Next internals. Normalisation in `useAppPathname()` makes both safe. The B4 smoke must confirm that no hydration warning shows on `/`.
- Client Router Cache after login and logout: the root layout reads `cookies()`, so every route is dynamic (`staleTimes.dynamic = 0`). `AuthProvider` also calls the facade `refresh()` on every token change, so `/` re-resolves the rewrite.
- Legacy sessions (token in localStorage, no cookie) first get the anonymous landing. The boot reconciliation writes the cookie, then `refresh()` swaps in the home view (one-time flash).
- Chakra/Emotion global CSS on SSR'd public pages may flash unstyled. If it shows in the smoke, add an Emotion `useServerInsertedHTML` registry in `providers.tsx` (inside phase C).
- `POST /oauth2/authorize` through the proxy's external rewrite: forwarded `Host`/`X-Forwarded-*` must still let the backend build its redirect. This is verified in the smoke round trip.
- OG parity for private circles: the anonymous `GET /api/groups/public/{id}?term_id=` may return less than the backend's direct service call did, so they fall back to the default metadata. Accepted, and documented in the work-log.
- An existing dev organization with slug `home` would be shadowed. A5 runs a read-only count query and reports it. Renaming is manual, if any is needed.
- `eslint-config-next` may flag existing code. Errors must not exceed the baseline. New-rule errors that would demand behaviour changes are disabled in config, with a one-line reason.
- Pre-existing failures (~13) and the flaky OrganizerEditor: the comparison is by test id against the A0 list. A flaky test that fails must pass on one re-run.

## Goal
Run the existing frontend on Next.js 16.4 App Router with the user's target structure, without user-visible regressions beyond the listed deltas, while keeping the plugin contract, the URLs, the Polish copy and the data-fetching standards.

## User Stories
- As a visitor, I want every existing URL (landing, login, product, organizer, event and term pages) to work unchanged, so that links I received still open.
- As a logged-in user, I want `/` to show my home panel immediately (no landing flash), so that the app feels the same as before.
- As a link-unfurling bot, I want OG/Twitter tags in the first HTML response of organization, event and term pages, so that shared links show a title, a description and an image.
- As an organizer editing my page, I want to be warned before leaving with unsaved changes (link, back button, tab close), so that I do not lose edits.
- As a plugin author, I want `/assets/plugin-sdk.js` and `/assets/plugin-ui.css` on port 5173 and the postMessage protocol unchanged, so that my plugin keeps working.
- As a developer, I want feature code grouped under `src/features/<domain>` and routing isolated behind `src/routing/`, so that the codebase follows the agreed structure.

## Core Requirements

Requirement ids are referenced by the plan and in verification. Priority: **M** = must, **S** = should.

| Id | Requirement | Phase | Pri |
|---|---|---|---|
| R1 | Commit the user's pre-existing WIP alone as checkpoint C0 (`wip: owner/meetings pages`), before any migration change | C0 | M |
| R2 | Record baselines: Vitest JSON (ids + status + count), `tsc -b`, `eslint .` error count, backend pytest pass/fail list, ruff, mypy (15) under `verification/baseline/` | A0 | M |
| R3 | Full `features/` reorganisation per §4: `git mv` plus specifier rewrite only. `src/app/` and `src/pages/` must not exist afterwards | A1 | M |
| R4 | Fix every render- and module-time browser access listed in §5.2. `queryClient` → `getQueryClient()`. Layout thumbnails become string URLs from `public/assets/layouts/` | A2 | M |
| R5 | Navigation facade `src/routing/navigation.tsx` on React Router. Migrate all 91 source files and 55 test files (via `renderWithRoute`). Move path helpers into `routing/paths.ts`. Add `normalizeAppPath`, `matchPath`, `PROTECTED_PREFIXES` | A3 | M |
| R6 | `auth/session.ts` keeps the localStorage token and `auth_token` cookie in lockstep at all write points. Boot reconciliation. SSR-safe `AuthProvider(initialToken)` | A4 | M |
| R7 | Backend: `_extract_token` reads the `auth_token` cookie on GET/HEAD only (after header and `_token`). `Vary: Authorization, Cookie`. `home` in `RESERVED_SLUGS` + docstring → `src/app` | A5 | M |
| R8 | Next scaffold: deps, `next.config.ts` (standalone, dev rewrites), `postcss.config.mjs`, single `tsconfig.json`, `eslint-config-next`, root `layout.tsx`/`providers.tsx`/`not-found.tsx`/`globals.css`, fonts `<link>`, env rename to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | B1 | M |
| R9 | Route tree per §6 (61 `page.tsx`): thin pages, server `redirect()` for legacy URLs, layouts per §6.2. Route-manifest test. `routing/reservedSlugs.ts` + parity test | B2 | M |
| R10 | Swap the facade to `next/navigation`/`next/link`; `renderWithRoute` to the navigation mock. Delete `router.tsx`, `main.tsx`, `index.html`, `vite-env.d.ts`, `vite.config.ts`, the `react-router-dom` dep and the react-refresh preset. Scripts move to `next` | B3 | M |
| R11 | `src/proxy.ts` per §8 (D6 rewrite + `/home` redirect, OAuth2 POST rewrite, D8 gate) with unit tests. Matcher excludes `/api`, `/_next`, `/assets`, `/.well-known`, files | B4 | M |
| R12 | `api/server.ts` (server-only, anonymous, `no-store`). `generateMetadata` for org, event and term pages, plus a root default. Initial palette via `ServerThemeProvider`. Ported OG parity tests | C1 | M |
| R13 | Backend: remove `public_preview.py`, the preview routes, `spa_fallback`, `STATIC_DIR` usage and `test_public_preview.py`. Unknown page paths → JSON 404. Re-check `AUTHORIZATION_MATRIX` | C2 | M |
| R14 | Deploy: Dockerfile → Next standalone runtime. nginx routes per §10. Compose: drop `frontend-build`/`frontend_index`/backend static mount, add `web`. `.env.example`, root scripts, launch.json | D | M |
| R15 | Docs/standards updated (§11). Playwright MCP smoke checklist (§12) passes and is recorded in `verification/` | D | M |
| R16 | Plugin SDK: separate Vite IIFE build into `public/assets/plugin-sdk.js` via `predev`/`prebuild`. Delete the stale `src/resources/static/assets/plugin-sdk.js` | B3 | M |
| R17 | `useNavigationGuard` replaces `useBlocker` in `EditorSheet` with D4 semantics | A3 | M |
| R18 | `location.state` flows (EventCreate→EventPage toast, ItemCreate→ItemDetail, PlaceCreate→LocationPicker) and `location.key` checks (4 sites) go through `useNavigationState`/`useHasInAppHistory` | A3 | M |
| R19 | `useOutletContext` (ItemDetailPage) → `OrganizerItemContext` provided by the org product layout | A3/B2 | M |
| R20 | Search-param-only updates keep the scroll position (`scroll: false`) | A3/B3 | M |
| R21 | ESLint `no-restricted-imports` keeps router imports inside `src/routing/` | A3/B3 | S |

## 1. Phases and Checkpoints

Each checkpoint is one commit on `main`, made by the implementer after its gate passes. The rollback procedure is in `analysis/rollback-plan.md`. A-phases run on Vite. From B3 on, the app runs on Next. B1–B2 add Next files while Vite stays the runner.

| Ckpt | Phase | Content | Gate |
|---|---|---|---|
| C0 | WIP | User's uncommitted owner/meetings/backend changes only (no `.maister/tasks/migrations/*`) | none (user's code as is) |
| C1 | A0 | Task folder + `verification/baseline/*` | baselines recorded |
| C2 | A1 | §4 moves + specifier rewrites | Vitest ⊇ baseline, same case count; `tsc -b`, eslint ≤ baseline; `grep` finds no `src/pages`/`src/app/` specifiers |
| C3 | A2 | SSR-safety, `getQueryClient()`, thumbnails to `public/` | as C2 + new SSR-safety tests |
| C4 | A3 | Facade on RR, `routing/paths.ts`, `renderWithRoute`, test migration, guard, state/history | as C2 (case count ≥ baseline) + facade tests; no `react-router-dom` import outside `src/routing/` and `src/test/renderWithRoute.tsx` |
| C5 | A4 | `auth/session.ts` + call sites + `AuthProvider(initialToken)` | Vitest ⊇ baseline + session tests |
| C6 | A5 | Backend cookie read, `Vary`, `home` slug, test updates (backend-only commit) | pytest: no new failures + new tests; ruff clean; mypy ≤ 15 |
| C7 | B1 | Next scaffold (no routes beyond root layout + not-found) | `next build` passes; Vite suite still ⊇ baseline |
| C8 | B2 | Route tree, manifest + reservedSlugs tests | `next build`; manifest + parity tests green |
| C9 | B3 | Facade/test-helper swap, Vite entry deleted, scripts, SDK pre-steps | Vitest ⊇ baseline (documented replacements only); `tsc --noEmit`; `next build`; `next dev -p 5173` serves `/` |
| C10 | B4 | `proxy.ts` + tests | proxy tests; manual `/`, `/home`, gated prefix checks |
| C11 | C1 | Server metadata, palette, OG parity tests (frontend-only) | Vitest parity tests; `curl -A facebookexternalhit` shows OG on 3 page kinds |
| C12 | C2 | Backend OG/catch-all removal (backend-only) | pytest: no new failures (−11 deleted tests documented); ruff; mypy ≤ 15 |
| C13 | D | Deploy, docs, smoke report | `docker compose build`; smoke checklist §12 all pass |

## 2. Target Tree (final)

```
src/frontend/
├─ next.config.ts  postcss.config.mjs  vite.sdk.config.ts  vitest.config.ts  tsconfig.json  eslint.config.js
├─ public/ favicon.svg icons.svg assets/{plugin-sdk.js (built), plugin-ui.css, layouts/*.svg}
└─ src/
   ├─ proxy.ts
   ├─ app/                      route files only (§6)
   ├─ features/                 §4: account admin auth events family groups items landing meetings
   │                            messages owner-page panel places terms
   ├─ components/{layout/ (AppShell, Header, Sidebar, MobileDrawer, BottomNav, PublicLayout, pending/), shared/}
   ├─ plugins/{host/, slots/, extensionPoints.ts, resolveExtensionPoints.ts}
   ├─ plugin-sdk/               unchanged
   ├─ api/{client.ts, server.ts (new, C1), queryClient.ts, …}
   ├─ auth/{AuthContext.tsx, AuthGuard.tsx, authPaths.ts, homePath.ts, session.ts (new, A4)}
   ├─ theme/{system.ts, palettes.ts, orgPalette.ts, OrganizerThemeScope.tsx, ServerThemeProvider.tsx (new, C1)}
   ├─ routing/{navigation.tsx, NavigationTracker.tsx, navigationGuard.ts, navigationState.ts, ClientOnly.tsx,
   │           paths.ts, messagesPaths.ts, reservedSlugs.ts}
   ├─ hooks/  lib/ (googleMaps.ts, publicMetadata.ts (new, C1))  utils/
   └─ test/                     flat, unchanged location (+ renderWithRoute.tsx, navigationMock.ts, nextLinkMock.tsx)
```

## 3. Preserve List and Accepted Deltas
- **Preserved**: all URLs. The plugin contract (`/assets/plugin-sdk.js`, `/assets/plugin-ui.css` on :5173, the `aj.plugin.` protocol, origin and iframe-registry checks, `getToken` returning the JWT). Polish UI text. Data-fetching standards (hooks in `src/hooks/` wrapping `src/api/*.ts`, one browser QueryClient, the same retry policy, error passthrough).
- **Accepted deltas**:
  1. A real `not-found.tsx` for unmatched URLs.
  2. `/:slug/group/:groupId` → 404 (D11).
  3. `/` is internally rewritten to `/home` for cookie holders, while the visible URL stays `/`.
  4. `/home` typed directly → 307 to `/`.
  5. Scroll-to-top on push navigations.
  6. `location.state` is lost on hard reload.
  7. The proxy redirects to login before JS loads on gated prefixes.
  8. The editor guard additionally covers tab close.

## 4. D7 Mapping Table (A1 — moves only)

Rule: `git mv` each file. Then rewrite every module specifier that resolves to a moved file: static `import`/`export … from`, dynamic `import()`, and the string arguments of `vi.mock`, `vi.doMock`, `vi.importActual`, `vi.importMock`. Use a one-off codemod in the scratchpad (resolve each relative specifier to an absolute path, map it through this table, re-relativise). The codemod is not committed. Literal path strings in tests (`themeDefects.test.tsx` source list) and comments that name file paths are updated by hand. File basenames and exported symbols do not change, except where the table renames a file.

| Old path (`src/…`) | New path (`src/…`) |
|---|---|
| `app/AppDataContext.tsx`, `app/appDataStore.ts`, `app/AppModals.tsx` | `features/panel/` (same names) |
| `pages/home/AppPage.tsx`, `AppSkeleton.tsx`, `HomeView.tsx` | `features/panel/` |
| `pages/add/AddView.tsx` | `features/add/AddView.tsx` (user decision at Phase 3 gate: separate `features/add`) |
| `pages/search/SearchView.tsx` | `features/search/SearchView.tsx` (user decision at Phase 3 gate: separate `features/search`) |
| `pages/home/LandingPage.tsx` | `features/landing/LandingPage.tsx` |
| `pages/account/AccountView.tsx`, `SettingsView.tsx` | `features/account/` |
| `pages/profile/ProfileView.tsx`, `useProfileForm.ts` | `features/account/` |
| `pages/admin/*` (12 files) | `features/admin/` |
| `components/moderation/DeletedGroupRow.tsx`, `PhotoModerationCard.tsx` | `features/admin/moderation/` |
| `pages/auth/LoginPage.tsx`, `OAuth2AuthorizePage.tsx`, `OnboardingPage.tsx`, `RegisterForm.tsx` | `features/auth/` |
| `components/layout/AuthLayout.tsx`, `authStyles.ts`, `SocialAuthButtons.tsx` | `features/auth/` |
| `components/onboarding/OnboardingWizard.tsx` | `features/auth/onboarding/OnboardingWizard.tsx` |
| `components/onboarding/steps/organizerSteps.tsx` | `features/auth/onboarding/steps/organizerSteps.tsx` |
| `pages/events/*` (`EventEditView`, `EventPage`, `eventViewState`), `pages/events/components/*` (7), `pages/events/hooks/useEventSignUp.ts` | `features/events/` (subfolders kept) |
| `pages/add/EventCreateView.tsx`, `EventForm.tsx`, `eventDraft.ts` | `features/events/` |
| `pages/family/*` (8) | `features/family/` |
| `pages/groups/*` (5) | `features/groups/` |
| `components/panel/GroupFormFields.tsx`, `JoinCodeCard.tsx` | `features/groups/` |
| `pages/items/*` (`InventoryLocationCard`, `MyItemsView`, `SwapAcceptSuccessSheet`, `VisibilityToggle`) | `features/items/` |
| `pages/add/ItemCreateView.tsx` | `features/items/` |
| `pages/add/HuntingCreateView.tsx` | `features/add/HuntingCreateView.tsx` |
| `pages/search/WantedView.tsx` | `features/search/WantedView.tsx` |
| `pages/product/*` (20) | `features/items/product/` |
| `pages/meetings/*` (`MeetingsView`, `TermAttendeesPage`, `TermCards`) | `features/meetings/` |
| `pages/messages/*` (7) | `features/messages/` |
| `pages/places/*` (3) | `features/places/` |
| `pages/term/*` (4) + `components/`, `hooks/`, `modals/`, `views/` | `features/terms/` (subfolders kept) |
| `pages/add/AddTermView.tsx` | `features/terms/AddTermView.tsx` |
| `components/panel/TermEditForm.tsx`, `FirstTermStepperOrganizer.tsx` | `features/terms/` |
| `pages/organizer/{LayoutRenderer, OrganizationPage, organizerHelpers, OrganizerPageSkeleton, OrganizerTermsPage, PageFrame, PublicOrganizationPage}` | `features/owner-page/` |
| `pages/organizer/blocks/*` (26) | `features/owner-page/blocks/` |
| `pages/organizer/editor/*` (9) | `features/owner-page/editor/` |
| `pages/organizer/layouts/registry.ts`, `types.ts` | `features/owner-page/layouts/` |
| `pages/owner/{OwnerItemsPage, OwnerMeetingsPage, OwnerPage, PartyProfilePage}` | `features/owner-page/` |
| `pages/person/` (empty) | deleted |
| `components/pending/*` (4) | `components/layout/pending/` |
| `plugins/PluginContext.tsx` | `plugins/host/PluginHost.tsx` (file rename only; exports unchanged) |
| `plugins/PluginMessageHandler.ts`, `usePluginMessageHandler.ts`, `iframeRegistry.ts` | `plugins/host/` |
| `plugins/PluginFrame.tsx`, `PluginFilterBar.tsx` | `plugins/slots/` |
| `theme/index.ts` | `theme/system.ts` |
| `theme/palettePresets.ts` | `theme/palettes.ts` (name matches backend `palettes.py`) |
| `utils/messagesPaths.ts` | `routing/messagesPaths.ts` |
| `assets/hero.png`, `react.svg`, `vite.svg` | deleted (verified unreferenced) |
| `components/layout/{AppShell, Header, Sidebar, MobileDrawer, BottomNav, PublicLayout}`, `components/shared/*`, `plugins/{extensionPoints, resolveExtensionPoints}.ts`, `theme/{orgPalette.ts, OrganizerThemeScope.tsx}`, `auth/*`, `api/*`, `hooks/*`, `lib/*`, `utils/*` (rest), `plugin-sdk/*`, `test/*` | unchanged |

`assets/layouts/*.svg` move in A2 (not A1), because the change from imports to strings is a code change (§5.2).

## 5. Phase A Details (on Vite)

### 5.1 A0 Baseline
- `npx vitest run --reporter=json --outputFile=verification/baseline/vitest-A0.json`. Derive a sorted `file › full name → status` list (`vitest-A0.txt`) and the case count.
- `npx tsc -b` (exit code + error count), `npx eslint .` (error/warning counts).
- From `src/backend`: `uv run python -m pytest -q -rA` → pass/fail list, `uv run python -m ruff check .`, `uv run python -m mypy app` (expect 15).
- A comparison script lives in the scratchpad (not committed). It reports tests passing at baseline that no longer pass, and case-count changes.

### 5.2 A2 SSR-Safety
- **Module time**: `AuthContext.tsx:70 loadStoredAuth()`. It is replaced in A4. In A2 it becomes lazy (`useState(() => …)` with a `typeof window` guard).
- **Render time**: fix with `useSyncExternalStore` (server snapshot = the neutral value) or by moving the read into an effect or handler, choosing whichever keeps the current first-paint behaviour in jsdom. Sites: `OAuth2AuthorizePage` (localStorage in JSX), `HomeView` (`useState` initializer), `PendingActionsHost` → `snoozeStore`, `useEventSignUp` → `readValidGuestProfile`, `useGuestMerge`, `useJoinCodeLink` (sessionStorage + `location.hash`), `OrganizationPage`, `EventPage`, `ItemStatusCard`, `TakeSuccessSheet`, `SwapAcceptSuccessSheet` (`window.location.origin`), and `useState(() => document.activeElement)` in `appComponents`, `ConfirmDeleteDialog`, `ModalSheet`, `PhotoViewer`. (Line numbers are in `analysis/current-state-analysis.md`.)
- **Module singletons**: `api/queryClient.ts` exports `getQueryClient()`: a new client per server render, a singleton in the browser, the same `defaultOptions`. `main.tsx` uses it. Audit `snoozeStore`, `openSheets`, `organizerSteps` `createdCircle`, `googleMaps` `placesPromise` and `iframeRegistry` so they are never written during render. Document the outcome in the work-log.
- `api/client.ts` 401 handler: `typeof window` guard.
- Layout thumbnails: move `src/assets/layouts/*.svg` → `public/assets/layouts/`. `features/owner-page/layouts/registry.ts` uses string constants `/assets/layouts/<key>.svg`. Vite and Next both serve `public/` at the root; Next static imports would yield objects, not strings.

### 5.3 A3 Navigation Facade and Routing (on React Router)

**`routing/navigation.tsx`** is the only module importing the router. Its API mirrors the RR subset in use:

| Export | Semantics |
|---|---|
| `Link` (`to`, `replace?`, `state?`, `scroll?`, anchor props) | RR: `<Link>`. Next: `next/link` `href`. `state` written to the navigation-state store on click |
| `Navigate` (`to`, `replace?`) | Client redirect in an effect (used by `AuthGuard`) |
| `useAppNavigate()` → `(to \| -1, { replace?, state?, scroll? })` | Consults the guard registry first. `-1` → back |
| `useAppParams<T>()` | Param keys as today. Catch-all array → `"*"` joined string |
| `useAppSearchParams()` → `[params, set(next \| fn, { replace? })]` | Builds `URLSearchParams`. Next: `router.replace/push(url, { scroll: false })` |
| `useAppPathname()` | `normalizeAppPath(pathname)`: `/home` → `/`, otherwise unchanged |
| `useAppSearch()` | Raw `?query` string (for `returnTo`) |
| `useHasInAppHistory()` | Replaces `location.key !== "default"` (ThreadPage, OwnerItemsPage, PartyProfilePage, ItemBackButton). `NavigationTracker` counts client navigations since document load (decremented on popstate) |
| `useNavigationState<T>()` | Reads the state stored for the current URL once and then clears it (3 flows in R18) |
| `useNavigationGuard(shouldBlock: (next: { pathname }) => boolean)` → `{ state: "unblocked" \| "blocked", proceed(), reset() }` | D4: capture-phase click interception of same-origin `<a>` with a different pathname; facade `navigate`; `beforeunload` while blocking; popstate best-effort (re-push the current URL, set blocked; `proceed()` replays back/target) |
| `useRouterRefresh()` | RR: no-op. Next: `router.refresh()` |

- **`routing/paths.ts`**: move `View`, `viewPath`, `viewFromPath`, `ID_PATH_VIEWS`, `isPartyId`, `eventPath`, `ownerPagePath` and the `*EditPath` helpers out of `utils/appHelpers.ts` without changing their logic, and rewrite the imports. Add `normalizeAppPath`, `matchPath(pattern, pathname)` (replaces `useMatch` in `PublicLayout`), and `PROTECTED_PREFIXES` (§8). `viewFromPath` is unchanged: it always receives normalised paths.
- `useOutletContext` → `OrganizerItemContext` (a React context next to `OrganizerItemLayout`). In A3 it is provided by `OrganizerItemLayout` around `<Outlet/>`; in B2 by the layout.
- **`test/renderWithRoute.tsx`**: `renderWithRoute(ui, { url, pattern?, routes?: Record<pattern, ReactNode> })` plus `getTestLocation()` → `{ pathname, search }` and `getTestRouter()` (recorded push/replace/back). A3 implementation: MemoryRouter + Routes + a location probe. All 55 router-coupled test files are migrated to it and to `getTestLocation()` instead of probe routes. Test names are unchanged. The 10 per-file `renderWithProviders` helpers delegate to it.
- `EditorSheet` uses `useNavigationGuard` with the same pathname-change predicate. `OrganizerEditor.test.tsx` and `organizerMediaBlocks` (`useNavigationType`) are adapted to the facade.
- ESLint: `no-restricted-imports` for `react-router-dom` outside `src/routing/**` and `src/test/renderWithRoute.tsx`.

### 5.4 A4 Session Cookie (frontend)
- `auth/session.ts`: `readStoredToken()`, `setSession(jwt)`, `clearSession()`. The cookie is `auth_token=<jwt>; Path=/; SameSite=Lax; Max-Age=<exp − now>`, plus `; Secure` on https. It is not HttpOnly.
- Every write point uses it: `login`, `register`, `applyExternalToken`, `logout` (then the hard redirect to `/login`, as today), the `api/client.ts` 401 handler, and `AuthGuard`'s stale-token path.
- `AuthProvider({ initialToken })`: no module-time read. Initial state comes from `initialToken` (from the server cookie in Next; in Vite `main.tsx` reads it from localStorage). A mount effect reconciles:
  - the valid localStorage token wins;
  - otherwise the valid cookie token is written to localStorage;
  - otherwise both are cleared;
  - the cookie is always rewritten to match.
- Any token change calls `useRouterRefresh()`.

### 5.5 A5 Backend (separate commit)
- `app/core/_auth/token.py::_extract_token`: after the header, `_token` query and `_token` form, `request.cookies.get("auth_token")` when `request.method in {"GET", "HEAD"}`. Docstring updated. `app/oauth2/router.py`'s own `_token` form parsing for `POST /oauth2/authorize` is left untouched.
- `app/core/cache_headers.py`: `Vary: Authorization, Cookie`. Update `tests/test_reserved_listings.py:411,446` and the other exact-header assertions found by grep.
- Verify that no GET route in `AUTHORIZATION_MATRIX` mutates state, and record it in the work-log. This is the CSRF-freedom argument.
- `app/organizations/slugs.py`: add `"home"`. The docstring says `src/app` (Next route tree) and `routing/reservedSlugs.ts` instead of `router.tsx`.
- Read-only dev-DB check: count organizations with slug `home`, and report it.

## 6. Route Tree (B2)

### 6.1 Files
All `[organizationSlug]` segments keep today's param name. A page means a thin `page.tsx`; "stub" means it returns `null` (the panel layout renders `AppPage`).

```
app/layout.tsx  providers.tsx  not-found.tsx  globals.css
app/(site)/layout.tsx                         PublicLayout chrome (SSR)
app/(site)/page.tsx                           "/" → LandingPage (anonymous; cookie holders never reach it)
app/(site)/login/page.tsx                     LoginPage
app/(site)/product/[id]/page.tsx              ItemDetailPage
app/(site)/product/[id]/edit/page.tsx         redirect(`/product/${id}?edit=1`)
app/(site)/(panel)/layout.tsx                 ClientOnly + PanelGate + AppDataProvider + AppPage (children ignored)
app/(site)/(panel)/home/page.tsx              stub (rewrite target of "/")
app/(site)/(panel)/{meetings,groups,groups/new,items,profile,settings,places,places/new,family,family/new,
   family/edit,family/members/new,account,search,wanted,add,add/product,add/term,add/event,add/hunting}/page.tsx   stubs
app/(site)/(panel)/{groups/[groupId]/edit, places/[locationId]/edit, family/members/[familyMembershipId]/edit,
   events/[eventId]/edit, terms/[termId]/edit}/page.tsx                                                           stubs
app/(site)/(member)/layout.tsx                ClientOnly + AuthGuard
app/(site)/(member)/terms/[termId]/page.tsx   TermAttendeesPage
app/(site)/(member)/groups/[groupId]/page.tsx GroupDetailsPage
app/(site)/(member)/messages/page.tsx         InboxPage
app/(site)/(member)/messages/[conversationId]/page.tsx  ThreadPage
app/(site)/[organizationSlug]/(owner)/layout.tsx         server: ServerThemeProvider (best effort, never notFound)
app/(site)/[organizationSlug]/(owner)/page.tsx           OwnerPage + generateMetadata
app/(site)/[organizationSlug]/(owner)/{items,meetings,terms}/page.tsx   OwnerItemsPage / OwnerMeetingsPage / OrganizerTermsPage
app/(site)/[organizationSlug]/(owner)/product/page.tsx  redirect(`/${organizationSlug}`)
app/(site)/[organizationSlug]/(owner)/product/[id]/layout.tsx   OrganizerItemLayout (children + OrganizerItemContext)
app/(site)/[organizationSlug]/(owner)/product/[id]/page.tsx     ItemDetailBody (index)
app/(site)/[organizationSlug]/(owner)/product/[id]/edit/page.tsx  redirect(`/${organizationSlug}/product/${id}?edit=1`)
app/(site)/[organizationSlug]/event/[eventId]/page.tsx   EventPage + generateMetadata + own theme
app/(site)/[organizationSlug]/group/[groupId]/term/[termId]/page.tsx  TermPage + generateMetadata + own theme
app/(standalone)/layout.tsx                   ClientOnly + AuthGuard (no chrome)
app/(standalone)/{onboarding, organization, oauth2/authorize}/page.tsx
app/admin/layout.tsx                          ClientOnly + AuthGuard + PluginProvider + AppShell
app/admin/page.tsx                            redirect("/admin/products")
app/admin/{products, products/new, products/[id], products/[id]/edit, categories, categories/new,
   categories/[id]/edit, groups, terms, photos, plugins, plugins/new, plugins/[pluginId]/detail,
   plugins/[pluginId]/edit, plugins/[pluginId]/[[...path]]}/page.tsx
```
That makes 61 `page.tsx` files: 4 site, 26 panel, 4 member, 9 slug, 3 standalone, 15 admin.

### 6.2 Layout Behaviour
- **Root layout**: `<html lang="pl" suppressHydrationWarning>`. `<head>` holds the Google Fonts preconnect and `<link>`. Default `metadata` = title "Krąg grupy" and icon `/favicon.svg`. It reads `(await cookies()).get("auth_token")` → `<Providers initialToken>`. `<body><div id="root">` (the `#root` CSS is unchanged). It imports `globals.css`, which is today's `index.css` with the `@layer` order line first.
- **`providers.tsx`** (`'use client'`): `QueryClientProvider(getQueryClient())` → `ChakraProvider(system)` → `AuthProvider(initialToken)` → `NavigationTracker`. This is the same order as `main.tsx`.
- **`(panel)/layout`**: today's `AppRoute` logic, applied to the normalised pathname.
  - Anonymous at `/` (only reachable here through a stale-cookie rewrite of `/home`): `clearSession()` + LandingPage.
  - Anonymous at `/add`: PhoneFrame + PublicAddView.
  - Otherwise: AuthGuard → AppDataProvider → AppPage.
  - It persists across all panel sections and remounts when leaving to `(member)`, product or slug pages, which matches today.
- **`(site)` chrome**: persists across site ↔ panel ↔ member ↔ slug. `(standalone)` and `admin` remount it, as today.
- **ClientOnly** (`routing/ClientOnly.tsx`): renders `null` until mounted (a `useSyncExternalStore` mounted flag).
- **Server redirects** use `redirect()` with awaited `params`. No `next.config` redirects, because they would also hit `/api`.

### 6.3 Route-Manifest and Reserved-Slug Tests
- `test/routeManifest.test.ts` (node `fs`, no `import.meta.glob`): walks `src/app/**/page.tsx` and converts each to a pattern (strip `(group)`, `[x]` → `:x`, `[[...x]]` → `*`). It asserts equality with an explicit 61-entry inventory, and that every `routing/paths.ts` helper output (sample ids) matches some pattern via `matchPath`. It replaces the route-table imports in `addRoute.test.tsx`, `messagesRoutes.test.tsx` and `EventPage.test.tsx`; these replacements are documented in the work-log.
- `routing/reservedSlugs.ts`: the frontend top-level static segments (`login, product, home, meetings, groups, items, profile, settings, places, family, account, search, wanted, add, events, terms, messages, onboarding, organization, oauth2, admin`).
- `test/reservedSlugs.test.ts`, which reuses the backend-literal parsing approach of `organizerKeyParity.test.ts`:
  - (a) every top-level static segment under `src/app` (outside groups) is in the TS list;
  - (b) every TS entry is in the backend `RESERVED_SLUGS` parsed from `slugs.py`.

## 7. B3 Seam Swap
- `routing/navigation.tsx` is re-implemented on `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`, `useParams`) and `next/link`. The public API is unchanged.
- **Vitest**: `resolve.alias` maps `next/navigation` → `src/test/navigationMock.ts` and `next/link` → `src/test/nextLinkMock.tsx`.
  - The mock holds a URL store (`useSyncExternalStore`); `useParams` is derived from the `pattern`/`routes` given to `renderWithRoute`.
  - `router.push/replace/back/refresh` update the store and record calls.
  - `redirect`/`notFound` throw sentinels.
  - The core behaviour uses plain functions, so `vi.resetAllMocks()` does not break it.
  - `renderWithRoute` renders the `routes` entry whose pattern matches the current mock pathname.
- **Deleted**: `router.tsx`, `main.tsx`, `index.html`, `vite-env.d.ts`, `vite.config.ts`, the `react-router-dom` and `@tailwindcss/vite` deps, `eslint-plugin-react-refresh`. Kept: `vite` + `@vitejs/plugin-react` (Vitest and the SDK build).
- **Scripts**:
  - `dev` = `next dev -p 5173`, `build` = `next build`, `start` = `next start -p 5173`;
  - `predev`/`prebuild` = `npm run build:sdk`;
  - `typecheck` = `tsc --noEmit`, `lint` = `eslint .`;
  - `preview` is removed;
  - root `package.json` `web`/`dev:all` are switched to them.
- `orgPalette.test.ts` reads `src/app/globals.css` instead of `src/index.css`. `vi.stubEnv` uses `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (3 tests). `lib/googleMaps.ts` reads `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (static reference, so Next inlines it).
- ESLint: `no-restricted-imports` for `next/navigation` and `next/link` outside `src/routing/**` (and the test mocks).

## 8. `src/proxy.ts` (B4)
Rules are evaluated in order. The proxy only checks for the cookie's presence; it never verifies the JWT.
1. `pathname === "/home"` → 307 redirect to `/` (search kept).
2. `pathname === "/"` and an `auth_token` cookie is present → `NextResponse.rewrite("/home" + search)`.
3. `POST /oauth2/authorize` → external rewrite to `${BACKEND_INTERNAL_URL}/oauth2/authorize` (body passes through; the form is small). A GET falls through to the page.
4. The pathname starts with a `PROTECTED_PREFIXES` entry and there is no cookie → redirect to `authPath("login", pathname + search)`.
   - `PROTECTED_PREFIXES` = `/home` (unreachable after rule 1), `/meetings`, `/groups`, `/items`, `/profile`, `/settings`, `/places`, `/family`, `/account`, `/search`, `/wanted`, `/add/` (with the slash: `/add` itself stays public), `/events/`, `/terms/`, `/messages`, `/onboarding`, `/organization`, `/oauth2/authorize`, `/admin`.
   - Each entry matches on a segment boundary (`/groups` ≠ `/groupsx`).
   - Never gated: `/`, `/add`, `/login`, `/product/*` and slug routes.
5. Otherwise → `NextResponse.next()`.

Matcher: `/((?!api/|_next/|assets/|\.well-known/|favicon\.svg|icons\.svg).*)`. `/api/*` must never be matched, because the 10 MB proxy body buffer would break 15 MB uploads. `BACKEND_INTERNAL_URL` is a server-only env var (dev default `http://localhost:8080`). The proxy logic is a pure function that is exported for tests.

## 9. Phase C — Server Metadata, Palette, Backend Cleanup

**C1 (frontend)**
- `api/server.ts` (`import "server-only"`): `serverGet<T>(path)` → `fetch(BACKEND_INTERNAL_URL + "/api" + path, { cache: "no-store" })`. It is always anonymous. Errors and non-2xx return `null`, so the page still renders with the default metadata. Calls are wrapped in React `cache()` so `generateMetadata` and the page share one fetch per request.
- `lib/publicMetadata.ts` holds pure functions from DTOs to Next `Metadata`, each a port of `public_preview.py`:
  - **Organization** (`GET /api/organizations/public/{slug}`): title = name, description `Strona organizacji {name}.`, image = `cover.url`.
  - **Event** (`GET /api/events/{id}`): title = name, description `{weekday} {DD.MM} o {HH:mm}` with weekdays `pon, wt, śr, czw, pt, sob, ndz` from the naive `starts_at` string (no TZ conversion), plus ` · {location.name}` when there is a location, plus ` {description}` when there is one. Image = `banner_url`.
  - **Term** (`GET /api/groups/public/{groupId}?term_id={termId}`): title = circle name. Description `Najbliższy termin: DD.MM.YYYY.` + ` {term.description}`, or `Dołącz i zobacz najbliższe spotkania.` when there is no term.
  - All three: `og:type` = `website`; Twitter card `summary_large_image` with an image, else `summary`; `og:`/`twitter:` title and description; the image on both.
  - The fallback for missing or invalid data (UUID party slug, reserved, not found, invalid UUID) is the root default (no OG tags). React escapes the values, which covers the HTML-escape and backslash cases.
- `generateMetadata` goes in `(owner)/page.tsx` (skipped for UUID/party slugs and `krag`), the event page and the term page. Duplicate client `<title>` elements in those pages are removed only where the server metadata now provides the same title.
- **Palette**: `theme/ServerThemeProvider.tsx` renders a context holding the initial `OrganizerTheme`, plus a `display: contents` wrapper with the `resolveOrgTheme(...)` CSS vars inline. `OrganizerThemeScope` uses `theme ?? initialTheme`, so the page's own data and live editor updates still win.
  - Theme source per page: the org response for `(owner)`; `event.organization` for events; `circle.organization` for terms. `krag`/UUID/none → no provider.

**C2 (backend)**
- Delete `app/system/public_preview.py`, the four preview routes, `spa_fallback`, `STATIC_DIR`/`INDEX_HTML`, and `tests/test_public_preview.py` (11 tests; 10 are ported in C1, and the circle-without-term case is dropped per D11). Keep `GET /api/health`.
- Add one pytest: an unknown page path such as `GET /some-page` returns 404 with the existing JSON envelope (`error == "Not Found"`).
- Re-check `AUTHORIZATION_MATRIX`: no row references the removed routes. The `^.*$` catch-all row stays; record this in the work-log. Update module docstrings that mention the SPA fallback.

## 10. Phase D — Deploy and Runtime
- **Dockerfile** (build context = repo root, unchanged):
  - `deps` stage: `npm ci`;
  - `build` stage: ARG `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `npm run build` (includes the SDK);
  - `runner` stage, node:22-alpine: copy `.next/standalone`, `.next/static`, `public`; `ENV PORT=3000 HOSTNAME=0.0.0.0 TZ=Europe/Warsaw`; `CMD node server.js`.
  - Also set `outputFileTracingRoot`/`turbopack.root` to `src/frontend` if Next infers the wrong workspace root from the repo-root lockfile.
- **nginx.conf** (nginx image, compose `frontend` 5174:80):
  - `/api/` → backend (`client_max_body_size 16m`);
  - `= /oauth2/authorize` → `web:3000`;
  - `/oauth2/` → backend;
  - `/.well-known/` → backend;
  - `/` → `web:3000`.
  - All of them forward `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. The `@backend_fallback` block is removed.
- **docker-compose.yml**:
  - delete `frontend-build`, the `frontend_index` volume, the backend `/app/static` mount and the `depends_on` entries that reference them;
  - add `web` (built from the Dockerfile, `BACKEND_INTERNAL_URL=http://backend:8080`);
  - rename the build arg to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`;
  - CORS default `http://localhost:5173` stays.
- `.env.example`: placeholders only. Rename the variable in the user's `.env` files: the implementer may only check for presence, never print a value.
- `next.config.ts` rewrites, used in dev and as a fallback without nginx: `/api/:path*`, `/oauth2/register`, `/oauth2/token`, `/oauth2/introspect`, `/.well-known/:path*` → `BACKEND_INTERNAL_URL`.
- `.claude/launch.json`: check that the frontend entry still runs on 5173. The plugins keep their hardcoded `http://localhost:5173/assets/...`.

## 11. Docs and Standards (D)
| File | Change |
|---|---|
| `.maister/docs/project/tech-stack.md` | Frontend section: Next 16.4, Turbopack, scripts, env var, SDK build |
| `.maister/docs/project/architecture.md` | Deploy topology (nginx → web/backend), OG via Next `generateMetadata`, `proxy.ts`, cookie, ports (fix the 5173 vs 5174 line), the backend no longer serves HTML |
| `standards/frontend/components.md`, `accessibility.md` | `pages/...` paths → `features/...`. Facade rule (router APIs only via `src/routing/`) |
| `standards/frontend/data-fetching.md` | `getQueryClient()`, `providers.tsx`; server fetches only through `api/server.ts`, anonymous, `no-store` |
| `standards/testing/frontend-testing.md` | `renderWithRoute`, `getTestLocation`, navigation mock aliasing, `tsc --noEmit` |
| `standards/backend/security.md` | Cookie accepted on GET/HEAD only, `Vary: Authorization, Cookie` |
| `standards/backend/plugin-auth.md`, `plugins/CLAUDE.md` | Host on Next; SDK path and port unchanged |
| `.maister/docs/INDEX.md` | Summaries refreshed for the above |

## 12. Smoke Checklist (Playwright MCP, backend + `next dev -p 5173`; deploy items via compose)
1. Anonymous `/` shows the landing. `/login` and the register tab (`?mode=register`).
2. Login → `/` shows the home view with the URL still `/`. No hydration warning in the console. BottomNav "Start" is active.
3. Typing `/home` → redirected to `/`.
4. Stale cookie: set an expired or garbage `auth_token` cookie and clear localStorage, then load `/`. The landing renders, the cookie is cleared, and a reload stays on the landing.
5. Every panel section switches without an AppData reload. `/add` works anonymously (PublicAddView) and logged in. `/add/product` while anonymous → login with `returnTo`.
6. `/messages` and a thread (h-dvh, no BottomNav). `/terms/:id`, `/groups/:id`.
7. `/product/:id` and the legacy `/product/:id/edit` → `?edit=1`. `/:slug/product/:id` and its `/edit` redirect. `/:slug/product` → `/:slug`.
8. `/:slug` organization, a UUID party profile, `/:slug/items|meetings|terms`.
9. `/:slug/event/:id`, `/:slug/group/:g/term/:t`, and `/krag/group/:g/term/:t`.
10. `curl -A facebookexternalhit` on the org, event and term pages → OG tags in the HTML. The organizer palette is visible on first paint.
11. EventCreate → EventPage toast. PlaceCreate → LocationPicker pick. ItemCreate → ItemDetail state.
12. Organizer editor dirty: a link, the back button and tab close are each guarded.
13. `/admin/*` with Chakra styling, as ADMIN and as an EDIT-only user. Plugin full-screen page (`/admin/plugins/:id/...`). `/assets/plugin-sdk.js` loads from :5173.
14. OAuth2 authorize GET page → approve POST → redirect round trip.
15. An unknown URL → 404 page. `/:slug/group/:g` → 404.
16. Via compose/nginx: a 15 MB photo upload succeeds, and `/.well-known/oauth-authorization-server` answers.

## Reusable Components

### Existing Code to Leverage
| Asset | Path | Use |
|---|---|---|
| Path helpers | `src/utils/appHelpers.ts` (`viewPath`, `viewFromPath`, `ID_PATH_VIEWS`, `eventPath`, `ownerPagePath`, `isPartyId`) | Moved as is to `routing/paths.ts`; used by the proxy and the manifest test |
| Auth paths | `src/auth/authPaths.ts` (`authPath`), `src/auth/homePath.ts` | The proxy login redirect uses the same `returnTo` format |
| AuthGuard | `src/auth/AuthGuard.tsx` | Unchanged logic; the router calls go through the facade |
| AppRoute logic | `src/router.tsx` (AppRoute element) | Ported into the `(panel)/layout.tsx` gate |
| OrganizerItemLayout | `src/pages/product/OrganizerItemLayout.tsx` | Becomes the org product layout body |
| Theme | `src/theme/orgPalette.ts` (`resolveOrgTheme`), `palettePresets.ts`, `OrganizerThemeScope.tsx` | Pure and SSR-safe; reused for server palette vars |
| Query client options | `src/api/queryClient.ts` | Same `defaultOptions` inside `getQueryClient()` |
| Backend-literal parsing | `src/test/organizerKeyParity.test.ts` | Pattern for the reserved-slug parity test |
| OG rules and expected strings | `src/backend/app/system/public_preview.py`, `app/core/clock.py` (`_WEEKDAYS`, `format_term_when`), `tests/test_public_preview.py` | Ported formatters and parity fixtures |
| Public endpoints | `api/organizations.ts` (`/organizations/public/{slug}`), `api/events.ts` (`/events/{id}`), `api/groups.ts` (`/groups/public/{id}?term_id=`) | Server metadata and theme fetches |
| Cache headers | `src/backend/app/core/cache_headers.py` | `Vary` change only |
| Token extraction | `src/backend/app/core/_auth/token.py::_extract_token` | Add one safe-method cookie branch |
| SDK build | `vite.sdk.config.ts`, `build:sdk` script | Unchanged; wired as `predev`/`prebuild` |
| CSS | `src/index.css` | Becomes `app/globals.css` verbatim |

### New Components Required
| New | Why existing code cannot serve |
|---|---|
| `routing/navigation.tsx`, `NavigationTracker.tsx`, `navigationGuard.ts`, `navigationState.ts` | No App Router equivalents for `useBlocker`, `location.state`, `location.key`; one seam lets the swap happen with a single file change |
| `routing/ClientOnly.tsx` | D2 client-only mount; nothing similar exists |
| `routing/reservedSlugs.ts` | No frontend list exists; needed for parity with the backend |
| `auth/session.ts` | The cookie lockstep has no current home; centralises 5 write points |
| `test/renderWithRoute.tsx`, `navigationMock.ts`, `nextLinkMock.tsx` | Replace MemoryRouter wrappers across both implementations; `next-router-mock` lacks `useParams`/`redirect` |
| `src/proxy.ts` | Rewrite, redirect and gate before render; no SPA counterpart |
| `api/server.ts`, `lib/publicMetadata.ts`, `theme/ServerThemeProvider.tsx` | Server-side metadata and palette replace backend HTML injection |
| `app/**` route files (61 pages, 7 layouts), `providers.tsx`, `not-found.tsx` | Required by the App Router; thin wrappers only |

## Technical Approach
- **Request flow (prod)**: browser → nginx → `web` (Next).
  - Next runs `proxy.ts`, then renders the root layout (cookie → `initialToken`), then the route.
  - Public pages SSR the chrome, the metadata and the palette (anonymous `api/server.ts` fetches). Authenticated groups render `null` on the server and mount on the client.
  - Client data calls stay relative: `/api` → nginx → backend with Bearer from localStorage.
- **Dev**: the browser hits Next on :5173. `next.config` rewrites forward `/api`, `/oauth2/{register,token,introspect}` and `/.well-known` to :8080. The proxy rewrites `POST /oauth2/authorize`.
- **Auth state**: localStorage and the cookie stay in lockstep through `auth/session.ts`. The server uses the cookie only for `initialToken`, the proxy rewrite and the gate; it never sends it to the backend. The backend accepts the cookie on GET/HEAD for direct browser GETs, with no frontend dependency (so rolling back A5 is safe).
- **Seam strategy**: every router, entry and test-wrapper difference is confined to `src/routing/navigation.tsx`, `src/test/renderWithRoute.tsx` (+ mocks), `app/**` and `providers.tsx`. Feature code is identical before and after B3.

## Implementation Guidance

### Testing Approach
- 2–8 focused new tests per step group. Each group runs only its new tests while iterating, then the full Vitest/pytest comparison against the A0 baseline at its checkpoint gate.
- New test sets:
  - A2: SSR-safety, 3–6 tests (`// @vitest-environment node`, `renderToString` of LandingPage, PublicLayout, LoginPage, ItemDetailPage shell, EventPage, TermPage with mocked APIs).
  - A3: facade, 6–8 tests (state consumed once, in-app history, functional `setSearchParams` + `scroll:false`, guard on link / programmatic / popstate, `normalizeAppPath`, `matchPath`).
  - A4: session, 4–6 tests (lockstep write and clear, `Max-Age` from `exp`, `Secure` on https, reconciliation table, 401 clears both).
  - A5: backend `tests/test_auth_cookie.py`, 5–6 tests. GET with a cookie resolves the principal. POST with only a cookie → 401 on an AUTHENTICATED route. Bearer wins over the cookie. An invalid cookie counts as anonymous on OptionalPrincipal routes. HEAD is accepted. `Vary`. Plus 1–2 slug tests (`home` reserved → `home-2`).
  - B2: route manifest (2–3) + reserved-slug parity (2).
  - B3: navigation mock self-tests (2–4).
  - B4: proxy, 6–8 tests (each rule in §8, plus the matcher excluding `/api`).
  - C1: metadata parity, 6–8 tests ported from `test_public_preview.py`, plus palette initial vars (2).
  - C2: backend 404 (1).
- Case count rule: never lower than the baseline, except for the documented replacements (route-table tests → manifest; `test_public_preview.py` → Vitest parity).

### Standards Compliance
- `standards/frontend/data-fetching.md`: hooks and API layers unchanged; one browser QueryClient.
- `standards/frontend/components.md`: view-state modules untouched; the facade rule is added.
- `standards/testing/frontend-testing.md`: explicit `vitest` imports, per-test QueryClient, typed fixtures, flat `src/test/`.
- `standards/global/minimal-implementation.md`: stub pages, no speculative abstractions, no `plugins/server.ts`, no handler split.
- `standards/global/conventions.md`: env var renamed in `.env.example`.
- `standards/backend/security.md`: cookie on safe methods only, `Vary`.
- `standards/backend/plugin-auth.md`: `getToken` still returns the JWT.
- `standards/testing/backend-testing.md`: flat `tests/test_<feature>.py`, exact header assertions updated, never loosened.
- `standards/backend/time.md`: Warsaw naive strings formatted without conversion.
- CLAUDE.md secrets rule: only presence checks of env values; no values in artifacts.

## Out of Scope
- Server-side data prefetch and hydration of view data. Server Components beyond metadata and palette.
- `next/font`, an Emotion SSR registry (unless the smoke shows FOUC), `error.tsx`.
- HttpOnly or BFF auth. Backend `Set-Cookie`. A CSRF token scheme.
- New features: `/:slug/group/:groupId` page, metadata for product, items, meetings, terms or UUID profiles.
- Splitting files during the D7 reorganisation (`plugins/host/handlers/*`, `permissions.ts`, per-layout files, `plugins/server.ts`). Moving panel views out of the `AppPage` switch into their own pages.
- Dual-run (no production). Any DB migration.

## Success Criteria
- The Vitest passing set at C9 and C13 ⊇ the A0 passing set. The case count is ≥ the baseline minus the documented replacements.
- pytest has no new failures, ruff is clean and mypy is ≤ 15 at C6, C12 and C13.
- `next build` and `tsc --noEmit` succeed. ESLint errors are ≤ the baseline.
- After C9, `src/` contains no `react-router-dom` import, no `src/pages`, no `src/app` outside the route tree, and no `import.meta.env`.
- The route manifest lists exactly 61 patterns, and the reserved-slug parity test passes, including `home`.
- All 16 smoke-checklist items pass and are recorded in `verification/` with notes.
- Each checkpoint C0–C13 exists as a commit on `main`, and `analysis/rollback-plan.md` matches the commit list.
