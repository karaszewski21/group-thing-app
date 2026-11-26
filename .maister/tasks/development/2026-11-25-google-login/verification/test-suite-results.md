# Test Suite Results — Google login (re-verification after 14 fixes)

## TL;DR
- Status: **passed_with_issues**. Every failure is a known HEAD baseline failure, plus one flake that passes when re-run alone. No regressions.
- Backend pytest: 1792 passed, 2 failed (both in the baseline), 1794 total, 21m35s.
- Frontend vitest: 2084 passed, 33 failed, 2117 total. That is 32 baseline failures plus 1 DeleteGroupDialog flake, which passed 3 out of 3 times on its own.
- Static checks: mypy 15, ruff 64, tsc 0 errors, ESLint 10 errors and 28 warnings. All are at or below the baseline.
- All auth and Google test files pass.

## Key Decisions
- Ran the suites one after the other: the backend first, then the frontend. Only one vitest process ran at a time.
- Re-ran `DeleteGroupDialog.test.tsx` alone 3 times because it is not in the baseline. It passed 4/4 each time, so it counts as a flake. The Google change does not touch this file. The failure was a focus assertion (`toHaveFocus` on „Anuluj”) in "rejected onConfirm shows role=alert message and keeps dialog open". Timing under full-suite load is the likely cause.
- Lint was judged by its totals. They equal the baseline exactly (10 errors, 28 warnings). `src/auth/AuthContext.tsx:98` was changed in this work, and ESLint reports a **warning** there (`react-hooks` set-state-in-effect, from `showToken(reconciled)` inside a `useLayoutEffect`). It is not an error, and the overall count did not grow.

## Open Questions / Risks
- The `AuthContext.tsx:98` lint warning is on a line this change edited. The total count is unchanged, so either the warning existed before or it replaces one that went away. Low risk, but a reviewer may want to confirm.
- The DeleteGroupDialog focus test can flake under load. It is not related to this feature, but it could be added to the baseline list of flaky tests.

## Commands

| Suite | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run python -m pytest -q -p no:cacheprovider` (src/backend) | 1792 passed, 2 failed |
| Backend types | `uv run python -m mypy app` | 15 errors in 8 files (baseline 15) |
| Backend lint | `uv run python -m ruff check .` | 64 errors (baseline 65, 64 acceptable) |
| Frontend tests | `npx vitest run` (src/frontend) | 2084 passed, 33 failed, 195 files (13 failed) |
| Frontend types | `npm run typecheck` | 0 errors |
| Frontend lint | `npm run lint` | 10 errors, 28 warnings (baseline ~10 / 28) |

## Metrics

| | Total | Passing | Failing | Errors | Skipped | Pass rate |
|---|---|---|---|---|---|---|
| Backend pytest | 1794 | 1792 | 2 | 0 | 0 | 99.89% |
| Frontend vitest | 2117 | 2084 | 33 | 0 | 0 | 98.44% |

## Failures

### Backend (both in the baseline)
- `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath`: integration test, unrelated to this work, baseline
- `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip`: migration test, unrelated to this work, baseline

### Frontend (failures per file)

| File | Failures | Baseline? |
|---|---|---|
| AppPage.test.tsx | 12 | yes (12) |
| EventPage.test.tsx | 7 | yes (7) |
| PublicLayout.test.tsx | 2 | yes (2–3) |
| extension-points.test.tsx | 2 | yes |
| routeManifest.test.ts | 2 | yes |
| foundation.test.tsx | 1 | yes |
| ItemDetailPage.test.tsx | 1 | yes |
| OrganizerItemRoute.test.tsx | 1 | yes |
| ParticipantItemsPreview.test.tsx | 1 | yes |
| PendingActionsHost.test.tsx | 1 | yes |
| reservedSlugs.test.ts | 1 | yes |
| TermPage.test.tsx | 1 | yes |
| DeleteGroupDialog.test.tsx | 1 | **no**, flake (passes alone 3/3) |

## Auth / Google files (flagged set)
- Frontend: auth.test (13 ✓), SocialAuthButtons (15 ✓), googleIdentity (4 ✓), authApi (2 ✓), ssrSafety (19 ✓), plugin-sdk-auth (3 ✓). All pass.
- Backend: none of test_google_*, test_login, test_registration, test_user_identities_migration or test_authorization_matrix failed. They all passed in the full run.
- mypy and ruff report no errors in auth, Google, users or config files.

## Regressions
count: 0

## Issue summary
- critical: 0
- warning: 1 (DeleteGroupDialog flake; not related to this work, not fixable here)
- info: 1 (AuthContext.tsx:98 lint warning on an edited line; totals unchanged)
