# Implementation Plan: Frontend Migration — Vite 8 + React Router 7 SPA → Next.js 16.4 App Router

## TL;DR
- 17 task groups follow the spec's checkpoint sequence C0 → C13. Each group ends at a gate: Vitest pass-set ⊇ the A0 baseline, tsc / `next build`, eslint ≤ baseline, and for backend groups pytest / ruff / mypy ≤ 15. The gate is followed by a checkpoint commit on `main`.
- Order: C0 user WIP → A0 baselines → A1 `features/` move (scripted) → A2 SSR-safety → A3 facade → A4 cookie (frontend) → B1 scaffold → B2 route tree → B3 swap to Next → B4 proxy → C1 server metadata → C2 backend cleanup → D deploy + docs + test-gap review + smoke-checklist prep, all committed as C13.
- Concurrency the dependencies allow: the backend A5 group (C6) needs only the A0 baselines, so it can run alongside A1–A4. In phase D, the deploy, docs and test-gap groups can run side by side. Commits always land in C-number order.
- 40–54 new focused tests, plus up to 10 gap tests in the review group. Each group has a rollback: `git revert <Ck>`, run by the user. The backend commits C6 and C12 can be reverted on their own.

## Key Decisions
- One group per checkpoint (C0–C12). Phase D is split into four groups (Deploy Runtime, Docs & Standards, Migration Test Gap Review, Smoke Checklist Preparation) that share the single commit C13. Rationale: the spec defines one D checkpoint, and the split lets the independent D work run concurrently.
- Checkpoint commit steps are part of the plan, which deviates from the planner default. Rationale: the user authorised commits on `main` directly, and the spec/rollback plan makes each commit the rollback unit.
- Staging is path-scoped: frontend groups stage only `src/frontend/**` (+ this task folder), backend groups only `src/backend/**`, and nobody uses `git add -A`. Rationale: lets A5 run alongside A1–A4 without one commit picking up another group's files, and keeps C6/C12 backend-only so each reverts on its own.
- The work-log (`implementation/work-log.md`, checkpoint SHAs, documented replacements) is appended by the executor after each group. It is not listed in any group's Files to Modify. Rationale: a shared file in every group would serialize the whole plan.
- A1 adds no tests. Its proof is the unchanged pass-set and case count, plus grep checks. Rationale: R3 is moves plus specifier rewrites only. New tests would change the case count that the gate compares.
- C1 parity tests are table-driven (`it.each`) so the 10 ported backend cases fit in 6 test functions, plus 2 palette tests (8). Rationale: keeps to the 2–8 per-group limit while porting every expected string from `test_public_preview.py`.
- The smoke checklist is prepared, not executed. Rationale: running it is Phase 6's job (requirements §3.5).
- Admin layout gate is AuthGuard-only. The D7 file splits stay out of scope. `features/search` and `features/add` are separate folders. Rationale: user decisions at the Phase 3 gate (spec §4, Key Decisions).

## Open Questions / Risks
- The A3 test migration (55 test files to `renderWithRoute`) is the largest manual surface. Test names must stay byte-identical so the id comparison holds. Any rename shows up as a "missing" baseline id.
- A1 codemod: mock specifier strings (`vi.mock("../pages/...")`) that are not rewritten fail silently, because the mock stops applying. The gate's pass-set comparison is the safety net, together with a grep for `pages/` and `src/app/` specifiers.
- Running A5 concurrently: if A5's gate passes before C5 exists, the A5 group must wait for C5 before it commits as C6.
- The flaky OrganizerEditor test and the ~13 known failures: the comparison goes by test id, and a flaky failure must pass on one re-run.
- `eslint-config-next` (B1) may raise the error count. New-rule errors that would demand behaviour changes are disabled in config, with a one-line reason each. Error count stays ≤ the baseline.
- Usage of `usePathname()` under the proxy rewrite, Emotion FOUC on SSR'd public pages, and the `POST /oauth2/authorize` forwarded host: each is observable only in the Phase 6 smoke. The checklist items are tagged for them.
- pytest needs Docker (testcontainers PostgreSQL 18). If Docker is down, a backend gate cannot pass. That is a stop condition, not something to skip.
- The executor has no TaskCreate tool in this session, so group items were not created. Group-level tracking relies on this plan's checkboxes and the HTML markers.

## Overview
Total Steps: 124
Task Groups: 17
Expected Tests: 40–54 new focused tests (groups 4–7, 9–13) + up to 10 gap tests (group 16). The Vitest case count must be ≥ the A0 count minus documented replacements. Backend: −11 (`test_public_preview.py`) + 7–9 new.

### Gate commands (referenced by every group as "Standard gate")
Run from `src/frontend` unless noted. Never print env values; check presence only.

| Gate id | Command | Pass condition |
|---|---|---|
| G-VT | `npx vitest run --reporter=json --outputFile=<task>/verification/gates/vitest-<Ck>.json`, then `node <scratchpad>/compare-vitest.mjs <task>/verification/baseline/vitest-A0.json <task>/verification/gates/vitest-<Ck>.json` | every baseline-passing id still passes (a flaky failure passes on one re-run); case count ≥ baseline minus documented replacements |
| G-TSC | A phases + B1/B2: `npx tsc -b`; from B3 on: `npx tsc --noEmit` | exit 0 (or error count ≤ baseline if the baseline is non-zero) |
| G-NB | `npx next build` (from B1 on) | exit 0 |
| G-ESL | `npx eslint . -f json -o <task>/verification/gates/eslint-<Ck>.json` | error count ≤ baseline |
| G-PY | from `src/backend`: `uv run python -m pytest -q -rA` | no test passing at baseline fails; new tests pass (Docker required) |
| G-RUFF | from `src/backend`: `uv run python -m ruff check .` | clean (or ≤ baseline) |
| G-MYPY | from `src/backend`: `uv run python -m mypy app` | ≤ 15 errors |

`<task>` = `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs`. The compare script and the A1 codemod live in the scratchpad and are never committed.

Every commit message ends with:
```
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

## Implementation Steps

### Task Group 1: User WIP Checkpoint (C0)
**Dependencies:** None
**Files to Modify:** None (commit only). Staged: the 28 modified paths from git status (`.maister/docs/project/architecture.md`, `.maister/docs/standards/backend/security.md`, `src/backend/app/**` 7 files, `src/backend/tests/test_{authorization_matrix,group_access,public_term}.py`, `src/frontend/src/**` 16 files) and the untracked `src/backend/tests/test_owner_meetings.py`, `src/backend/tests/test_party_profile.py`, `src/frontend/src/hooks/{useOwnerMeetings,usePartyProfile}.ts`, `src/frontend/src/pages/owner/{OwnerMeetingsPage,OwnerPage,PartyProfilePage}.tsx`, `src/frontend/src/test/{OwnerMeetingsPage,PartyProfilePage}.test.tsx`
**Estimated Steps:** 5

- [x] 1.0 Commit the user's pre-existing WIP alone (R1)
  - [x] 1.1 Run `git status --porcelain` and check the list against the conversation-start snapshot. If it lists files the snapshot does not, stop and report instead of committing them.
  - [x] 1.2 Stage the WIP paths explicitly with `git add -- <path>…`. Never run `git add -A` or `git add .`. Both `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs/` and `.maister/tasks/migrations/2026-11-02-vite-to-nextjs-frontend/` stay unstaged.
  - [x] 1.3 Verify: `git diff --cached --name-only | grep -c "^.maister/tasks/"` prints 0, and `git status --porcelain` shows only the two `?? .maister/tasks/migrations/...` entries.
  - [x] 1.4 Commit `wip: owner/meetings pages` with the attribution trailer. No gate: the user's code is committed as is.
  - [x] 1.5 Record the C0 SHA (the executor writes it to the work-log).

**Checkpoint gate:** none (user's code as is).
**Rollback:** C0 is the pre-migration point. Full rollback = `git reset --hard <C0>` (user-run), then `npm ci` in `src/frontend`.
**Acceptance Criteria:**
- C0 holds exactly the user's WIP. No `.maister/tasks/migrations/*` path is in the commit.

---

### Task Group 2: Baseline Capture (A0)
**Dependencies:** 1
**Files to Modify:** `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs/verification/baseline/*` (vitest-A0.json, vitest-A0.txt, tsc-A0.txt, eslint-A0.json, eslint-A0.txt, pytest-A0.txt, ruff-A0.txt, mypy-A0.txt, summary.md)
**Estimated Steps:** 7

- [ ] 2.0 Record measurable baselines before any migration change (R2)
  - [ ] 2.1 Vitest: `npx vitest run --reporter=json --outputFile=<task>/verification/baseline/vitest-A0.json`. Derive `vitest-A0.txt`, a sorted `file › full name → status` list, and the total case count. Note the ~13 known failures and the OrganizerEditor flake.
  - [ ] 2.2 `npx tsc -b`: record the exit code and error count in `tsc-A0.txt`. `npx eslint . -f json -o …/eslint-A0.json`: record error and warning counts in `eslint-A0.txt`.
  - [ ] 2.3 Backend, from `src/backend`, with Docker running: `uv run python -m pytest -q -rA` → `pytest-A0.txt` (pass/fail list). Then `uv run python -m ruff check .` → `ruff-A0.txt` and `uv run python -m mypy app` → `mypy-A0.txt` (expect 15). Check Docker by presence only. Never dump env.
  - [ ] 2.4 Write the scratchpad `compare-vitest.mjs`. It takes the A0 and a candidate JSON and prints baseline-passing ids that no longer pass, plus the case-count delta, and exits non-zero on a regression. Write `compare-pytest` in the same way. Do not commit them.
  - [ ] 2.5 Self-check the compare scripts: compare A0 against itself (expect 0 regressions, delta 0). Run a second Vitest pass to classify flaky ids, and list them in `summary.md`.
  - [ ] 2.6 Write `summary.md`: counts per tool, known failures, flaky ids, the eslint/tsc baseline numbers that later gates use.
  - [ ] 2.7 Commit C1 `chore(migration): A0 baselines`. Stage only `<task>/` (this task folder: analysis/, implementation/, verification/, orchestrator state/dashboard). The other task folder stays untracked.

**Checkpoint gate:** baselines recorded; compare scripts self-check clean.
**Rollback:** `git revert <C1>` (task-folder only; no runtime impact).
**Acceptance Criteria:**
- All baseline files exist, and the compare scripts work against them.

---

### Task Group 3: Feature-Folder Reorganisation (A1, D7)
**Dependencies:** 2
**Files to Modify:** `src/frontend/src/**` (moves per spec §4: `src/frontend/src/app/*`, `src/frontend/src/pages/**`, `src/frontend/src/components/{moderation,onboarding,panel,pending}/**`, `src/frontend/src/components/layout/{AuthLayout.tsx,authStyles.ts,SocialAuthButtons.tsx}`, `src/frontend/src/plugins/*`, `src/frontend/src/theme/{index.ts,palettePresets.ts}`, `src/frontend/src/utils/messagesPaths.ts`, `src/frontend/src/assets/{hero.png,react.svg,vite.svg}` → `src/frontend/src/features/**`, `src/frontend/src/components/layout/pending/**`, `src/frontend/src/plugins/{host,slots}/**`, `src/frontend/src/theme/{system,palettes}.ts`, `src/frontend/src/routing/messagesPaths.ts`), `src/frontend/src/router.tsx`, `src/frontend/src/main.tsx`, `src/frontend/src/test/**/*.test.ts(x)` (specifiers only), `src/frontend/src/test/themeDefects.test.tsx`
**Estimated Steps:** 9

- [ ] 3.0 Move every file per the §4 table and rewrite specifiers only (R3)
  - [ ] 3.1 No new tests (moves only). Before starting, confirm that the C1 baseline pass-set is the reference.
  - [ ] 3.2 Write the scratchpad mapping file `d7-map.json` with one entry per old → new path, transcribed from spec §4, including the renames: `plugins/PluginContext.tsx` → `plugins/host/PluginHost.tsx`, `theme/index.ts` → `theme/system.ts`, `theme/palettePresets.ts` → `theme/palettes.ts`, `utils/messagesPaths.ts` → `routing/messagesPaths.ts`, `features/add/*`, `features/search/*`. Assert that every source file under `src/pages`, `src/app`, `components/{moderation,onboarding,panel,pending}` has an entry. Fail on an unmapped file. `src/assets/layouts/*.svg` is excluded (A2).
  - [ ] 3.3 Write the scratchpad codemod `d7-move.mjs`.
    - (a) Run `git mv` for each mapping, creating folders as needed.
    - (b) For every `.ts/.tsx` under `src/frontend/src`, rewrite static `import`/`export … from`, dynamic `import()`, and the string arguments of `vi.mock`, `vi.doMock`, `vi.importActual`, `vi.importMock`. For each specifier: resolve it relative to the file's **old** location (extension/index resolution), map it through the table, re-relativise it from the file's **new** location, and keep the original extension style.
    - (c) Print every rewritten and every unresolved specifier.
    - Run it with `--dry-run` first and review the unresolved list.
  - [ ] 3.4 Run the codemod. Delete the empty `pages/person/` and the unreferenced `assets/hero.png`, `react.svg`, `vite.svg` (first verify with grep that they are unreferenced).
  - [ ] 3.5 Hand-edit the literal path strings: the `themeDefects.test.tsx` source list, and any `fs`/`readFileSync` paths in tests (grep `src/pages`, `src/app`, `components/panel`, `palettePresets`, `theme/index`). Update comments that name moved file paths.
  - [ ] 3.6 Grep checks: `grep -rnE "(from|import\(|vi\.(mock|doMock|importActual|importMock)\()\s*['\"][^'\"]*(/pages/|/app/)" src/frontend/src` returns nothing; `src/frontend/src/pages` and `src/frontend/src/app` do not exist.
  - [ ] 3.7 Run the standard gate (G-VT with the **same case count** as A0, G-TSC `tsc -b`, G-ESL). Run `npx vite build` once as a smoke check.
  - [ ] 3.8 If the pass-set regresses: inspect the unresolved and mock specifiers first. Fix with specifier edits only. No behaviour edits are allowed in this group.
  - [ ] 3.9 Commit C2 `refactor(frontend): A1 features/ reorganisation` (stage `src/frontend` only).

**Checkpoint gate:** G-VT (pass-set ⊇ A0, case count == A0), G-TSC, G-ESL ≤ baseline, the grep checks in 3.6.
**Rollback:** `git revert <C2>` (user-run). Restores the old paths; no dependency change.
**Acceptance Criteria:**
- The tree matches spec §4. No file is split or merged, and exported symbols are unchanged.
- Test names and behaviour are unchanged, and the case count is identical.

---

### Task Group 4: SSR-Safety & Query Client (A2)
**Dependencies:** 3
**Files to Modify:** `src/frontend/src/auth/AuthContext.tsx`, `src/frontend/src/features/auth/OAuth2AuthorizePage.tsx`, `src/frontend/src/features/panel/HomeView.tsx`, `src/frontend/src/components/layout/pending/PendingActionsHost.tsx` (+ its `snoozeStore`), `src/frontend/src/features/events/hooks/useEventSignUp.ts`, `src/frontend/src/hooks/useGuestMerge.ts`, `src/frontend/src/features/terms/hooks/useJoinCodeLink.ts`, `src/frontend/src/features/owner-page/OrganizationPage.tsx`, `src/frontend/src/features/events/EventPage.tsx`, `src/frontend/src/features/items/product/{ItemStatusCard,TakeSuccessSheet}.tsx`, `src/frontend/src/features/items/SwapAcceptSuccessSheet.tsx`, `src/frontend/src/components/shared/{appComponents,ConfirmDeleteDialog,ModalSheet,PhotoViewer}.tsx`, `src/frontend/src/api/queryClient.ts`, `src/frontend/src/api/client.ts`, `src/frontend/src/main.tsx`, `src/frontend/src/features/owner-page/layouts/registry.ts`, `src/frontend/src/assets/layouts/*.svg` → `src/frontend/public/assets/layouts/*.svg`, `src/frontend/src/test/ssrSafety.test.tsx` (new), test files importing `queryClient` (`src/frontend/src/test/**`)
**Estimated Steps:** 8

- [ ] 4.0 Remove render-time and module-time browser access (R4)
  - [ ] 4.1 Write 3–6 tests in `src/test/ssrSafety.test.tsx` (`// @vitest-environment node`, explicit `vitest` imports). `renderToString` LandingPage, PublicLayout, LoginPage, the ItemDetailPage shell, EventPage and TermPage, with mocked APIs and no `window`/`localStorage` access thrown. Add a `getQueryClient()` test: the same instance on repeated browser calls, with `defaultOptions` preserved.
  - [ ] 4.2 Module time: `AuthContext.tsx:70 loadStoredAuth()` becomes lazy (`useState(() => …)` with a `typeof window` guard). A4 replaces it later.
  - [ ] 4.3 Render-time sites (spec §5.2; line numbers in `analysis/current-state-analysis.md` §140): move each to `useSyncExternalStore` with a neutral server snapshot, or into an effect/handler. Choose whichever keeps the current first paint in jsdom. Sites: `OAuth2AuthorizePage`, `HomeView`, `snoozeStore`, `useEventSignUp`, `useGuestMerge`, `useJoinCodeLink`, `OrganizationPage`, `EventPage`, `ItemStatusCard`, `TakeSuccessSheet`, `SwapAcceptSuccessSheet`, and the four `document.activeElement` initialisers.
  - [ ] 4.4 `api/queryClient.ts` exports `getQueryClient()`: a new client on the server, a singleton in the browser, with the same `defaultOptions` and retry policy. Update `main.tsx` and any test/source import of the old `queryClient` export.
  - [ ] 4.5 Add a `typeof window` guard to the `api/client.ts` 401 handler. Audit `snoozeStore`, `openSheets`, `organizerSteps` `createdCircle`, `googleMaps` `placesPromise` and `iframeRegistry` for writes during render. The executor records the outcome in the work-log.
  - [ ] 4.6 Run `git mv src/assets/layouts/*.svg public/assets/layouts/`. In `features/owner-page/layouts/registry.ts`, replace the imports with string constants `/assets/layouts/<key>.svg`. Remove the now-empty `src/assets`.
  - [ ] 4.7 Run the 4.1 tests, then the standard gate (G-VT: pass-set ⊇ A0, case count ≥ A0 + new; G-TSC `tsc -b`; G-ESL).
  - [ ] 4.8 Commit C3 `refactor(frontend): A2 SSR-safety, getQueryClient` (stage `src/frontend` only).

**Checkpoint gate:** G-VT, G-TSC, G-ESL, plus the new SSR-safety tests green.
**Rollback:** `git revert <C3>` (user-run). Also reverts the SVG move back to `src/assets/layouts`.
**Acceptance Criteria:**
- The 3–6 SSR-safety tests pass, and no listed site reads browser globals during render or at module load.
- Layout thumbnails load from `/assets/layouts/*.svg` under Vite.

---

### Task Group 5: Navigation Facade on React Router (A3)
**Dependencies:** 4
**Files to Modify:** `src/frontend/src/routing/{navigation.tsx,NavigationTracker.tsx,navigationGuard.ts,navigationState.ts,paths.ts}` (new), `src/frontend/src/utils/appHelpers.ts`, `src/frontend/src/router.tsx`, `src/frontend/src/main.tsx`, `src/frontend/src/auth/AuthGuard.tsx`, `src/frontend/src/components/layout/*.tsx`, `src/frontend/src/features/**` (91 router-using source files), `src/frontend/src/features/items/product/OrganizerItemLayout.tsx` (+ `OrganizerItemContext`), `src/frontend/src/features/owner-page/editor/EditorSheet.tsx`, `src/frontend/src/plugins/**`, `src/frontend/src/test/renderWithRoute.tsx` (new), `src/frontend/src/test/navigationFacade.test.tsx` (new), `src/frontend/src/test/**/*.test.tsx` (55 router-coupled test files, incl. `OrganizerEditor.test.tsx` and organizerMediaBlocks), `src/frontend/eslint.config.js`
**Estimated Steps:** 11

- [ ] 5.0 Put all router access behind `src/routing/` (R5, R17, R18, R19, R20, R21)
  - [ ] 5.1 Write 6–8 tests in `src/test/navigationFacade.test.tsx`:
    - navigation state consumed once;
    - `useHasInAppHistory` false on first load and true after one push;
    - functional `setSearchParams` keeps other params and passes `scroll:false`;
    - guard blocks a link click and a programmatic `navigate`;
    - guard popstate best-effort with `proceed()`;
    - `normalizeAppPath("/home") === "/"`;
    - `matchPath` with params and splat.
  - [ ] 5.2 Create `routing/paths.ts`. Move `View`, `viewPath`, `viewFromPath`, `ID_PATH_VIEWS`, `isPartyId`, `eventPath`, `ownerPagePath` and the `*EditPath` helpers from `utils/appHelpers.ts` without changing their logic, and rewrite the imports (scripted, like A1). Add `normalizeAppPath`, `matchPath(pattern, pathname)` and `PROTECTED_PREFIXES` (spec §8 list).
  - [ ] 5.3 Create `routing/navigation.tsx` on React Router with the API from the spec §5.3 table: `Link`, `Navigate`, `useAppNavigate`, `useAppParams` (catch-all → `"*"`), `useAppSearchParams`, `useAppPathname`, `useAppSearch`, `useHasInAppHistory`, `useNavigationState`, `useNavigationGuard`, `useRouterRefresh` (no-op on RR). Add `NavigationTracker.tsx` (client navigation count, decremented on popstate), `navigationState.ts` (per-URL store) and `navigationGuard.ts` (registry; capture-phase same-origin `<a>` interception; `beforeunload`; popstate re-push).
  - [ ] 5.4 Migrate all 91 source files from `react-router-dom` to the facade, including `AuthGuard` (`Navigate`) and `PublicLayout` (`useMatch` → `matchPath`). Mount `NavigationTracker` in `main.tsx`.
  - [ ] 5.5 R18 sites:
    - `location.state` flows (EventCreate→EventPage toast, ItemCreate→`ItemDetailPage:113`, PlaceCreate→`LocationPicker:59`) → `Link`/`navigate` `state` + `useNavigationState`.
    - The 4 `location.key !== "default"` sites (ThreadPage, OwnerItemsPage, PartyProfilePage, ItemBackButton) → `useHasInAppHistory`.
  - [ ] 5.6 R19: `useOutletContext` in ItemDetailPage → `OrganizerItemContext`, provided by `OrganizerItemLayout` around `<Outlet/>`.
  - [ ] 5.7 R17: `EditorSheet` replaces `useBlocker` with `useNavigationGuard`, using the same pathname-change predicate; the returned object is `useBlocker`-shaped. Adapt `OrganizerEditor.test.tsx` and the organizerMediaBlocks `useNavigationType` usage to the facade.
  - [ ] 5.8 Create `test/renderWithRoute.tsx` (`renderWithRoute(ui, { url, pattern?, routes? })`, `getTestLocation()`, `getTestRouter()`), backed by MemoryRouter + Routes + a location probe. Migrate the 55 router-coupled test files. Test names stay byte-identical. The 10 per-file `renderWithProviders` helpers delegate to it, and probe routes are replaced by `getTestLocation()`.
  - [ ] 5.9 ESLint: add `no-restricted-imports` for `react-router-dom` outside `src/routing/**` and `src/test/renderWithRoute.tsx`. Verify with `grep -rln "react-router-dom" src/frontend/src`: only `routing/`, `renderWithRoute.tsx` and `router.tsx`/`main.tsx` (entry, deleted in B3) are allowed.
  - [ ] 5.10 Run the 5.1 tests, then the standard gate (G-VT: pass-set ⊇ A0, case count ≥ A0; G-TSC `tsc -b`; G-ESL). Re-run the OrganizerEditor flake once if it fails.
  - [ ] 5.11 Commit C4 `refactor(frontend): A3 navigation facade + renderWithRoute` (stage `src/frontend` only).

**Checkpoint gate:** G-VT (case count ≥ A0), G-TSC, G-ESL, facade tests green, and no `react-router-dom` import outside the allowed files.
**Rollback:** `git revert <C4>` (user-run). Revert C9+ first if they exist (C9 depends on C4).
**Acceptance Criteria:**
- The 6–8 facade tests pass, and every test name from A0 still exists and passes.
- `EditorSheet` guards links, programmatic navigation, `beforeunload` and back/forward (best effort).

---

### Task Group 6: Session Cookie — Frontend (A4)
**Dependencies:** 5
**Files to Modify:** `src/frontend/src/auth/session.ts` (new), `src/frontend/src/auth/AuthContext.tsx`, `src/frontend/src/auth/AuthGuard.tsx`, `src/frontend/src/api/client.ts`, `src/frontend/src/main.tsx`, `src/frontend/src/test/session.test.ts` (new), `src/frontend/src/test/**/*.test.tsx` (only where `AuthProvider` is rendered without `initialToken`)
**Estimated Steps:** 7

- [ ] 6.0 Keep the localStorage token and the `auth_token` cookie in lockstep (R6)
  - [ ] 6.1 Write 4–6 tests in `src/test/session.test.ts`:
    - `setSession` writes localStorage and the cookie together;
    - `clearSession` clears both;
    - `Max-Age` is derived from the JWT `exp`;
    - `Secure` is added on https;
    - the reconciliation table: valid localStorage wins / cookie-only copied / both invalid cleared;
    - a 401 from `api/client.ts` clears both.
  - [ ] 6.2 Create `auth/session.ts`: `readStoredToken()`, `setSession(jwt)`, `clearSession()`. The cookie is `auth_token=<jwt>; Path=/; SameSite=Lax; Max-Age=<exp−now>` (+ `; Secure` on https). It is not HttpOnly.
  - [ ] 6.3 Route every write point through it: `login`, `register`, `applyExternalToken`, `logout` (then the hard redirect to `/login`, as today), the `api/client.ts` 401 handler, and the `AuthGuard` stale-token path.
  - [ ] 6.4 `AuthProvider({ initialToken })`: no module-time read. Vite `main.tsx` passes `readStoredToken()`. A mount effect reconciles per spec §5.4 and always rewrites the cookie to match. Any token change calls `useRouterRefresh()`.
  - [ ] 6.5 Update the tests that render `AuthProvider` only where needed for the new prop (behaviour unchanged).
  - [ ] 6.6 Run the 6.1 tests, then the standard gate (G-VT, G-TSC `tsc -b`, G-ESL).
  - [ ] 6.7 Commit C5 `feat(frontend): A4 auth_token session cookie` (stage `src/frontend` only).

**Checkpoint gate:** G-VT ⊇ A0 plus the session tests, G-TSC, G-ESL.
**Rollback:** `git revert <C5>` (user-run). The `auth_token` cookie left in browsers is harmless: delete it in devtools or log out once.
**Acceptance Criteria:**
- The 4–6 session tests pass, and all write points go through `auth/session.ts`.

---

### Task Group 7: Backend Cookie Read, Vary & Reserved Slug (A5)
**Dependencies:** 2 (work); commit after C5 exists
**Files to Modify:** `src/backend/app/core/_auth/token.py`, `src/backend/app/core/cache_headers.py`, `src/backend/app/organizations/slugs.py`, `src/backend/tests/test_auth_cookie.py` (new), `src/backend/tests/test_reserved_listings.py`, `src/backend/tests/test_organization_slugs.py` (or the existing slug test file found by grep)
**Estimated Steps:** 8

- [ ] 7.0 Backend reads the cookie on safe methods, varies on Cookie, and reserves `home` (R7)
  - [ ] 7.1 Write 6–8 tests in `tests/test_auth_cookie.py` (flat naming per backend-testing.md, exact header assertions):
    - GET with the `auth_token` cookie resolves the principal;
    - POST with only a cookie on an AUTHENTICATED route → 401;
    - Bearer wins over a different cookie;
    - an invalid cookie counts as anonymous on an OptionalPrincipal route;
    - HEAD with a cookie is accepted;
    - a personalised public route returns `Vary: Authorization, Cookie`.
    Plus 1–2 slug tests: `home` is reserved, and a name slugifying to `home` → `home-2`.
  - [ ] 7.2 `_extract_token`: after the header, `_token` query and `_token` form, add `request.cookies.get("auth_token")` only when `request.method in {"GET", "HEAD"}`. Update the docstring. Leave the `app/oauth2/router.py` `_token` form parsing untouched.
  - [ ] 7.3 `cache_headers.py`: `Vary: Authorization, Cookie`. Update the exact assertions in `tests/test_reserved_listings.py` (lines ~411, ~446) and any other match of `grep -rni vary tests`. Update them, never loosen them.
  - [ ] 7.4 `slugs.py`: add `"home"` to `RESERVED_SLUGS`. The docstring should point to `src/app` (Next route tree) and `routing/reservedSlugs.ts` instead of `router.tsx`.
  - [ ] 7.5 CSRF argument: check that no GET/HEAD route in `AUTHORIZATION_MATRIX` mutates state (grep the GET handlers for writes/commits). The executor records the result in the work-log.
  - [ ] 7.6 Read-only dev-DB check: `SELECT count(*) FROM organizations WHERE slug = 'home'`, run through the existing DB tooling. Report only the count. Never print connection strings or credentials (secrets rule: presence checks only).
  - [ ] 7.7 Run the 7.1 tests, then G-PY (no new failures vs `pytest-A0.txt`), G-RUFF, G-MYPY ≤ 15.
  - [ ] 7.8 Wait until C5 is committed, then commit C6 `feat(backend): A5 cookie on GET/HEAD, Vary Cookie, reserve home` (stage `src/backend` only).

**Checkpoint gate:** G-PY, G-RUFF, G-MYPY ≤ 15, and the new tests green.
**Rollback:** `git revert <C6>` (user-run, independent of the frontend). To keep the B2 parity test green, revert only the `token.py`/`cache_headers.py` hunks: run `git revert -n <C6>`, restore `slugs.py` (and its test), then commit. Restore the old exact `Vary` assertions together with the `cache_headers.py` revert. If C12 is also reverted, revert C12 first.
**Acceptance Criteria:**
- The 6–8 tests pass, a cookie is never honoured on POST/PUT/PATCH/DELETE, and mypy stays ≤ 15.

**Notes:** This group touches backend configuration. Never print secret values (no `env`, `printenv` or `cat .env`; presence checks only), and never write values into artifacts. Any subagent prompt for this group must repeat this rule.

---

### Task Group 8: Next.js Scaffold (B1)
**Dependencies:** 6
**Files to Modify:** `src/frontend/package.json`, `src/frontend/package-lock.json`, `src/frontend/next.config.ts` (new), `src/frontend/postcss.config.mjs` (new), `src/frontend/tsconfig.json`, `src/frontend/tsconfig.app.json`, `src/frontend/tsconfig.node.json`, `src/frontend/eslint.config.js`, `src/frontend/src/app/{layout.tsx,providers.tsx,not-found.tsx,globals.css}` (new), `src/frontend/next-env.d.ts`, `src/frontend/.gitignore`, `src/frontend/vitest.config.ts`
**Estimated Steps:** 8

- [ ] 8.0 Add Next 16.4.x next to the running Vite app (R8)
  - [ ] 8.1 No new tests: the scaffold is covered by `next build` and the unchanged Vitest suite. Confirm that Vitest still discovers the same files after the tsconfig change.
  - [ ] 8.2 Install `next@16.4.x` (exact patch pinned in the lockfile), `@tailwindcss/postcss`, `eslint-config-next` and `server-only`. Keep `vite`, `@vitejs/plugin-react` and `react-router-dom` until B3.
  - [ ] 8.3 `next.config.ts`:
    - `output: "standalone"`, Turbopack;
    - dev rewrites for `/api/:path*`, `/oauth2/register`, `/oauth2/token`, `/oauth2/introspect` and `/.well-known/:path*` to `BACKEND_INTERNAL_URL` (default `http://localhost:8080`);
    - `outputFileTracingRoot`/`turbopack.root` = `src/frontend` if the repo-root lockfile misleads workspace detection.
  - [ ] 8.4 `postcss.config.mjs` with `@tailwindcss/postcss`. Merge into a single `tsconfig.json` (Next plugin, `jsx: preserve`, `src/test` still included). Keep `tsc -b`/`--noEmit` workable, and keep Vitest's config independent.
  - [ ] 8.5 Create `src/app/layout.tsx`:
    - `<html lang="pl" suppressHydrationWarning>`;
    - Google Fonts preconnect and `<link>`;
    - default metadata: "Krąg grupy" and `/favicon.svg`;
    - `(await cookies()).get("auth_token")` → `<Providers initialToken>`;
    - `<body><div id="root">`.
    Create `providers.tsx` (`'use client'`; QueryClientProvider(getQueryClient()) → ChakraProvider(system) → AuthProvider(initialToken) → NavigationTracker), `not-found.tsx` (Polish copy), and `globals.css`, copied from `src/index.css` with the `@layer` order line first.
  - [ ] 8.6 ESLint: add `eslint-config-next`. Any new-rule error that would force a behaviour change is disabled with a one-line reason. The error count must stay ≤ the baseline.
  - [ ] 8.7 Env: add the `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` reading path only where B3 needs it. No `.env` values are read or printed (presence checks only).
  - [ ] 8.8 Gate: G-NB (`npx next build`); G-VT on Vite ⊇ A0; G-TSC `tsc -b`; G-ESL. Then commit C7 `build(frontend): B1 Next scaffold` (stage `src/frontend` only).

**Checkpoint gate:** G-NB, G-VT, G-TSC, G-ESL ≤ baseline.
**Rollback:** `git revert <C7>` (user-run), then `npm ci` in `src/frontend`.
**Acceptance Criteria:**
- `next build` succeeds with only the root layout and not-found, and Vite dev still runs on 5173.

**Notes:** Config group. Never print secret values (presence checks only), and repeat this rule in any subagent prompt.

---

### Task Group 9: App Router Route Tree (B2)
**Dependencies:** 8
**Files to Modify:** `src/frontend/src/app/(site)/**`, `src/frontend/src/app/(standalone)/**`, `src/frontend/src/app/admin/**` (61 `page.tsx`, 7 layouts per spec §6.1), `src/frontend/src/routing/{ClientOnly.tsx,reservedSlugs.ts}` (new), `src/frontend/src/features/panel/*` (AppRoute gate logic extracted for the panel layout), `src/frontend/src/features/items/product/OrganizerItemLayout.tsx`, `src/frontend/src/test/routeManifest.test.ts` (new), `src/frontend/src/test/reservedSlugs.test.ts` (new), `src/frontend/src/test/{addRoute,messagesRoutes,EventPage}.test.tsx`
**Estimated Steps:** 9

- [ ] 9.0 Build the 61-page route tree with thin pages and layouts (R9, R19)
  - [ ] 9.1 Write 4–5 tests.
    - `test/routeManifest.test.ts` (2–3): node `fs` walk of `src/app/**/page.tsx` → patterns (strip `(group)`, `[x]` → `:x`, `[[...x]]` → `*`) equal an explicit 61-entry inventory; every `routing/paths.ts` helper output (sample ids) matches a pattern via `matchPath`.
    - `test/reservedSlugs.test.ts` (2): (a) every top-level static segment outside groups is in `routing/reservedSlugs.ts`; (b) every TS entry is in the backend `RESERVED_SLUGS` parsed from `src/backend/app/organizations/slugs.py`, reusing the `organizerKeyParity.test.ts` approach.
  - [ ] 9.2 `routing/ClientOnly.tsx`: renders `null` until mounted, using a `useSyncExternalStore` mounted flag. `routing/reservedSlugs.ts` holds the spec §6.3 list (includes `home`).
  - [ ] 9.3 `(site)/layout.tsx` (PublicLayout chrome), `(site)/page.tsx` (LandingPage), `login`, `product/[id]` and `product/[id]/edit`. The edit route uses a server `redirect()` with awaited `params`.
  - [ ] 9.4 `(site)/(panel)/layout.tsx`: ClientOnly plus today's AppRoute gate on `useAppPathname()`.
    - anonymous at `/`: `clearSession()` + LandingPage;
    - anonymous at `/add`: PhoneFrame + PublicAddView;
    - otherwise AuthGuard → AppDataProvider → AppPage.
    `children` is ignored. Add the 26 panel `page.tsx` stubs returning `null`.
  - [ ] 9.5 `(site)/(member)/layout.tsx` (ClientOnly + AuthGuard) with the 4 pages. `[organizationSlug]/(owner)/layout.tsx`: a placeholder server layout (ServerThemeProvider comes in C1). Add the owner page, items/meetings/terms, the `product` → `/${organizationSlug}` redirect, and `product/[id]/layout.tsx` (OrganizerItemLayout providing `OrganizerItemContext` around `children`) with its index and `edit` redirect. Add the event and term pages. Do not add `group/[groupId]` (D11 → 404).
  - [ ] 9.6 `(standalone)/layout.tsx` (ClientOnly + AuthGuard, no chrome) with onboarding, organization and `oauth2/authorize`. `admin/layout.tsx` (ClientOnly + **AuthGuard only** + PluginProvider + AppShell), the `admin/page.tsx` redirect, and 15 admin pages including `plugins/[pluginId]/[[...path]]`.
  - [ ] 9.7 Replace the route-table imports in `addRoute.test.tsx`, `messagesRoutes.test.tsx` and `EventPage.test.tsx` with manifest assertions. The executor records each replaced test id in the work-log as a documented replacement.
  - [ ] 9.8 Run the 9.1 tests, then gate: G-NB, G-VT (Vite still runs the app; ⊇ A0 minus documented replacements), G-TSC `tsc -b`, G-ESL.
  - [ ] 9.9 Commit C8 `feat(frontend): B2 App Router route tree` (stage `src/frontend` only).

**Checkpoint gate:** G-NB, the manifest and parity tests green, G-VT, G-TSC, G-ESL.
**Rollback:** `git revert <C8>` (user-run). Revert C9+ first if they exist.
**Acceptance Criteria:**
- Exactly 61 page patterns exist, and the reserved-slug parity includes `home`.
- Every page file is a thin wrapper, and legacy URLs redirect on the server.

---

### Task Group 10: Router Seam Swap to Next (B3)
**Dependencies:** 9
**Files to Modify:** `src/frontend/src/routing/navigation.tsx`, `src/frontend/src/test/renderWithRoute.tsx`, `src/frontend/src/test/navigationMock.ts` (new), `src/frontend/src/test/nextLinkMock.tsx` (new), `src/frontend/src/test/navigationMock.test.tsx` (new), `src/frontend/vitest.config.ts`, `src/frontend/src/router.tsx` (delete), `src/frontend/src/main.tsx` (delete), `src/frontend/index.html` (delete), `src/frontend/src/vite-env.d.ts` (delete), `src/frontend/vite.config.ts` (delete), `src/frontend/package.json`, `src/frontend/package-lock.json`, `src/frontend/eslint.config.js`, `src/frontend/src/lib/googleMaps.ts`, `src/frontend/src/test/{orgPalette,googleMaps,LocationPicker,PlacesView}.test.ts(x)`, `src/frontend/src/resources/static/assets/plugin-sdk.js` (delete, if present), `package.json` (repo root)
**Estimated Steps:** 9

- [ ] 10.0 Run the app on Next with feature code unchanged (R10, R16, R20, R21)
  - [ ] 10.1 Write 2–4 tests in `src/test/navigationMock.test.tsx`: push/replace/back update the URL store and are recorded; `useParams` comes from the `pattern`; `redirect`/`notFound` throw sentinels; the core keeps working after `vi.resetAllMocks()`.
  - [ ] 10.2 Re-implement `routing/navigation.tsx` on `next/navigation` (`useRouter`, `usePathname`, `useSearchParams`, `useParams`) and `next/link`, keeping the public API identical. Search-param updates use `router.replace/push(url, { scroll: false })`, and `useRouterRefresh` → `router.refresh()`.
  - [ ] 10.3 Create `test/navigationMock.ts` (URL store via `useSyncExternalStore`, recorded calls, sentinels, plain functions) and `test/nextLinkMock.tsx`. In `vitest.config.ts`, add `resolve.alias` from `next/navigation` and `next/link` to the mocks. Switch `renderWithRoute` to the mock: it renders the matching `routes` entry for the current mock pathname. Test files are unchanged.
  - [ ] 10.4 Delete `router.tsx`, `main.tsx`, `index.html`, `vite-env.d.ts`, `vite.config.ts`, and the `react-router-dom`, `@tailwindcss/vite` and `eslint-plugin-react-refresh` deps. Keep `vite` + `@vitejs/plugin-react` for Vitest and the SDK. Delete the stale `src/resources/static/assets/plugin-sdk.js` if present.
  - [ ] 10.5 Scripts:
    - `dev` = `next dev -p 5173`, `build` = `next build`, `start` = `next start -p 5173`;
    - `predev`/`prebuild` = `npm run build:sdk` (IIFE into `public/assets/plugin-sdk.js`);
    - `typecheck` = `tsc --noEmit`, `lint` = `eslint .`;
    - drop `preview`;
    - update the repo-root `web`/`dev:all`.
  - [ ] 10.6 Env and CSS:
    - `lib/googleMaps.ts` reads `process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (static reference);
    - `vi.stubEnv` uses the new name in its 3 tests;
    - `orgPalette.test.ts` reads `src/app/globals.css`;
    - delete `src/index.css`;
    - grep shows no `import.meta.env` left.
    Never print env values.
  - [ ] 10.7 ESLint: `no-restricted-imports` for `next/navigation`/`next/link` outside `src/routing/**` and the test mocks. `react-router-dom` is now banned everywhere.
  - [ ] 10.8 Gate:
    - G-VT ⊇ A0 (documented replacements only);
    - G-TSC `tsc --noEmit`;
    - G-NB;
    - G-ESL;
    - `npm run dev` serves `/` on 5173 (HTTP 200 via `curl -s -o /dev/null -w "%{http_code}"`);
    - `/assets/plugin-sdk.js` returns 200.
    Stop the dev server afterwards.
  - [ ] 10.9 Commit C9 `refactor(frontend): B3 switch to Next, drop Vite entry` (stage `src/frontend` + root `package.json` only).

**Checkpoint gate:** G-VT, G-TSC (`--noEmit`), G-NB, G-ESL, the dev server serving `/` and the SDK on 5173, no `react-router-dom`/`import.meta.env`, no `src/pages`.
**Rollback:** `git revert <C9>` (user-run), then `npm ci`. Back to Vite + RR with the scaffold present. Requires reverting C10+ first.
**Acceptance Criteria:**
- The 2–4 mock tests pass, the feature code diff is zero for this group (seams only), and the app runs on Next.

**Notes:** Touches env variable names. Presence checks only, never print values, and repeat this rule in any subagent prompt.

---

### Task Group 11: Request Proxy (B4)
**Dependencies:** 10
**Files to Modify:** `src/frontend/src/proxy.ts` (new), `src/frontend/src/test/proxy.test.ts` (new)
**Estimated Steps:** 6

- [ ] 11.0 Add the rewrite, redirect and gate before render (R11)
  - [ ] 11.1 Write 6–8 tests in `src/test/proxy.test.ts` against the exported pure function:
    - `/home` → 307 `/` with the search kept;
    - `/` + cookie → rewrite `/home`;
    - `/` without a cookie → next;
    - `POST /oauth2/authorize` → external rewrite to `BACKEND_INTERNAL_URL`, while GET falls through;
    - a gated prefix without a cookie → `/login?returnTo=` (same format as `authPath`);
    - `/add` is not gated and `/add/product` is;
    - segment boundary (`/groupsx` not gated);
    - the matcher regex excludes `/api/…`, `/_next/…`, `/assets/…`, `/.well-known/…`, `favicon.svg` and `icons.svg`.
  - [ ] 11.2 Implement `src/proxy.ts` with the spec §8 rules in order, as a cookie-presence check only (no JWT verification). It uses `PROTECTED_PREFIXES` from `routing/paths.ts` and `authPath` from `auth/authPaths.ts`.
  - [ ] 11.3 Matcher: `/((?!api/|_next/|assets/|\.well-known/|favicon\.svg|icons\.svg).*)`. `BACKEND_INTERNAL_URL` is server-only, with dev default `http://localhost:8080`.
  - [ ] 11.4 Run the 11.1 tests, then G-VT, G-TSC `--noEmit`, G-NB, G-ESL.
  - [ ] 11.5 Manual checks with `next dev -p 5173` and `curl -I`:
    - `/home` → 307 `/`;
    - `/meetings` without a cookie → 307 to `/login?returnTo=%2Fmeetings`;
    - `/` with a dummy cookie returns 200;
    - `/api/health` is not intercepted.
    Stop the server afterwards.
  - [ ] 11.6 Commit C10 `feat(frontend): B4 proxy.ts` (stage `src/frontend` only).

**Checkpoint gate:** the proxy tests, G-VT, G-TSC, G-NB, G-ESL, and the manual curl checks.
**Rollback:** `git revert <C10>` (user-run). Logged-in `/` then shows the landing until the client reconciles: acceptable when rolling back.
**Acceptance Criteria:**
- The 6–8 proxy tests pass, and `/api/*` is never matched.

---

### Task Group 12: Server Metadata & Organizer Palette (C1)
**Dependencies:** 11
**Files to Modify:** `src/frontend/src/api/server.ts` (new), `src/frontend/src/lib/publicMetadata.ts` (new), `src/frontend/src/theme/ServerThemeProvider.tsx` (new), `src/frontend/src/theme/OrganizerThemeScope.tsx`, `src/frontend/src/app/(site)/[organizationSlug]/(owner)/{layout.tsx,page.tsx}`, `src/frontend/src/app/(site)/[organizationSlug]/event/[eventId]/page.tsx`, `src/frontend/src/app/(site)/[organizationSlug]/group/[groupId]/term/[termId]/page.tsx`, `src/frontend/src/features/{owner-page,events,terms}/**` (duplicate client `<title>` removal only), `src/frontend/src/test/publicMetadata.test.ts` (new), `src/frontend/src/test/serverTheme.test.tsx` (new)
**Estimated Steps:** 8

- [ ] 12.0 Put OG tags and the palette into the first HTML response (R12)
  - [ ] 12.1 Write 8 tests.
    - `publicMetadata.test.ts` (6 functions, table-driven `it.each` porting the 10 kept cases from `src/backend/tests/test_public_preview.py`, expected strings copied verbatim): organization; event with location and description; event without location; term with term and description; term without term (`Dołącz i zobacz najbliższe spotkania.`); fallback (party UUID / reserved / not found / invalid UUID / null data → default, no OG), plus escaping/backslash values passed through unchanged; twitter `summary_large_image` vs `summary`.
    - `serverTheme.test.tsx` (2): initial CSS vars come from `resolveOrgTheme`; live `theme` overrides `initialTheme`.
  - [ ] 12.2 `api/server.ts` (`import "server-only"`): `serverGet<T>(path)` = `fetch(BACKEND_INTERNAL_URL + "/api" + path, { cache: "no-store" })`. It is anonymous, returns `null` on error or non-2xx, and is wrapped in React `cache()`.
  - [ ] 12.3 `lib/publicMetadata.ts`: pure DTO → `Metadata` ports of the three formatters (spec §9). Event weekdays are `pon, wt, śr, czw, pt, sob, ndz`, taken from the naive `starts_at` with no TZ conversion (time.md).
  - [ ] 12.4 `generateMetadata` in `(owner)/page.tsx` (skipped for UUID/party slugs and `krag`), the event page and the term page. Remove a duplicate client `<title>` only where the server now sets the same title.
  - [ ] 12.5 `theme/ServerThemeProvider.tsx`: a context with the initial `OrganizerTheme`, plus a `display: contents` wrapper with inline CSS vars. `OrganizerThemeScope` uses `theme ?? initialTheme`. Wire it into `(owner)/layout.tsx` (org response; best effort, never `notFound`), the event page (`event.organization`) and the term page (`circle.organization`). There is no provider for `krag`, UUID or a missing org.
  - [ ] 12.6 Run the 12.1 tests, then G-VT, G-TSC `--noEmit`, G-NB, G-ESL.
  - [ ] 12.7 With the backend on 8080 and `next dev -p 5173`, run `curl -s -A facebookexternalhit http://localhost:5173/<org-slug>` (also the event and term URLs from dev data). `og:title`, `og:description` and the image tags must be present. Record the output in `verification/gates/og-C11.txt`, with tokens stripped and no secrets.
  - [ ] 12.8 Commit C11 `feat(frontend): C1 server metadata + palette` (stage `src/frontend` only).

**Checkpoint gate:** 8 new tests, G-VT (the `test_public_preview.py` → Vitest port documented), G-TSC, G-NB, G-ESL, and the curl OG check on 3 page kinds.
**Rollback:** `git revert <C11>` (user-run). Revert C12 first, or together with it, otherwise OG tags are lost entirely.
**Acceptance Criteria:**
- OG/Twitter tags are present in the SSR HTML of org, event and term pages, and the palette is visible on first paint.
- Private-circle fallback to the default metadata is documented in the work-log (accepted).

**Notes:** Server fetches use `BACKEND_INTERNAL_URL`. Never print env values, and repeat the rule in any subagent prompt.

---

### Task Group 13: Backend OG & SPA-Fallback Removal (C2)
**Dependencies:** 12
**Files to Modify:** `src/backend/app/system/public_preview.py` (delete), `src/backend/app/system/router.py`, `src/backend/app/main.py` (static mount / docstrings, if referenced), `src/backend/tests/test_public_preview.py` (delete), `src/backend/tests/test_unknown_page_404.py` (new; or added to the existing system-router test file), `src/backend/app/core/authorization_matrix.py` (docstring/comment only, if it mentions the fallback)
**Estimated Steps:** 6

- [ ] 13.0 Stop serving HTML from the backend (R13)
  - [ ] 13.1 Write 1 test: `GET /some-page` → 404 with the existing JSON envelope (`error == "Not Found"`).
  - [ ] 13.2 Delete `app/system/public_preview.py`, the four preview routes, `spa_fallback`, `STATIC_DIR`/`INDEX_HTML` (`app/system/router.py:65–183`) and `tests/test_public_preview.py` (11 tests: 10 ported in C11, the circle-without-term case dropped per D11). Keep `GET /api/health`.
  - [ ] 13.3 Re-check `AUTHORIZATION_MATRIX`: no row references the removed routes, and the `^.*$` catch-all row stays. The executor records this in the work-log. Update module docstrings that mention the SPA fallback.
  - [ ] 13.4 Remove any static-file mount of `/app/static` in `app/main.py` if present (grep `StaticFiles`, `static`).
  - [ ] 13.5 Run G-PY (no new failures; −11 deleted tests documented), G-RUFF, G-MYPY ≤ 15.
  - [ ] 13.6 Commit C12 `refactor(backend): C2 remove OG injection + SPA fallback` (stage `src/backend` only).

**Checkpoint gate:** G-PY, G-RUFF, G-MYPY ≤ 15, and the 404 test green.
**Rollback:** `git revert <C12>` (user-run, independent). This restores the preview routes and fallback, which are harmless while nginx routes pages to Next. If C6 is reverted too, revert C12 first.
**Acceptance Criteria:**
- Unknown page paths return a JSON 404, and the backend no longer references `index.html`.

---

### Task Group 14: Deploy Runtime (D)
**Dependencies:** 13
**Files to Modify:** `src/frontend/Dockerfile`, `src/frontend/nginx.conf`, `docker-compose.yml`, `.env.example`, `.claude/launch.json`, `src/frontend/next.config.ts` (only if `outputFileTracingRoot` is needed)
**Estimated Steps:** 7

- [ ] 14.0 Run Next standalone behind nginx (R14)
  - [ ] 14.1 No new tests (infrastructure). Verification is `docker compose build` and the compose smoke item 16, prepared in group 17.
  - [ ] 14.2 Dockerfile (context = repo root):
    - `deps` stage: `npm ci`;
    - `build` stage: ARG `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `npm run build` (includes the SDK);
    - `runner` stage, node:22-alpine: copy `.next/standalone`, `.next/static`, `public`; `ENV PORT=3000 HOSTNAME=0.0.0.0 TZ=Europe/Warsaw`; `CMD node server.js`.
    Set `outputFileTracingRoot` if the standalone tree nests wrongly.
  - [ ] 14.3 nginx.conf:
    - `/api/` → backend (`client_max_body_size 16m`);
    - `= /oauth2/authorize` → `web:3000`;
    - `/oauth2/` → backend;
    - `/.well-known/` → backend;
    - `/` → `web:3000`.
    All forward `Host`, `X-Forwarded-For` and `X-Forwarded-Proto`. Remove `@backend_fallback`.
  - [ ] 14.4 docker-compose.yml:
    - delete `frontend-build`, the `frontend_index` volume, the backend `/app/static` mount and the related `depends_on`;
    - add `web` (`BACKEND_INTERNAL_URL=http://backend:8080`);
    - rename the build arg to `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`;
    - keep the CORS default `http://localhost:5173`.
  - [ ] 14.5 `.env.example`: placeholder rename only. In the user's local `.env` files, check by presence (e.g. `grep -c '^NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=' .env`) and report whether the rename is still pending. Never print or copy values. Edit a `.env` only if the user approves, and never echo it.
  - [ ] 14.6 `.claude/launch.json`: check that the frontend entry runs `npm run dev` on 5173. The plugins keep `http://localhost:5173/assets/...`.
  - [ ] 14.7 Gate: `docker compose build` succeeds (build logs filtered: no `--progress=plain` dump of build args). G-VT and G-NB still green. The C13 commit happens in group 17.

**Checkpoint gate (C13, part 1):** `docker compose build` succeeds; G-NB.
**Rollback:** part of C13: `git revert <C13>` (user-run). A partial revert of the deploy files alone on top of C9+ leaves compose pointing at the removed Vite `dist/index.html`. Revert the whole of C13.
**Acceptance Criteria:**
- Compose builds the `web` image and nginx routes as specified.

**Notes:** Config/infrastructure group. Never print secret values (no `env`, `printenv`, `cat .env`, or `docker inspect` Env; presence checks only), and never write values into artifacts. Every subagent prompt for this group must repeat this rule.

---

### Task Group 15: Docs & Standards (D)
**Dependencies:** 13
**Files to Modify:** `.maister/docs/project/tech-stack.md`, `.maister/docs/project/architecture.md`, `.maister/docs/standards/frontend/components.md`, `.maister/docs/standards/frontend/accessibility.md`, `.maister/docs/standards/frontend/data-fetching.md`, `.maister/docs/standards/testing/frontend-testing.md`, `.maister/docs/standards/backend/security.md`, `.maister/docs/standards/backend/plugin-auth.md`, `plugins/CLAUDE.md`, `.maister/docs/INDEX.md`
**Estimated Steps:** 6

- [ ] 15.0 Update project docs and standards per spec §11 (R15)
  - [ ] 15.1 No new tests (docs). Check with grep that `pages/` paths, `MemoryRouter`, `main.tsx`, `import.meta.env` and `VITE_GOOGLE_MAPS_API_KEY` no longer appear in the standards except as historical notes.
  - [ ] 15.2 `tech-stack.md`: frontend section covering Next 16.4, Turbopack, scripts, env var and the SDK build. `architecture.md`: deploy topology (nginx → web/backend), OG via `generateMetadata`, `proxy.ts`, the cookie, ports (fix the 5173 vs 5174 line), and that the backend no longer serves HTML.
  - [ ] 15.3 `components.md`, `accessibility.md`: `pages/...` paths → `features/...`, and the facade rule (router APIs only via `src/routing/`). `data-fetching.md`: `getQueryClient()`, `providers.tsx`, and server fetches only through `api/server.ts` (anonymous, `no-store`).
  - [ ] 15.4 `frontend-testing.md`: `renderWithRoute`, `getTestLocation`, navigation-mock aliasing, `tsc --noEmit` (replaces the per-file MemoryRouter `renderWithProviders`). `security.md`: cookie accepted on GET/HEAD only, `Vary: Authorization, Cookie`.
  - [ ] 15.5 `plugin-auth.md`, `plugins/CLAUDE.md`: the host runs on Next; SDK path and port unchanged.
  - [ ] 15.6 Refresh the `INDEX.md` summaries for every changed file. The C13 commit happens in group 17.

**Checkpoint gate (C13, part 2):** the grep check in 15.1; INDEX.md consistent with the changed files.
**Rollback:** part of C13 (`git revert <C13>`, user-run). Docs only, no runtime impact.
**Acceptance Criteria:**
- Every file in spec §11 is updated, and INDEX.md reflects them.

---

### Task Group 16: Migration Test Gap Review
**Dependencies:** 13
**Files to Modify:** `src/frontend/src/test/*.test.ts(x)` (new gap tests only), `src/backend/tests/test_*.py` (new gap tests only)
**Estimated Steps:** 4

- [ ] 16.0 Review and fill critical gaps
  - [ ] 16.1 Review the tests added in groups 4–7 and 9–13 (40–54 tests) against R1–R21.
  - [ ] 16.2 Find the gaps for THIS migration only. Candidates: panel layout stale-cookie → `clearSession` + landing; `useAppPathname` on `/home` keeps BottomNav "Start" active; `(owner)` layout never calls `notFound` on a fetch error; the `api/server.ts` `null` on non-2xx; `OrganizerItemContext` under the Next layout.
  - [ ] 16.3 Write up to 10 additional strategic tests (frontend-testing / backend-testing standards: explicit `vitest` imports, typed fixtures, per-test QueryClient).
  - [ ] 16.4 Run the new tests, then G-VT (and G-PY if backend tests were added). The C13 commit happens in group 17.

**Checkpoint gate (C13, part 3):** all feature tests green; G-VT ⊇ A0.
**Rollback:** part of C13 (`git revert <C13>`, user-run).
**Acceptance Criteria:**
- No more than 10 tests added, and all of them pass.

---

### Task Group 17: Smoke Checklist Preparation
**Dependencies:** 14, 15, 16
**Files to Modify:** `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs/verification/smoke-checklist.md` (new), `.maister/tasks/migrations/2026-11-02-frontend-vite-to-nextjs/verification/smoke-run-instructions.md` (new)
**Estimated Steps:** 6

- [ ] 17.0 Prepare (not execute) the Phase 6 Playwright MCP smoke (R15)
  - [ ] 17.1 No new tests. Self-check: the checklist has one row per spec §12 item (16) and per requirements §3.5 route.
  - [ ] 17.2 Write `verification/smoke-checklist.md`, one row per item: id, URL/action, expected result, evidence to capture (snapshot / console / network / curl), the risk tag it covers (rewrite pathname + hydration warning (item 2), Emotion FOUC (item 13/10), OAuth2 forwarded host (item 14), 15 MB body (item 16)), and an empty pass/fail column.
  - [ ] 17.3 Write `verification/smoke-run-instructions.md`:
    - backend on 8080 (`cd src/backend && uv run uvicorn app.main:app --host 0.0.0.0 --port 8080`, with a stale-uvicorn check on 8080);
    - frontend `cd src/frontend && npm run dev` (= `next dev -p 5173`, SDK pre-built);
    - compose items via `docker compose up` on 5174;
    - test accounts (ADMIN, EDIT-only `editor`), named by role only, with no passwords in the file;
    - how to set a stale cookie (item 4);
    - the curl OG command (item 10);
    - where to save screenshots (`verification/smoke/`).
  - [ ] 17.4 Secrets: the instructions state presence-only env checks and forbid pasting tokens or keys into the report.
  - [ ] 17.5 Final C13 gate, run together: G-VT ⊇ A0, G-TSC `--noEmit`, G-NB, G-ESL ≤ baseline; G-PY, G-RUFF, G-MYPY ≤ 15; `docker compose build`; spec success-criteria greps (no `react-router-dom`, no `src/pages`, no `import.meta.env`, manifest = 61).
  - [ ] 17.6 Commit C13 `build: D deploy (Next standalone) + docs + smoke checklist`. Stage the groups 14–17 paths explicitly: `src/frontend`, `docker-compose.yml`, `.env.example`, `.claude/launch.json`, `.maister/docs`, `plugins/CLAUDE.md`, `src/backend/tests` (if gap tests were added), and this task folder. The smoke results from Phase 6 are added later to the task folder.

**Checkpoint gate:** the full C13 gate in 17.5.
**Rollback:** `git revert <C13>` (user-run), then rebuild compose. Revert all of C13 rather than parts of it.
**Acceptance Criteria:**
- The checklist covers all 16 items with run instructions, and C13 exists on `main`.

---

## Execution Order

1. Group 1: User WIP Checkpoint, C0 (5 steps)
2. Group 2: Baseline Capture, C1 (7 steps, depends on 1)
3. Group 3: Feature-Folder Reorganisation, C2 (9 steps, depends on 2)
4. Group 4: SSR-Safety & Query Client, C3 (8 steps, depends on 3)
5. Group 5: Navigation Facade on React Router, C4 (11 steps, depends on 4)
6. Group 6: Session Cookie — Frontend, C5 (7 steps, depends on 5)
7. Group 7: Backend Cookie Read, Vary & Reserved Slug, C6 (8 steps, depends on 2; commits after C5)
8. Group 8: Next.js Scaffold, C7 (8 steps, depends on 6)
9. Group 9: App Router Route Tree, C8 (9 steps, depends on 8)
10. Group 10: Router Seam Swap to Next, C9 (9 steps, depends on 9)
11. Group 11: Request Proxy, C10 (6 steps, depends on 10)
12. Group 12: Server Metadata & Organizer Palette, C11 (8 steps, depends on 11)
13. Group 13: Backend OG & SPA-Fallback Removal, C12 (6 steps, depends on 12)
14. Group 14: Deploy Runtime, part of C13 (7 steps, depends on 13)
15. Group 15: Docs & Standards, part of C13 (6 steps, depends on 13)
16. Group 16: Migration Test Gap Review, part of C13 (4 steps, depends on 13)
17. Group 17: Smoke Checklist Preparation, commits C13 (6 steps, depends on 14, 15, 16)

The dependencies and disjoint files allow two kinds of concurrency.
- Group 7 (backend only) can proceed alongside groups 3–6 (frontend only). Its C6 commit waits for C5.
- Groups 14, 15 and 16 can proceed alongside each other after C12.

Everything else is strictly sequential. Commits always land in C-number order with path-scoped staging. The C9 swap also needs groups 5 (facade) and 9 (route tree), which the chain already satisfies.

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- global/: minimal-implementation (stub pages, no speculative abstractions, no D7 file splits), conventions (env rename in `.env.example`), error-handling, coding-style, commenting.
- frontend/: data-fetching (hooks/API layers unchanged, one browser QueryClient via `getQueryClient()`), components (view-state modules untouched, the facade rule), accessibility (the editor guard keeps focus behaviour), css (Tailwind v4 via postcss, `globals.css` verbatim).
- testing/frontend-testing.md: explicit `vitest` imports, a fresh QueryClient per test, typed fixtures with no casts, flat `src/test/`, `it.each` for tables.
- testing/backend-testing.md: flat `tests/test_<feature>.py`, exact header assertions updated and never loosened, real PostgreSQL via testcontainers, `uv run python -m pytest|ruff|mypy` from `src/backend`.
- backend/security.md: cookie on safe methods only, `Vary`. backend/time.md: Warsaw naive strings formatted without conversion. backend/plugin-auth.md: `getToken` still returns the JWT.
- CLAUDE.md secrets rule: presence checks only, no values in tool output, artifacts or commits. It is repeated in every config/deploy group and must be repeated in their subagent prompts.

## Notes

- Test-driven: each code group starts with its 2–8 tests. Groups 1–3, 8 and 14–15 add no code that can be tested, which is stated in each.
- Run incrementally: run only the new tests while iterating, then the standard gate at the checkpoint.
- Mark progress: check off steps as they complete. The HTML companion uses `data-group`/`data-step` markers.
- Reuse first: path helpers move unchanged, AppRoute logic is ported into the panel layout, `resolveOrgTheme` is reused on the server, and the `organizerKeyParity` parsing approach is reused for the reserved slugs.
- Agents never run destructive git commands. Every rollback (`git revert`, `git reset --hard`) is listed for the user to run.
