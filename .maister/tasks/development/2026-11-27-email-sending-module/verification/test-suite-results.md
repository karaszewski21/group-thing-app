# Test Suite Results — email sending module

## TL;DR
- Status: **passed_with_issues**. No new regressions; every failure and finding matches the pre-existing baseline.
- Backend pytest: 2050 passed, 2 failed (both baseline); mypy 15 (baseline); ruff 64 (baseline).
- Frontend vitest: 2286/2335 passed, 49 failed in exactly the 11 baseline files; typecheck 0; lint 10 errors / 29 warnings, none in a feature file.
- Matcher pytest: 125 passed (baseline).
- All new email/auth-token tests (backend `test_email_*`, `test_account_tokens`; frontend Email/ResetPassword/Unsubscribe/VerifyEmail tests) pass.

## Key Decisions
- The lint warning count is 29 against the stated baseline of 28. Classified as baseline drift, not a regression. Reason: the only lint-flagged file this task touched, `src/frontend/src/features/panel/AppDataContext.tsx`, has the same 4 warnings at HEAD. The other 23 flagged files are unchanged, and none sits in a new/untracked directory.
- The ruff E501 in modified `tests/test_organizations.py` (line 179) and the mypy `apscheduler` import-untyped error in modified `app/main.py:21` are both present at HEAD, where the ruff finding is at line 157. Both are classified as baseline.

## Open Questions / Risks
- MyItemsViewCategory (20 failures) remains broken from HEAD commit 3bb3591 (missing QueryClient wrapper). Not related to this task, but it inflates the failure count.
- Backend suite took 29 min (longer than the ~22 min estimate).
- Lint baseline should be updated to 29 warnings, or the extra warning located in an unchanged file.

## Commands
| Suite | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run --no-sync python -m pytest -q -p no:warnings` (src/backend) | 2050 passed, 2 failed, 1747.7 s |
| Backend mypy | `uv run --no-sync python -m mypy app` | 15 errors in 8 files (baseline 15) |
| Backend ruff | `uv run --no-sync python -m ruff check .` | 64 errors (baseline 64) |
| Frontend tests | `npx vitest run` (src/frontend) | 597 files, 2335 tests: 2286 passed, 49 failed, 0 skipped (97.9%) |
| Frontend typecheck | `npm run typecheck` | 0 errors |
| Frontend lint | `npm run lint` | 10 errors, 29 warnings |
| Matcher tests | `uv run --no-sync python -m pytest -q` (src/matcher) | 125 passed |

## Metrics (combined test runners)
- Total: 4512 (backend 2052 + frontend 2335 + matcher 125)
- Passing: 4461; Failing: 51; Errors: 0; Skipped: 0
- Pass rate: 98.9%

## Failures

### Backend (2, both baseline)
| Test | Error | Type | Related | Classification |
|---|---|---|---|---|
| `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` | AssertionError: nearest-term dict differs | integration | no | baseline (stale test) |
| `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip` | `['circle_group_id'] == ['group_id']` | integration (migration) | no | baseline (stale test) |

### Frontend (49, all baseline)
| File | Failing tests | Classification |
|---|---|---|
| AppPage.test.tsx | 12 | baseline |
| EventPage.test.tsx | 7 | baseline |
| MyItemsViewCategory.test.tsx | 20 | baseline (from HEAD 3bb3591) |
| PublicLayout.test.tsx | 2 | baseline |
| extension-points.test.tsx | 2 | baseline |
| foundation.test.tsx | 1 | baseline |
| ItemDetailPage.test.tsx | 1 | baseline |
| OrganizerItemRoute.test.tsx | 1 | baseline |
| ParticipantItemsPreview.test.tsx | 1 | baseline |
| PendingActionsHost.test.tsx | 1 | baseline |
| TermPage.test.tsx | 1 | baseline |

Unit/integration component tests. None related to the email feature.

## Regressions
- Count: 0

## Issues
| Source | Severity | Description | Location | Fixable |
|---|---|---|---|---|
| test_suite | info | 2 stale backend tests (baseline) | tests/test_owner_items_page.py, tests/test_terms_circle_occurs_on_index_migration.py | true |
| test_suite | info | 49 baseline vitest failures in 11 files | src/frontend/src/test/ | false |
| lint | info | Lint warnings 29 vs stated 28; none in feature files | src/frontend | false |

Issue counts: critical 0, warning 0, info 3.
