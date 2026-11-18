# Test Suite Results — wants matcher service (MATCH/SUGGESTION tiers)

## TL;DR

**Status: passed_with_issues — 0 regressions.** All three apps were run in full (2026-11-17). Every failure is part of the confirmed pre-existing baseline at HEAD, and every result matches the baseline and the last implementation run.

| App | Tests | Static checks | vs baseline |
|-----|-------|---------------|-------------|
| backend (`src/backend`) | 1515 passed / 2 failed / 0 errors (1517, 17m12s) | mypy 15 errors, ruff 65 | identical |
| matcher (`src/matcher`) | 81 passed / 0 failed (30s) | ruff clean, mypy clean (21 files) | identical |
| frontend (`src/frontend`) | 1853 passed / 33 failed (1886 total; 12 of 176 files failed) | typecheck 0, lint 38 (10 errors, 28 warnings) | identical |

Combined pass rate: 3449 / 3484 = 99.0%. All 35 failures are pre-existing. None of them is in the wants or matcher code.

## Open Questions / Risks

- None from this run. The 35 pre-existing failures stay on the books as known debt, but none touches the changed areas.
- Pass rate alone would read as "Some Failures" (95–99%). With no regressions and an unchanged baseline, the result is "passed_with_issues".

## Commands

- backend (cwd `src/backend`): `uv run --system-certs python -m pytest -q`, `uv run --system-certs python -m mypy app`, `uv run --system-certs python -m ruff check .`
- matcher (cwd `src/matcher`): `uv run --system-certs python -m pytest -q`, `uv run --system-certs python -m ruff check matcher tests`, `uv run --system-certs python -m mypy matcher tests`
- frontend (cwd `src/frontend`): `npx vitest run`, `npm run typecheck`, `npm run lint`
- Extra check: `ruff check` on every changed or new backend `.py` file passes. `eslint` on every changed or new frontend `.ts`/`.tsx` file passes with 0 problems. Of the 15 mypy errors, only `app/main.py:20` (apscheduler `import-untyped`) is in a changed file, and that import is already present at HEAD.

## Backend failures (both pre-existing)

| Test | Error | Type | Related | Regression risk |
|------|-------|------|---------|-----------------|
| `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` | AssertionError: nearest-term dict differs | integration | no | low (baseline) |
| `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip` | `['circle_group_id'] == ['group_id']`: stale column name in an old migration test | integration (migration) | no | low (baseline) |

## Frontend failures (all 33 pre-existing, same 12 files and per-file counts as the baseline)

| File | Failures |
|------|----------|
| `src/test/AppPage.test.tsx` | 12 |
| `src/test/EventPage.test.tsx` | 7 |
| `src/test/PublicLayout.test.tsx` | 3 |
| `src/test/extension-points.test.tsx` | 2 |
| `src/test/routeManifest.test.ts` | 2 |
| `src/test/TermPage.test.tsx` | 1 |
| `src/test/reservedSlugs.test.ts` | 1 |
| `src/test/PendingActionsHost.test.tsx` | 1 |
| `src/test/ParticipantItemsPreview.test.tsx` | 1 |
| `src/test/OrganizerItemRoute.test.tsx` | 1 |
| `src/test/ItemDetailPage.test.tsx` | 1 |
| `src/test/foundation.test.tsx` | 1 |

All of these are unit/component tests unrelated to `features/wanted`, the wants hooks/API or `ItemCard`. None of the wants test files (`WantMatchesView`, `WantedListView`, `WantFormView`, `useWants`, `useWantMatches`, `wantMatchesViewState`) fails.

## Regressions

count: 0

## Issue counts

critical: 0 · warning: 0 · info: 1 (the known pre-existing baseline: 2 backend + 33 frontend test failures, mypy 15, ruff 65, lint 38)
