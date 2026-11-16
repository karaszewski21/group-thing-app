## TL;DR
- **Re-verification cycle 1** (after the verification fixes). Status: **passed_with_issues**. Every failure in all six checks is a baseline (pre-existing) failure. **0 new failures, 0 regressions**, and no baseline failure was fixed.
- Backend pytest: 2 failed / 1469 passed. Same as the previous run, with the same 2 test ids and assertion lines. mypy 15 and ruff 65, both with identical lines.
- Vitest: 33 failed / 1824 passed in 12 of 176 files. The previous run had 33 / 1818: same 33 ids, 6 more passing tests. typecheck 0. lint 10 errors / 28 warnings, identical by file + rule.
- Pass rates: backend 99.86% overall and 100% excluding baseline. Vitest 98.22% overall and 100% excluding baseline.

## Key Decisions
- Results are compared by test id and error line, not by count, and lint by file + rule. The lint lists differ from the baseline file only in line endings (CRLF). The one line move (`CategoryTreePicker.tsx` 95 -> 98, `jsx-a11y/role-supports-aria-props`) is the same as in the previous run.
- Vitest prints `extension-points.test.tsx > Sidebar with plugin menu items > renders hardcoded items then plugin menu ite` with the name cut short. That is the reporter's width limit, and the test is the baseline id `…plugin menu items`.
- `routeManifest > renders every panel section through the panel layout` still shows `…(31)` vs `…(32)`. That is the same one-entry gap as the previous run, so it is classified as baseline (see the previous cycle's note: the task added 2 panel routes to both lists).
- The pytest run used `-p no:cacheprovider`, the same flags as before. It does not change which tests are selected.

## Open Questions / Risks
- The backend total is unchanged at 1471 tests (1469 passing). The fix cycle edited 5 backend test files (`test_wants_scan/notifications/migration/domain/matches_api`), so those edits replaced or changed tests and added none overall. All of them pass. Nothing in the run shows whether the new behaviour has its own test: the status filter + lock, `create_notifications`, and the 0099 downgrade deleting WANT_* notifications. reality-assessor may want to check by reading the tests.
- The 2 backend and 33 Vitest baseline failures predate this task (HEAD 92659eb) and remain out of scope.

## Comparison: baseline -> previous run -> this run (cycle 1)

| Check | Baseline (HEAD 92659eb) | Previous run | This run | Difference vs previous |
|---|---|---|---|---|
| Backend tests | 2 failed / 1352 passed | 2 failed / 1469 passed | 2 failed / 1469 passed / 0 errors / 0 skipped | none (same 2 ids) |
| mypy | 15 errors in 8 files | 15 | 15 errors in 8 files (285 files checked) | none (identical `error:` lines, ignoring line numbers) |
| ruff | 65 | 65 | 65 (9 auto-fixable) | none (identical concise lines, ignoring positions) |
| Vitest | 33 failed / 1677 passed, 12/164 files | 33 / 1818, 12/176 files | 33 failed / 1824 passed (1857), 12/176 files | +6 passing (new/changed wants tests), same 33 failing ids |
| typecheck | 0 | 0 | 0 (exit 0) | none |
| lint | 10 errors, 28 warnings | 10 / 28 | 10 errors, 28 warnings | none by file + rule |

### Pass rates
| Suite | Overall | Excluding baseline failures |
|---|---|---|
| Backend | 1469 / 1471 = 99.86% | 1469 / 1469 = 100% |
| Vitest | 1824 / 1857 = 98.22% | 1824 / 1824 = 100% |

## Failures (all baseline / pre-existing)

### Backend (2)
| Test | Error | Class |
|---|---|---|
| `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath` | `{'location_name': 'Nowa Dęba, podkarpackie'} != {'location_name': None}` (stale expectation) | baseline, integration, unrelated, regression risk low |
| `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip` | `assert ['circle_group_id'] == ['group_id']` (pre-rename column name) | baseline, migration, unrelated, regression risk low |

### Vitest (33): every id equals `implementation/baseline/frontend-vitest.txt`
- `AppPage.test.tsx` 12: "+ Dodaj termin" link, "Prowadzę" heading and "· 1"/"· 2" text not found, plus `spy` called with `['55']`
- `EventPage.test.tsx` 7: "Wydarzenie", "Organizator", `/Edytuj/` and "Usuń" not found
- `PublicLayout.test.tsx` 3: the search field is still present, `['/search','/meetings']` vs `['/','/meetings']`, and the "Krąg grupy — Start" link
- `extension-points.test.tsx` 2 and `routeManifest.test.ts` 2
- 1 each in `foundation`, `ItemDetailPage` (`/Wróć/` fallback), `OrganizerItemRoute` (`/Wróć/`), `ParticipantItemsPreview`, `PendingActionsHost`, `reservedSlugs` (`…(15)` vs `…(16)`) and `TermPage` (region "Miejsce")

The fix cycle edited `ItemDetailPage.test.tsx`. Its only failure is still the baseline `ItemDetailPage fallbacks > Wróć on a directly opened page falls back to the owner's page`, and every wants-related test in it passes. The changed `useWants`, `WantFormView`, `WantedListView` and `wantText` tests all pass.

### New failures
None. Regressions: 0.

## Flaky observations
None seen. Each check ran once. The failing sets equal both the baseline and the previous run.

## Durations
| Check | Duration |
|---|---|
| Backend pytest | 1301.4 s (21 min 41 s), ran to the end, exit 1 |
| mypy | a few seconds |
| ruff | under 1 s |
| Vitest | 85.7 s |
| typecheck / lint | well under 1 min each |

## Exact commands
From `src/backend`:
- `uv run python -m pytest -q -p no:cacheprovider` (run in the background and watched until the summary line and exit code were written; exit 1)
- `uv run python -m mypy app` (exit 1)
- `uv run python -m ruff check` (exit 1), plus `--output-format concise` for the line diff

From `src/frontend`:
- `npm run test` (exit 1)
- `npm run typecheck` (exit 0)
- `npm run lint` (exit 1), plus `npx eslint . -f json` for the file + rule diff

Raw outputs (overwritten, no secrets) are in `verification/raw/`: `backend-pytest.txt`, `backend-mypy.txt`, `backend-ruff.txt`, `backend-ruff-concise.txt`, `frontend-vitest.txt`, `frontend-typecheck.txt`, `frontend-lint.txt`, `frontend-lint.json`, `frontend-lint-lines.txt`.
