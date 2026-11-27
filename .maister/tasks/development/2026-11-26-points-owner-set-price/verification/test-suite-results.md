# Test Suite Results — POINTS mode (owner-set price; HOLD/SALE/RELEASE), re-check after verification fixes

## TL;DR

**Status: passed_with_issues.** Every test suite and type check matches its baseline exactly, with no new test failures. The one regression is a single new frontend **lint error**: `src/features/panel/AppDataContext.tsx:145:5` `react-hooks/immutability`. That file was changed in this task. Lint is at 11 errors against a baseline of 10.

| Suite | Result | Baseline | Delta |
|---|---|---|---|
| Backend pytest | 2 failed, 1897 passed (22:38) | 2 failures (same two tests) | 0 |
| Backend mypy | 15 errors in 8 files | 15 | 0 |
| Backend ruff | 64 errors | 64 | 0 |
| Matcher pytest | 125 passed | green | 0 |
| Matcher mypy | no issues (24 files) | green | 0 |
| Matcher ruff | all checks passed | green | 0 |
| Vitest | 32 failed / 2190 passed (2222 tests; 12 of 200 files failing) | 32, same per-file distribution | 0 |
| Typecheck (`tsc --noEmit`) | 0 errors | 0 | 0 |
| Lint (`npm run lint`) | **11 errors / 28 warnings** | 10 / 28 | **+1 error** |

Pass rates: backend 99.89%, matcher 100%, vitest 98.56%.

## Key Decisions

- **The new lint error is attributed to this task.** `git show HEAD:src/frontend/src/features/panel/AppDataContext.tsx | npx eslint --stdin` gives 0 errors and 3 warnings. The working-tree file gives 1 error and 3 warnings. The code that is flagged (`setGroupForm(...)` inside a `useEffect` at line 144/145, before `const [groupForm, setGroupForm] = useState(...)` at line 165/166) already exists at HEAD. The task's edits elsewhere in the same component make the React Compiler rule now report it: the new `itemCreated` state and the `setItems(prev => prev.map(...))` replacing `setItemVisibilityLocally`. `git diff --name-only` lists `AppDataContext.tsx` as modified.
- **Correction to the baseline description.** The 10 old errors are not only in `Icons.tsx` and the `plugins*` files. One of them is `src/auth/AuthContext.tsx:199:17` (`react-refresh/only-export-components`). That file is unchanged in this task, and its HEAD version reports the same error when linted.
- Vitest failures are counted per file and match the baseline exactly: AppPage 12, EventPage 7, PublicLayout 2, extension-points 2, routeManifest 2, and 1 each in foundation, ItemDetailPage, OrganizerItemRoute, ParticipantItemsPreview, PendingActionsHost, reservedSlugs and TermPage. That adds up to 32. They are treated as pre-existing, not as regressions.

## Lint errors (all 11)

| # | File | Line | Rule | Status |
|---|---|---|---|---|
| 1 | `src/auth/AuthContext.tsx` | 199:17 | react-refresh/only-export-components | baseline (file unchanged) |
| 2 | `src/components/shared/Icons.tsx` | 40:17 | react-refresh/only-export-components | baseline |
| 3 | `src/features/panel/AppDataContext.tsx` | 145:5 | react-hooks/immutability ("Cannot access variable before it is declared": `setGroupForm`) | **NEW**, file changed in this task |
| 4 | `src/plugins/host/PluginHost.tsx` | 81:17 | react-refresh/only-export-components | baseline |
| 5 | `src/test/plugin-sdk-auth.test.ts` | 39:60 | @typescript-eslint/no-explicit-any | baseline |
| 6 | `src/test/plugin-sdk.test.ts` | 86:18 | @typescript-eslint/no-explicit-any | baseline |
| 7 | `src/test/plugin-sdk.test.ts` | 108:25 | @typescript-eslint/no-explicit-any | baseline |
| 8 | `src/test/plugins.test.tsx` | 166:58 | @typescript-eslint/no-explicit-any | baseline |
| 9 | `src/test/plugins.test.tsx` | 197:58 | @typescript-eslint/no-explicit-any | baseline |
| 10 | `src/test/plugins.test.tsx` | 246:58 | @typescript-eslint/no-explicit-any | baseline |
| 11 | `src/test/plugins.test.tsx` | 289:58 | @typescript-eslint/no-explicit-any | baseline |

## Backend pytest failures (both baseline)

- `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath`: integration test, pre-existing, low regression risk
- `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip`: migration test, pre-existing, low regression risk

## Commands

- Backend (`src/backend`): `uv run --no-sync python -m pytest -q -p no:cacheprovider`, `uv run --no-sync python -m mypy app`, `uv run --no-sync python -m ruff check`
- Matcher (`src/matcher`): `uv run --no-sync python -m pytest -q`, `uv run --no-sync python -m mypy .`, `uv run --no-sync python -m ruff check .`
- Frontend (`src/frontend`): `npm test`, `npm run typecheck`, `npm run lint`

## Open Questions / Risks

- **Fix the new lint error** (warning severity, fixable: true). Move the `useEffect` that calls `setGroupForm(... defaultVisibility(organizationSlug) ...)` at `AppDataContext.tsx` lines 142–146 to after the `groupForm` `useState` at line 166, or move the `useState` above the effect. Once the setter is declared before the effect reads it, lint should be back at 10 errors.
- The 32 vitest and 2 backend baseline failures are still unresolved technical debt, but they are not caused by this task.

## Issue counts

critical: 0 · warning: 1 (new lint error) · info: 1 (baseline description missed AuthContext)
