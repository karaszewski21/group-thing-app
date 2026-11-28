# Test Suite Results — Re-verification (cycle 2)

## TL;DR
- Status: **failed**. There is **1 new regression** (2 parametrized backend tests). Everything else matches the baseline.
- Backend pytest: 2073 passed, 4 failed. 2 are baseline stale tests. 2 are NEW: `tests/test_wants_scan_removed.py::test_lifespan_schedulesNoWantScanJob_andRegistersTheHandlers[False|True]`.
- Cause: the cycle-2 fix in `app/main.py:341` calls `_term_end_scheduler.pause()` at shutdown. The test's fake `_RecordingScheduler` (test file unchanged) has no `pause()`, so the test fails with `AttributeError`.
- Frontend: vitest 2289/2338 passed, 49 failed, exactly the 11 baseline files, so the `api/client.ts` change caused no new failures. Typecheck 0. Lint 10 errors / 29 warnings, same as cycle 1, none new.
- mypy 15, ruff 64 (same files as baseline); matcher 125 passed; `tests/test_email_senders.py` (rebuilt): 13 passed.

## Key Decisions
- The two `test_wants_scan_removed` failures are classified as a **new regression** (high risk), not baseline. They passed in cycle 1, the test file is unmodified, and the failure point is the newly added `pause()` line in `app/main.py`'s lifespan shutdown.
- The `src/frontend/src/api/client.ts` lint warning (`window.location.href`, now at line 49) is pre-existing. It sits at line 46 at HEAD and was also present in cycle 1. AppDataContext's 4 warnings match HEAD. The ruff E501 in `tests/test_organizations.py` and the mypy apscheduler import error in `app/main.py:21` are both present at HEAD.

## Open Questions / Risks
- Fix options:
  - Add `def pause(self) -> None: pass` to `_RecordingScheduler` in `tests/test_wants_scan_removed.py` (fixable, trivial).
  - Or check whether other lifespan tests use fake schedulers. A grep for fake schedulers without `pause` is advisable.
- After the fix, re-run at least `tests/test_wants_scan_removed.py` plus any other test that drives `main.lifespan`.

## Commands
| Suite | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run --no-sync python -m pytest -q -p no:warnings` (src/backend) | 2073 passed, 4 failed, 1542 s |
| Backend mypy | `uv run --no-sync python -m mypy app` | 15 errors in 8 files (baseline) |
| Backend ruff | `uv run --no-sync python -m ruff check .` | 64 errors (baseline) |
| Frontend tests | `npx vitest run` (src/frontend) | 598 files, 2338 tests: 2289 passed, 49 failed |
| Frontend typecheck | `npm run typecheck` | 0 errors |
| Frontend lint | `npm run lint` | 10 errors, 29 warnings (same as cycle 1) |
| Matcher tests | `uv run --no-sync python -m pytest -q` (src/matcher) | 125 passed |
| Email senders | `pytest tests/test_email_senders.py` | 13 passed |

## Metrics (combined)
- Total 4540 (backend 2077 + frontend 2338 + matcher 125); passing 4487; failing 53; errors 0; skipped 0; pass rate 98.8%.

## Failures

### Backend
| Test | Error | Type | Related | Classification |
|---|---|---|---|---|
| `tests/test_wants_scan_removed.py::test_lifespan_schedulesNoWantScanJob_andRegistersTheHandlers[False]` | `AttributeError: '_RecordingScheduler' object has no attribute 'pause'` at `app/main.py:341` | integration | yes (main.py lifespan changed) | **NEW regression**, risk high, fixable |
| `tests/test_wants_scan_removed.py::test_lifespan_schedulesNoWantScanJob_andRegistersTheHandlers[True]` | same | integration | yes | **NEW regression**, risk high, fixable |
| `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` | nearest-term dict mismatch | integration | no | baseline |
| `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip` | `['circle_group_id'] == ['group_id']` | integration | no | baseline |

### Frontend (49, all baseline)
AppPage 12, EventPage 7, MyItemsViewCategory 20, PublicLayout 2, extension-points 2, and 1 each in foundation, ItemDetailPage, OrganizerItemRoute, ParticipantItemsPreview, PendingActionsHost and TermPage. There are no failures in client, auth or email tests.

## Regressions
- Count: 1 (2 parametrized cases)
- `test_wants_scan_removed::test_lifespan_schedulesNoWantScanJob_andRegistersTheHandlers`: the fake scheduler lacks `pause()`, which the new lifespan shutdown calls.

## Issues
| Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|
| test_suite | critical | Lifespan test fake scheduler missing `pause()` after the main.py shutdown change | tests/test_wants_scan_removed.py:37, app/main.py:341 | true | Add a no-op `pause()` to `_RecordingScheduler` |
| test_suite | info | 2 stale backend tests (baseline) | tests/test_owner_items_page.py, tests/test_terms_circle_occurs_on_index_migration.py | true | — |
| test_suite | info | 49 baseline vitest failures | src/frontend/src/test/ | false | — |

Issue counts: critical 1, warning 0, info 2.
