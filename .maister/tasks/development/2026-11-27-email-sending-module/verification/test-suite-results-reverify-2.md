# Test Suite Results — Re-verification (cycle 3, final)

## TL;DR
- Status: **passed_with_issues**. **0 new regressions**; every failure matches the pre-existing baseline.
- The cycle-2 regression is **gone**: both `tests/test_wants_scan_removed.py::test_lifespan_schedulesNoWantScanJob_andRegistersTheHandlers[False|True]` cases pass.
- Backend pytest: 2079 passed, 2 failed (both baseline); mypy 15; ruff 64 (baseline).
- Frontend: vitest 2290/2339 passed, 49 failed in the 11 baseline files; `apiClient.test.ts` 7/7 passed; typecheck 0; lint 10 errors / 29 warnings (same as cycles 1–2).
- Matcher 125 passed; `docker compose config --quiet` exit 0 (valid).

## Key Decisions
- Lint findings in changed files are pre-existing:
  - `src/frontend/src/api/client.ts`: 1 `window.location.href` warning, also at HEAD.
  - `src/frontend/src/features/panel/AppDataContext.tsx`: 4 warnings, same as HEAD.
- The 29-vs-28 warning count is baseline drift in an unchanged file, as documented in cycle 1.
- The ruff E501 in `tests/test_organizations.py` and the mypy apscheduler import error at `app/main.py:21` are present at HEAD, so they are baseline.

## Open Questions / Risks
- MyItemsViewCategory (20 failures) remains broken from HEAD commit 3bb3591. It is unrelated to this feature.
- The compose check validated syntax only (`--quiet`, no output printed). No containers were started with the new `stop_grace_period`.

## Commands
| Suite | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run --no-sync python -m pytest -q -p no:warnings` (src/backend) | 2079 passed, 2 failed, 1356.5 s |
| Targeted re-check | `pytest tests/test_wants_scan_removed.py tests/test_email_senders.py tests/test_email_sending.py tests/test_login.py tests/test_families_bootstrap.py` | 51 passed |
| Backend mypy | `uv run --no-sync python -m mypy app` | 15 errors in 8 files (baseline) |
| Backend ruff | `uv run --no-sync python -m ruff check .` | 64 errors (baseline, same files) |
| Frontend tests | `npx vitest run` (src/frontend) | 598 files, 2339 tests: 2290 passed, 49 failed |
| Frontend typecheck | `npm run typecheck` | 0 errors |
| Frontend lint | `npm run lint` | 10 errors, 29 warnings |
| Matcher tests | `uv run --no-sync python -m pytest -q` (src/matcher) | 125 passed |
| Compose | `docker compose config --quiet` (repo root) | exit 0 |

## Metrics (combined)
- Total 4545 (backend 2081 + frontend 2339 + matcher 125); passing 4494; failing 51; errors 0; skipped 0; pass rate 98.9%.

## Failures

### Backend (2, both baseline)
| Test | Error | Type | Related | Classification |
|---|---|---|---|---|
| `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` | nearest-term dict mismatch | integration | no | baseline (stale) |
| `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip` | `['circle_group_id'] == ['group_id']` | integration | no | baseline (stale) |

### Frontend (49, all baseline)
AppPage 12, EventPage 7, MyItemsViewCategory 20, PublicLayout 2, extension-points 2, and 1 each in foundation, ItemDetailPage, OrganizerItemRoute, ParticipantItemsPreview, PendingActionsHost and TermPage. There are no failures in client, auth or email tests.

## Regressions
- Count: 0 (the cycle-2 `test_wants_scan_removed` regression is resolved).

## Issues
| Source | Severity | Description | Location | Fixable |
|---|---|---|---|---|
| test_suite | info | 2 stale backend tests (baseline) | tests/test_owner_items_page.py, tests/test_terms_circle_occurs_on_index_migration.py | true |
| test_suite | info | 49 baseline vitest failures | src/frontend/src/test/ | false |

Issue counts: critical 0, warning 0, info 2.
