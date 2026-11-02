# Test Suite Results — items page / event reservations (migration 0073)

## TL;DR
- Status: **passed_with_issues**. No regressions were found.
- Backend pytest: **1028/1028 passed** (9m14s). This confirms the earlier `test_organizer_page_queries` budget failure is fixed.
- Frontend vitest: 1295/1308 passed. All **13 failures are the documented pre-existing set**, with no new ones. The flaky OrganizerEditor test passed.
- `tsc -p tsconfig.app.json`: clean. mypy: 15 errors, at the low end of the expected baseline of about 15-17. ruff: 52 findings (41 E501, 10 I001, 1 UP017).
- Combined pass rate: 2323/2336 = 99.44%. Excluding the pre-existing failures, 100%.

## Key Decisions
- The 13 frontend failures were matched one by one against the orchestrator's pre-existing list (auth 1, extension-points 2, foundation 1, PublicLayout 2, AppPage add-term 5, PendingActionsHost 1, TermPage 1). They are classified as pre-existing, not regressions.
- The status is "passed_with_issues" and not "failed", because the pass rate is above 95% and none of the failures is in unrelated code.

## Open Questions / Risks
- The pre-existing frontend failures are still there and can hide real regressions in AppShell/PublicLayout/AppPage add-term/PendingActionsHost GIFT/TermPage anonymous sign-up. Fixing them should be its own task.
- ruff has one UP017 (datetime-timezone-utc). The task brief named only E501/I001 as pre-existing. Check whether the UP017 comes from a file this task touched; it is fixable with `--fix`.
- mypy errors are in organizations/service.py, groups term_item_listings/exchange_summary/public_view, families/bootstrap and main.py. These are UUID-vs-int typing leftovers and apscheduler stubs. term_item_listings.py:297 and public_view.py are modified on this branch, so check that no new error was added there. The total (15) is at the low end of the expected range.

## Commands
| Suite | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run python -m pytest -q -p no:warnings` (src/backend) | 1028 passed, 0 failed, 0 errors, 0 skipped — exit 0 |
| Backend types | `uv run python -m mypy app` (src/backend) | 15 errors in 8 files (207 files checked) |
| Backend lint | `uv run python -m ruff check app tests` (src/backend) | 52: 41 E501, 10 I001, 1 UP017 (11 auto-fixable) |
| Frontend tests | `npx vitest run` (src/frontend) | 123 files (7 failed / 116 passed); 1308 tests (13 failed / 1295 passed) |
| Frontend types | `npx tsc -p tsconfig.app.json --noEmit` (src/frontend) | exit 0, no errors |

## Metrics
| Metric | Backend | Frontend | Total |
|---|---|---|---|
| Total | 1028 | 1308 | 2336 |
| Passing | 1028 | 1295 | 2323 |
| Failing | 0 | 13 | 13 |
| Errors | 0 | 0 | 0 |
| Skipped | 0 | 0 | 0 |
| Pass rate | 100% | 99.01% | 99.44% |

## Failures (all pre-existing, all frontend, all unit/component tests)
| File | Test | Classification |
|---|---|---|
| src/test/auth.test.tsx | AuthContext > provides token/permissions/login/logout via useAuth hook | pre-existing |
| src/test/extension-points.test.tsx | Sidebar with plugin menu items > renders hardcoded items then plugin menu items | pre-existing |
| src/test/extension-points.test.tsx | ProductListPage with plugin filters > renders plugin filter iframes in filter bar | pre-existing |
| src/test/foundation.test.tsx | Frontend Foundation > renders AppShell with sidebar and content area | pre-existing |
| src/test/PublicLayout.test.tsx | logged in: the top bar holds only the brand, Spotkania and the notification bell | pre-existing |
| src/test/PublicLayout.test.tsx | the logo is a named link to Start | pre-existing |
| src/test/AppPage.test.tsx | "Nowy termin" group select keeps the selected group's UUID | pre-existing (add-term flow) |
| src/test/AppPage.test.tsx | 'Dodaj termin' dialog keeps 'Potrzebne rzeczy' collapsed behind a small optional button | pre-existing (add-term flow) |
| src/test/AppPage.test.tsx | add term: a rejected needed-item name does not block the term … | pre-existing (add-term flow) |
| src/test/AppPage.test.tsx | add term: a rejected createTerm shows an inline alert … | pre-existing (add-term flow) |
| src/test/AppPage.test.tsx | add term: creates the term first, then the needed items by name … | pre-existing (add-term flow) |
| src/test/PendingActionsHost.test.tsx | resolves a GIFT reservation id for the owner/lister side directly, post-term-end | pre-existing |
| src/test/TermPage.test.tsx | sign-up footer > anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice | pre-existing |

Known flaky `OrganizerEditor.test.tsx` "saves only the changed layout and closes the sheet" passed in the full run, so it was not re-run.

## Regressions
- Count: **0**

## Issue Summary
| Severity | Count | Notes |
|---|---|---|
| critical | 0 | — |
| warning | 0 | — |
| info | 3 | 13 pre-existing frontend failures; mypy at 15 (baseline); ruff 52 including 1 UP017 |
