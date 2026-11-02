# Test Suite Results — Event Public Page

## TL;DR
- Status: **passed_with_issues**. No new failures (regressions): 0.
- Backend: 955/955 passed (100%) in 8m01s. Ruff found 53 issues, all already present before this task. Mypy found 16 errors, below the ~32 baseline and the same as the count the implementation reported.
- Frontend: 1225/1238 passed (98.95%). The 13 failures are exactly the known HEAD baseline. `tsc` is clean.
- OrganizerEditor.test.tsx, which is known to be flaky, passed this run.

## Key Decisions
- Ruff issues are classed as pre-existing. Only one changed file has a ruff issue: `app/organizations/service.py`, with 1 E501. The HEAD version of the same file has 2 issues (I001 + E501), so this change reduced them by one.
- Frontend failures are classed as pre-existing because their names match the orchestrator's verified HEAD baseline exactly: 13 tests in 7 files.

## Open Questions / Risks
- The 13 frontend failures and 53 ruff issues are still technical debt on HEAD. This task did not cause them.

## Commands
| Stack | Command | Result |
|---|---|---|
| Backend tests | `uv run python -m pytest -q -p no:warnings` (src/backend) | 955 passed, 0 failed, 0 errors, 0 skipped — exit 0 |
| Backend lint | `uv run python -m ruff check app tests` | 53 errors (41 E501, 11 I001, 1 UP017), all already present before this task |
| Backend types | `uv run python -m mypy app` | 16 errors in 8 files (baseline ~32) |
| Frontend tests | `npx vitest run` (src/frontend) | 1225 passed, 13 failed (116 files: 109 passed, 7 failed) |
| Frontend types | `npx tsc -p tsconfig.app.json --noEmit` | exit 0, no errors |

## Metrics
| Metric | Backend | Frontend | Total |
|---|---|---|---|
| Total | 955 | 1238 | 2193 |
| Passing | 955 | 1225 | 2180 |
| Failing | 0 | 13 | 13 |
| Errors | 0 | 0 | 0 |
| Skipped | 0 | 0 | 0 |
| Pass rate | 100% | 98.95% | 99.41% |

## Frontend failures (all pre-existing at HEAD)
| Test | File | Category |
|---|---|---|
| "Nowy termin" group select keeps the selected group's UUID | src/test/AppPage.test.tsx | pre-existing |
| 'Dodaj termin' dialog keeps 'Potrzebne rzeczy' collapsed | src/test/AppPage.test.tsx | pre-existing |
| add term: a rejected needed-item name does not block the term | src/test/AppPage.test.tsx | pre-existing |
| add term: a rejected createTerm shows an inline alert | src/test/AppPage.test.tsx | pre-existing |
| add term: creates the term first, then the needed items by name | src/test/AppPage.test.tsx | pre-existing |
| AuthContext provides token/permissions/login/logout via useAuth hook | src/test/auth.test.tsx | pre-existing |
| Sidebar renders hardcoded items then plugin menu items | src/test/extension-points.test.tsx | pre-existing |
| ProductListPage renders plugin filter iframes in filter bar | src/test/extension-points.test.tsx | pre-existing |
| Frontend Foundation renders AppShell with sidebar and content area | src/test/foundation.test.tsx | pre-existing |
| PendingActionsHost resolves a GIFT reservation id … post-term-end | src/test/PendingActionsHost.test.tsx | pre-existing |
| PublicLayout logged in: the top bar holds only the brand, Spotkania and the bell | src/test/PublicLayout.test.tsx | pre-existing |
| PublicLayout the logo is a named link to Start | src/test/PublicLayout.test.tsx | pre-existing |
| TermPage anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice | src/test/TermPage.test.tsx | pre-existing |

Flaky: none observed this run. Regressions: none.

## Lint / type detail
- **Ruff:** 53 issues across 32 files, mostly in `app/groups`, `app/families`, `app/circulation` and their tests. None of those files are in this task's diff except `app/organizations/service.py`, which went from 2 issues at HEAD to 1.
- **Mypy:** 16 errors. They are in `app/groups/application/{term_item_listings,exchange_summary,public_view}.py` and `app/families/bootstrap.py` (Mapped/UUID vs int typing), plus `app/main.py` (apscheduler stubs). None are in the event or messaging files this task changed. No increase.

## Issue summary
- critical: 0
- warning: 0
- info: 2 (13 frontend failures and 53 ruff issues, all already present on HEAD)
