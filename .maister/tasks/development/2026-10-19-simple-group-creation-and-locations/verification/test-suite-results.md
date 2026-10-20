# Test Suite Results

**Status:** passed_with_issues (no new regressions; only known baseline failures)
**Date:** 2026-10-20
**Task:** simple group creation + Location entity + "Moje miejsca" + removal of term formalize

## Summary

| Suite | Command | Result |
|---|---|---|
| Backend pytest | `uv run python -m pytest -q -p no:cacheprovider` (src/backend, Docker up) | 869 passed, 0 failed, 0 errors, 0 skipped (430 s) |
| Backend mypy | `uv run python -m mypy app` | 32 errors in 12 files (= baseline 32) |
| Backend ruff | `uv run python -m ruff check` | 95 findings (pre-existing; no net increase in changed files) |
| Frontend vitest | `npx vitest run` (src/frontend) | 979 passed, 6 failed / 985 (99.4%); 5 of 88 files failed |
| Frontend tsc | `npx tsc -b` | exit 0, no errors |
| Frontend lint | `npm run lint` | 16 problems (15 errors, 1 warning) (= baseline 16, all in untouched files) |

Combined test pass rate: 1848 / 1854 = 99.7%.

## Frontend failures (all baseline, fail at HEAD)

| Test | File | Classification |
|---|---|---|
| AuthContext > provides token/permissions/login/logout via useAuth hook | src/test/auth.test.tsx | baseline |
| Frontend Foundation > renders AppShell with sidebar and content area | src/test/foundation.test.tsx | baseline |
| ProductListPage with plugin filters > renders plugin filter iframes in filter bar | src/test/extension-points.test.tsx | baseline |
| Sidebar with plugin menu items > renders hardcoded items then plugin menu items | src/test/extension-points.test.tsx | baseline |
| TermPage — sign-up footer > anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice | src/test/TermPage.test.tsx | baseline |
| PanelPage — delete group (soft delete) > 409 message is shown inline in the dialog | src/test/PanelPage.test.tsx | baseline |

The 6 failures match the known baseline list exactly (auth ×1, foundation ×1, extension-points ×2, TermPage anonymous ×1, PanelPage 409 ×1). OrganizerEditor (known flaky) passed this run. No new regressions.

## Backend

- All 869 tests passed. The known flaky `test_lend_step0_fixes::test_listMyLentOutItems_lentItem_listedForOwnerWithBorrowerAndDueDate` passed, so no isolated re-run was needed.
- No `formalize` references remain in `app/` or `tests/`.
- Note: some warning paths point to `C:\Users\karas\Desktop\group-thing-app\...`, which does not exist. These are probably stale `__pycache__` paths from before the repo was moved. The tests themselves run from the swaptime checkout.
- About 39.7k DeprecationWarnings (`datetime.utcnow()`), all from code that existed before this task.

## Ruff: per changed file (HEAD vs working tree, compared via stdin)

| File | HEAD | Now |
|---|---|---|
| app/groups/application/circles.py | 4 | 4 (E501 only) |
| app/groups/application/memberships.py | 4 | 4 |
| app/groups/application/public_view.py | 3 | 1 |
| app/groups/application/terms.py | 1 | 1 |
| other changed app/test files | 0 | 0 |

New finding introduced: `app/groups/application/memberships.py:21:22 F401 ..models.Group imported but unused` (it replaced an E501 that was removed, so the count is unchanged). It can be fixed with `ruff check --fix`.

## Issues

| Severity | Description | Location | Fixable |
|---|---|---|---|
| info | 6 baseline frontend failures (pre-existing at HEAD) | src/frontend/src/test/* | false (not in scope) |
| info | New unused import `Group` (F401) | src/backend/app/groups/application/memberships.py:21 | true (remove import) |

Issue counts: critical 0, warning 0, info 2.
