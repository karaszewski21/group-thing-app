# Test Suite Results — Re-verification after fixes

## TL;DR
- Status: **failed (1 regression)**. Backend 958/959 passed (99.9%). Frontend 1233/1246 passed (98.96%). Every frontend failure is in the known 13-test baseline.
- Regression: `tests/test_events_migration.py::test_upgradeHead_eventConstraints_namedAndPartial`. The new migration `0072_event_party_indexes` adds `ix_events_author_party_id`, but the test still expects `events["indexes"] == {}`. Line 93 will fail next, because its expected set lacks `ix_event_attendances_party_id`.
- Fix (in the test only, schema is correct): update both exact-set assertions at lines 82 and 93 to include the 0072 indexes.
- Lint/types: no change. Ruff 53 (pre-existing), mypy 16 errors in 8 files (pre-existing), frontend `tsc` clean.

## Key Decisions
- The failure counts as a **regression**, not a pre-existing failure. The test passed in the previous run (955/955), its file is unchanged since HEAD, and it breaks only because of the new migration 0072 added during verification fixes.
- The mypy error at `app/organizations/service.py:94` (redundant cast) counts as pre-existing. That line exists unchanged at HEAD; this task's diff only adds `get_own_organizations_by_party_ids` below it.

## Open Questions / Risks
- `test_event_party_indexes_migration.py` (new) covers 0072 and passes. But the older migration test checks the head schema with exact sets, so any further index added on `events` or `event_attendances` must also update `test_events_migration.py`.

## Commands

| Stack | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run python -m pytest -q -p no:warnings` (src/backend) | 1 failed, 958 passed in 9m26s |
| Backend lint | `uv run python -m ruff check app tests` | 53 issues (12 fixable) |
| Backend types | `uv run python -m mypy app` | 16 errors in 8 files |
| Frontend tests | `npx vitest run` (src/frontend) | 13 failed, 1233 passed (1246); 7 failed / 109 passed files; 58s |
| Frontend types | `npx tsc -p tsconfig.app.json --noEmit` | exit 0, no errors |

## Metrics

| Stack | Total | Passing | Failing | Skipped | Pass rate |
|---|---|---|---|---|---|
| Backend | 959 | 958 | 1 | 0 | 99.90% |
| Frontend | 1246 | 1233 | 13 | 0 | 98.96% |
| Combined | 2205 | 2191 | 14 | 0 | 99.37% |

## Delta vs previous run (verification/test-suite-results.md)

| | Previous | Now | Delta |
|---|---|---|---|
| Backend | 955/955 | 958/959 | +4 tests (new 0072 migration test and fix tests); **+1 failure (regression)** |
| Frontend | 1225/1238 | 1233/1246 | +8 tests, all passing; same 13 baseline failures |
| Ruff | 53 | 53 | 0 |
| Mypy | 16 (8 files) | 16 (same 8 files) | 0 |
| tsc | clean | clean | 0 |

## Failure details

### Backend — REGRESSION (high)
- **Test:** `tests/test_events_migration.py::test_upgradeHead_eventConstraints_namedAndPartial` (integration, migration schema test)
- **Error:** `AssertionError: assert {'ix_events_author_party_id': {...}} == {}` at line 82 (`assert events["indexes"] == {}`)
- **Cause:** `alembic/versions/0072_event_party_indexes.py` creates `ix_events_author_party_id` on `events(author_party_id)` and a partial `ix_event_attendances_party_id` on `event_attendances(party_id) WHERE withdrawn_at IS NULL`. The test's exact-set assertions describe the schema from before 0072:
  - line 82: `events["indexes"] == {}` should expect `ix_events_author_party_id`
  - line 93: `set(attendances["indexes"]) == {"ix_event_attendances_event_id", ATTENDANCE_UNIQUE}` should also include `ix_event_attendances_party_id`. This line is not reached yet but will fail once line 82 is fixed.
- **Related to implementation:** yes (fix-round migration 0072). The test file itself was not updated.
- **Fixable:** true. Update the expected sets in the test. Keep the exact-set style, per the backend-testing standard "update, never loosen".

### Frontend — 13 pre-existing baseline failures (match the provided list exactly)
- AppPage.test.tsx ×5: "Nowy termin" group select keeps UUID; 'Dodaj termin' dialog keeps 'Potrzebne rzeczy' collapsed; add term: rejected createTerm inline alert; add term: rejected needed-item name toast; add term: creates term first then needed items
- TermPage.test.tsx ×1: anonymous 'Zaloguj się, żeby się zapisać' opens login/guest choice
- auth.test.tsx ×1: provides token/permissions/login/logout via useAuth
- extension-points.test.tsx ×2: plugin filter iframes; Sidebar plugin menu items
- foundation.test.tsx ×1: AppShell with sidebar and content area
- PendingActionsHost.test.tsx ×1: GIFT reservation id for owner/lister post-term-end
- PublicLayout.test.tsx ×2: logged-in top bar; logo is a named link to Start

There are no new frontend failures and no flaky failures this run (OrganizerEditor.test.tsx passed).

## Lint / type details
- **Ruff:** 53 issues, all pre-existing and the same count as before. Only one changed file has an issue, `app/organizations/service.py` (1 E501, down from 2 at HEAD).
- **Mypy:** 16 errors in `app/circulation/application/inventory_items.py` (1), `app/families/bootstrap.py` (1), `app/groups/application/exchange_summary.py` (3), `app/groups/application/public_view.py` (4), `app/groups/application/term_item_listings.py` (2), `app/main.py` (1, apscheduler stubs), `app/organizations/service.py` (1, redundant cast at line 94, already at HEAD), and `app/plugin/router.py` (3). None are in the event/messaging code this task added or changed.
- **tsc:** clean.

## Issues

| Severity | Description | Location | Fixable |
|---|---|---|---|
| critical | Migration test's exact index sets miss the 0072 indexes (regression) | `src/backend/tests/test_events_migration.py:82,93` | true |
| info | 13 pre-existing frontend failures (baseline, also fail on clean HEAD) | `src/frontend/src/test/*` | false (out of scope) |
| info | 53 ruff / 16 mypy pre-existing issues, unchanged | backend | false (out of scope) |

Issue counts: critical 1, warning 0, info 2.
