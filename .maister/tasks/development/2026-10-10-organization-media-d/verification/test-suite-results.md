# Test Suite Results — organization media (2026-10-10-organization-media-d)

**Run date:** 2026-10-11
**Status:** passed_with_issues (no regressions; only the 17 frontend failures already known at HEAD)

## Summary

| Suite | Command | Total | Passed | Failed | Skipped | Pass rate | Regressions |
|---|---|---|---|---|---|---|---|
| Backend (FastAPI) | `uv run python -m pytest -q -p no:warnings` (src/backend) | 751 | 751 | 0 | 0 | 100% | 0 |
| Frontend (Vitest) | `npx vitest run` (src/frontend) | 818 | 801 | 17 | 0 | 97.9% | 0 |
| group-thing-ai | `uv run pytest -q` (../group-thing-ai) | 147 | 147 | 0 | 0 | 100% | 0 |

- Backend: 751 passed in 338s. The previous full run had 743, so 8 tests were added, and nothing fails.
- Frontend: 74 test files, of which 5 failed and 69 passed. The 17 failures match the known HEAD baseline exactly: PanelPage 8, TermPage 5, extension-points 2, auth 1, foundation 1.
- group-thing-ai: 147 passed. The only warning is a Starlette/httpx deprecation, which is not caused by this change.
- OrganizerEditor did not fail, so it did not need a re-run.

## Frontend failures (all pre-existing baseline)

| File | Count | Failing tests / error |
|---|---|---|
| src/test/PanelPage.test.tsx | 8 | Tests under "hamburger promotion" (6) and "organizer join-request pending action" (2). These raise `Unable to find role="button" name "Menu"` or `"Powiadomienia"`. |
| src/test/TermPage.test.tsx | 5 | Tests under header/content, sign-up footer, access, private group gate and view fixes. These raise "Unable to find text 'Zajęcia w parku'" and similar. |
| src/test/extension-points.test.tsx | 2 | Sidebar plugin menu items; ProductListPage plugin filter iframes |
| src/test/auth.test.tsx | 1 | AuthContext provides token/permissions/login/logout |
| src/test/foundation.test.tsx | 1 | renders AppShell with sidebar and content area |

Type: all are unit/component tests. Related to the implementation: none. These are pre-existing failures, so regression risk is low. PanelPage.test.tsx is modified in this diff, but its failing set is still the same 8 baseline tests and no new failure appeared.

## Issues

- warning: 17 frontend failures carried over from the HEAD baseline. They are not introduced by this task and fixing them is out of scope.
- info: group-thing-ai shows a Starlette TestClient/httpx deprecation warning.

issue_counts: critical 0, warning 1, info 1
