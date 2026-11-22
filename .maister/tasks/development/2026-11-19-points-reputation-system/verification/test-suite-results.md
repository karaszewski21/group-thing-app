# Test Suite Results (re-run after verification fixes W1–W7)

## TL;DR
- Status: **passed_with_issues** — zero regressions; every failure is the documented pre-existing baseline.
- Backend 1675 passed / 2 failed (previous run 1673/2, so +2 passing); matcher 125/125; vitest 1948 passed / 33 failed (previous 1946/33, +2 passing).
- Static checks equal baseline: mypy 15 errors, ruff 64, `tsc --noEmit` 0.
- The 33 vitest failures match the baseline list name-for-name (normalized diff: 0 new, 0 gone).

## Key Decisions
- The baseline failures (2 backend, 33 vitest) are not counted as regressions, as the orchestrator instructed and as recorded in project memory (HEAD 92659eb, 2026-11-15).

## Open Questions / Risks
- None from this run. The baseline failures are still stale tests that need fixing in a separate task.

## Commands

| Suite | Command | Duration | Result |
|---|---|---|---|
| Backend | `cd src/backend && uv run python -m pytest -q -p no:cacheprovider` | 22m17s | 1675 passed, 2 failed |
| Matcher | `cd src/matcher && uv run python -m pytest -q -p no:cacheprovider` | 2m16s | 125 passed |
| Frontend | `cd src/frontend && npx vitest run` | 111s | 1948 passed, 33 failed (183 files, 12 failed) |
| Typecheck | `npm run typecheck` | — | 0 errors |
| mypy | `uv run python -m mypy app` | — | 15 errors in 8 files (baseline 15) |
| ruff | `uv run python -m ruff check .` | — | 64 errors (baseline 64) |

## Metrics

| | Total | Passing | Failing | Errors | Skipped | Pass rate |
|---|---|---|---|---|---|---|
| Backend | 1677 | 1675 | 2 | 0 | 0 | 99.88% |
| Matcher | 125 | 125 | 0 | 0 | 0 | 100% |
| Vitest | 1981 | 1948 | 33 | 0 | 0 | 98.33% |
| **All** | **3783** | **3748** | **35** | 0 | 0 | **99.07%** |

## Failures

### Backend (both baseline, unrelated to points)
1. `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` — `location_name` is `'Nowa Dęba, podkarpackie'`, test expects `None`. Integration test. Stale test, low regression risk.
2. `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip` — index columns `['circle_group_id'] != ['group_id']`. Migration test. Stale test, low regression risk.

### Vitest (33, all in baseline `2026-11-15-szukam-wanted-mechanism/implementation/baseline/frontend-vitest.txt`)
All are unit/component tests. None touches points code. By file:
- `AppPage.test.tsx` (12), `EventPage.test.tsx` (7), `PublicLayout.test.tsx` (3), `routeManifest.test.ts` (2; the count message shift is the same old failure), `extension-points.test.tsx` (2)
- 1 each: `foundation.test.tsx`, `ItemDetailPage.test.tsx`, `OrganizerItemRoute.test.tsx`, `ParticipantItemsPreview.test.tsx`, `PendingActionsHost.test.tsx`, `reservedSlugs.test.ts`, `TermPage.test.tsx`

## Regressions
count: 0

## Issue counts
critical: 0 · warning: 0 · info: 2 (baseline stale backend tests; baseline 33 vitest failures)
