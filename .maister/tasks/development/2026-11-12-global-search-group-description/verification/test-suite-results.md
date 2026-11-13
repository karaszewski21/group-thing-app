# Test Suite Results (post verification-fix cycle)

## TL;DR
- Status: **passed_with_issues** — every failure is on the pre-existing baseline lists; **no regressions**.
- Backend pytest: 1337 passed, 2 failed (both pre-existing), 99.85% pass rate. mypy: 15 errors (= baseline 15).
- Frontend vitest: 1640 passed, 24 failed (all 24 pre-existing, fail on HEAD b8c45e0), 1 file-level failure (EventPage, pre-existing). Typecheck: 5 errors (= the 5 pre-existing).
- No failure touches the fix-cycle areas (search cap/timeout/503, migration 0096, categories cache, groups date window, reserved_until, visibility helpers, inventory repo move, maxLength, Opis order, GroupResponse.description fixtures, useSearch, nginx.conf).

## Open Questions / Risks
- `test_migration0053_downgradeUpgrade_roundTrip` exercises a full downgrade/upgrade chain that now includes migration 0096; it failed before 0096 existed with the same assertion (`['circle_group_id'] == ['group_id']`, an index-column naming issue from 0053-era renames), so 0096's downgrade is not shown broken by it — but it also means that test gives no round-trip coverage of 0096. A dedicated 0096 round-trip test (if present) is the real guard.
- `test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` expects `location_name: None` but gets a locality label (`Nowa Dęba, podkarpackie`) — test-data/expectation drift, pre-existing.
- Frontend pre-existing failures (24) still mask any future regressions in AppPage/PublicLayout/TermPage etc.; worth a separate cleanup task.

## Commands
| Suite | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run python -m pytest -q -p no:cacheprovider` (src/backend) | 2 failed, 1337 passed, 930 s |
| Backend types | `uv run python -m mypy app` (src/backend) | Found 15 errors in 8 files (baseline 15) |
| Frontend tests | `npx vitest run` (src/frontend) | 11 files failed / 153 passed; 24 tests failed / 1640 passed (1664) |
| Frontend types | `npm run typecheck` (src/frontend) | 5 errors (baseline 5) |

## Metrics
| Suite | Total | Passing | Failing | Errors | Skipped | Pass rate |
|---|---|---|---|---|---|---|
| Backend pytest | 1339 | 1337 | 2 | 0 | 0 | 99.85% |
| Frontend vitest | 1664 | 1640 | 24 | 1 file (EventPage import) | 0 | 98.56% |

Backend pass count equals the previous run (1337) despite the boundary-test merge and duplicate-test removal.

## Failures

### Backend (both pre-existing, unrelated to the fix cycle)
| Test | Error | Type | Related | Regression risk |
|---|---|---|---|---|
| tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath | `location_name` `'Nowa Dęba, podkarpackie'` != `None` | integration | no | low (baseline) |
| tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip | `['circle_group_id'] == ['group_id']` | integration (migration) | no | low (baseline) |

### Frontend (all 24 on the pre-existing list)
- AppPage.test.tsx ×12 (delete group ×2, edit group page ×4, moderation errors ×3, per-term links ×1, Spotkania list ×1, UUID select ×1)
- PublicLayout.test.tsx ×3 (chat thread top bar, logged-in top bar, logo link)
- extension-points.test.tsx ×2 (ProductListPage plugin filters, Sidebar plugin menu)
- foundation.test.tsx ×1 (AppShell)
- EventPage.test.tsx — file fails to load (missing `features/events/components/EventAuthorCard`)
- ItemDetailPage.test.tsx ×1 ("Wróć" fallback)
- OrganizerItemRoute.test.tsx ×1 ("Wróć" on direct entry)
- ParticipantItemsPreview.test.tsx ×1 ("at most 3 rows")
- PendingActionsHost.test.tsx ×1 (GIFT owner side)
- reservedSlugs.test.ts ×1 (static segments / 'settings')
- TermPage.test.tsx ×1 ("Miejsce" place card)

All match the baseline list exactly; none are in search, group description, categories, useSearch or Opis-field areas.

### Typecheck (5, all pre-existing)
- ParticipantItemsPreview.tsx: unused `dayjs`
- ThreadPage.tsx ×3: unused `useAppNavigate`, `useHasInAppHistory`, `BackIcon`
- EventPage.test.tsx: cannot find module `EventAuthorCard`

## Regressions
count: 0

## Issue counts
critical: 0 · warning: 0 (new) · info: 2 backend + 24 frontend + 5 typecheck pre-existing
