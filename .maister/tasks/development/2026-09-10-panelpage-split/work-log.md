# PanelPage.tsx split — work log

**Goal**: split `src/frontend/src/pages/panel/PanelPage.tsx` (2212 lines, one component:
7 views + 6 modals + ~50 useState + ~25 handlers) into per-view / per-concern files.
**Constraint**: zero behaviour change (memory `feedback_prototype_port_fidelity` — keep exact UX).
**Delivery**: incremental commits directly to `main` (user: not production).

## Baseline (2026-09-10, before any change)

- `npx vitest run src/test/PanelPage.test.tsx` → **55 passed**
- `npm test` (full) → **182 passed, 2 failed** — the 2 fails are PRE-EXISTING and unrelated:
  `src/test/auth.test.tsx` (AuthContext mock shape drift) and
  `src/test/extension-points.test.tsx` (plugin-filter iframe assertion).
- `npx tsc -b --noEmit` → **4 errors, all `src/test/auth.test.tsx`**. None in `src/pages/`.
- `npm run lint` → **19 errors + 2 warnings, all `src/test/*`** (`no-explicit-any` in plugin-sdk tests).

**Gate per step**: `PanelPage.test.tsx` stays 55 green; `npm test` stays 182/2; tsc adds no
error outside `auth.test.tsx`; lint adds no finding in `src/pages/panel`. Format: n/a (eslint only).

## Steps

### Step 1 — helpers / icons / small components — DONE — commit `6b43cbf`
- `panelHelpers.ts` (types + label/style maps + `capitalize`/`dayMonth`/`initials`/`termPublicPath`)
- `panelIcons.tsx` (~15 SVG icon components)
- `panelComponents.tsx` (`ToggleRow`, `HintCard`, `Field`, `ModalSheet`) — `Field` + `ModalSheet`
  moved out of `PanelPage.tsx`; the 4 `components/panel/*` importers repointed.
- `NAV_ITEMS` kept module-local in `PanelPage.tsx` (references icon components; keeps
  `panelIcons.tsx` component-only for `react-refresh/only-export-components`).
- PanelPage.tsx: **2212 → 1949 lines**. Gate: 55/55, 182/2, no new tsc/lint. ✓

Decision: **Context** (`PanelDataProvider` + `usePanelData()`) — matches `AuthContext`/`PluginContext`.
Do the whole split this session (~10 commits).

### Step 2a — PanelDataProvider + usePanelData() — DONE — commit `e6a8b71`
- `PanelDataContext.tsx` (857) — Provider, verbatim state layer (all hooks, `useAuth`, every handler,
  `organizerTermCard`, derived incl. `isTopLevel`). `load` stays `useCallback([])`.
- `panelDataStore.ts` (16) — `createContext` + `usePanelData()` hook. Hookless `.ts` sibling: keeps
  `PanelDataContext.tsx` a component-only export (`react-refresh/only-export-components`) and dodges
  the Windows case-collision with a `panelDataContext.ts` name.
- `PanelPage.tsx` 1949 → **1358** — `PanelPage()` → `<PanelDataProvider><PanelPageView/></>`;
  `PanelPageView()` consumes the hook, does loading/error early-returns, renders verbatim.
- Gate: tsc 4 pre-existing only · eslint clean · PanelPage.test 55/55 · full suite 182/2. ✓

### Step 2b — extract 7 views → views/*.tsx — IN PROGRESS
### Step 2c — extract 6 modals + header/nav — PENDING
