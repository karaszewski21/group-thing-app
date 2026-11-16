# Final comparison against the baseline (Group 19)

## TL;DR
- All six checks: the final failing set equals the baseline set. No new failure, no baseline failure fixed.
- Backend: 2 failed / 1469 passed (baseline 2 / 1352); the same two stale test ids.
- mypy 15 errors (same 15 lines), ruff 65 (same 65 lines), typecheck 0, lint 10 errors / 28 warnings (same file and rule set).
- Vitest: 33 failed / 1818 passed (baseline 33 / 1677); the same 33 test ids.
- Group 19 added 6 tests (4 backend, 2 frontend). All feature tests pass.

## Key Decisions
- Compared by test id and by error line, not by count. For lint, by file + rule. One warning in `CategoryTreePicker.tsx` moved from line 95 to line 98 because group 12 edited the file. It is the same warning, so it is not new.
- No baseline id left the failing set. Group 16 rewrote parts of `AppPage.test.tsx` and `routeManifest.test.ts`. Every baseline id in those files still exists and still fails for its baseline reason. So no id is reported as "fixed / removed by a rewritten test".
- The 500-character cap on bell texts got no test. The want name has at most 80 characters and a product name at most 255. The longest possible message is about 380 characters, so the cap cannot be reached through the wants paths.

## Open Questions / Risks
- The two backend failures and the 33 Vitest failures are still there. They are older than this task and outside its scope.
- Run time: the backend suite took 26 min 9 s (baseline 20 min 58 s), with 117 more tests.

## How the checks were run

All runs are from 2026-11-16, on the working tree after group 19's test changes. Nothing was committed.

| Check | Command | How it was run |
|---|---|---|
| Backend tests | `uv run python -m pytest -q -p no:cacheprovider` (from `src/backend`) | one background run to the end, 1569 s, exit 1 |
| mypy | `uv run python -m mypy app` | one run, exit 1 |
| ruff | `uv run python -m ruff check` (and `--output-format concise` for the line list) | one run, exit 1 |
| Vitest | `npm run test` (from `src/frontend`) | one full run to the end, 97 s, exit 1 |
| typecheck | `npm run typecheck` | exit 0, no errors (also none inside `.next/`) |
| lint | `npm run lint`, plus `npx eslint . -f json` for the line list | exit 1 |

## Per check

| Check | Baseline (HEAD 92659eb) | Final | Difference |
|---|---|---|---|
| Backend tests | 2 failed, 1352 passed | 2 failed, 1469 passed | none (same 2 ids; +117 passing tests) |
| mypy | 15 errors in 8 files (255 files checked) | 15 errors in 8 files (285 files checked) | none (the 15 error lines are identical) |
| ruff | 65 errors | 65 errors | none (the 65 lines are identical) |
| Vitest | 33 failed, 1677 passed; 12 of 164 files | 33 failed, 1818 passed; 12 of 176 files | none (same 33 ids) |
| typecheck | 0 | 0 | none |
| lint | 10 errors, 28 warnings | 10 errors, 28 warnings | none by file + rule; one warning moved line (95 → 98 in `src/components/shared/CategoryTreePicker.tsx`, `jsx-a11y/role-supports-aria-props`) |

### Backend failing set (final, the same as the baseline)
- `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath`
- `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip`

### Vitest failing set (final, the same as the baseline)
- `AppPage.test.tsx` 12, `EventPage.test.tsx` 7, `PublicLayout.test.tsx` 3, `extension-points.test.tsx` 2, `routeManifest.test.ts` 2, and 1 each in `foundation`, `ItemDetailPage`, `OrganizerItemRoute`, `ParticipantItemsPreview`, `PendingActionsHost`, `reservedSlugs` and `TermPage`. Each test name matches the list in `frontend-vitest.txt`.

### Ids that left or joined a failing set
None, in any of the six checks.

## Tests added by group 19

| Test | File | Gap closed |
|---|---|---|
| `test_listMatches_organizationsItemWithPhotoReservedForAnEvent_slugHrefThumbAndReservedUntil` | `tests/test_wants_matches_api.py` | match card: an Organization slug in `href`, a non-null `thumb_url`, a non-null `reserved_until` (the event start) (FR-T-16) |
| `test_scanWants_singleMatchOfAnOrganizationsItem_bellRowLinksToTheSlugPage` | `tests/test_wants_scan.py` | an Organization slug in the single-match bell link (FR-T-13, AC-02) |
| `test_writeBellRows_singleMatchWhoseItemIsGone_noRowForIt_otherWantPointsAtItsOwnRow` | `tests/test_wants_scan.py` | a single match whose item is no longer listed at lookup time gets no bell row and leaves the pointer alone; the other want's pointer stays correct (the `zip` alignment) |
| `test_matchNewListings_ownHiddenOrNotTakeableItemAndInactiveWant_noPair` | `tests/test_wants_matcher.py` | must-not-match cases in the reverse (scan) direction: own item, PRIVATE without a shared live PRIVATE group, reserved item, pending proposal, inactive or expired want, deleted place (AC-05, FR-T-11) |
| `a card of an Organization's item links to its slug page and shows the thumbnail` | `src/frontend/src/test/WantMatchesView.test.tsx` | the match card renders `thumb_url` and the server's slug `href` |
| `a failed 'Znalezione — zamknij' shows the server message by the actions and keeps the want active` | `src/frontend/src/test/WantMatchesView.test.tsx` | AC-49 for a failed close (extend, resume and toggle were already covered) |
