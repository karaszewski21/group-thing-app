# Test Suite Results — pages module extraction

## TL;DR
- **Status: passed_with_issues** (⚠️) — 2 failed, 1206 passed (99.83%), 0 errors, 0 skipped, 717.6 s.
- Both failures are **pre-existing** (they fail identically on the untouched tree in `pytest-before.txt`, 2 failed / 1200 passed). **No regressions.**
- The result matches the Group 8 after-run (`pytest-after.txt`) exactly. The 6 extra passing tests compared with baseline are new tests added by this task.

## Key Decisions
- Ran the full backend suite from `src/backend`: `unset VIRTUAL_ENV; uv run python -m pytest -q -p no:cacheprovider`. The suite used testcontainers PostgreSQL 18, and Docker 29.0.1 was available.
- Did not run the frontend suite (vitest): `git status` shows no change under `src/frontend`.

## Metrics

| total | passing | failing | errors | skipped | pass rate |
|---|---|---|---|---|---|
| 1208 | 1206 | 2 | 0 | 0 | 99.83% |

## Failures

| Test | Type | Related to implementation | Regression risk | Assertion |
|---|---|---|---|---|
| `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` | integration | Same area (owner items), but fails identically on the untouched tree | low (pre-existing) | The `nearest` dict differs only in `location_name`: `'Nowa Dęba, podkarpackie'` vs expected `None`. The other 6 items are identical. |
| `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip` | integration (migration) | No | low (pre-existing) | `assert ['circle_group_id'] == ['group_id']`: the index column name differs at index 0. |

## Open Questions / Risks
- Two pre-existing failures are still open and outside the scope of this task. Either the test expectations are stale or the behaviour drifted (term `location_name` exposure; index column renamed by a later migration). They should get a follow-up task.
- The run printed about 56.6k warnings, mostly `datetime.utcnow()` DeprecationWarnings. They are informational only.
