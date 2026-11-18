# Full Suite Results: wants semantic SIMILAR tier

## TL;DR
- **Status: passed_with_issues.** Every suite matches the HEAD 92659eb baseline. There are no new failures in feature code or elsewhere.
- Backend (clean isolated rerun): 2 failed / 1562 passed / 1 skipped. Both failures are the two known stale tests. ruff 65 and mypy 15 match the baseline.
- Matcher: 120 passed, ruff clean, mypy clean. Frontend: the same 33 vitest failures (identical ids), 0 typecheck errors, lint 38 problems (10 errors, 28 warnings), as in the baseline.
- The **first** backend run had 52 failures. They were a cascade from one load-dependent test (`test_event_reservations_migration.py`, whose `finally` block was rewritten by the parallel 0102 change). An isolated rerun had none of them. See the Open Questions section.

## Commands and metrics

| Suite | Command (cwd) | Result | Baseline | Verdict |
|---|---|---|---|---|
| Backend pytest | `uv run python -m pytest -q -p no:warnings` (src/backend) | run 1: 52 F / 1512 P / 1 S (18m36s, run concurrently with vitest and matcher); **run 2 (alone): 2 F / 1562 P / 1 S** (18m21s) | 2 F / 1352 P | = baseline (run 2) |
| Backend ruff | `uv run python -m ruff check .` | 65 errors | 65 | = |
| Backend mypy | `uv run python -m mypy app` | 15 errors in 8 files | 15 | = |
| Matcher pytest | `uv run python -m pytest -q` (src/matcher) | 120 passed | n/a | pass |
| Matcher ruff | `uv run python -m ruff check .` | All checks passed | n/a | pass |
| Matcher mypy | `uv run python -m mypy matcher tests` | no issues (24 files) | n/a | pass |
| Frontend vitest | `npx vitest run` (src/frontend) | 33 F / 1869 P (177 files, 12 failing) | 33 F | = (same 33 ids) |
| Frontend typecheck | `npm run typecheck` | 0 errors | 0 | = |
| Frontend lint | `npm run lint` | 38 problems (10 errors, 28 warnings) | 38 (10/28) | = |

Backend pass rate in run 2: 1562 / 1564 = 99.9%. Frontend vitest pass rate: 98.3%. Both suites' failures are all pre-existing.

## Failures

### Backend: pre-existing (baseline), same assertion as on HEAD
- `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath`: `location_name` 'Nowa Dęba, podkarpackie' != None. This is a stale test.
- `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip`: `['circle_group_id'] == ['group_id']`. This is a stale test.

### Frontend vitest: pre-existing, all 33 identical to the baseline ids in `2026-11-15-szukam-wanted-mechanism/implementation/baseline/frontend-vitest.txt`
AppPage 12, EventPage 7, PublicLayout 3, extension-points 2, routeManifest 2, and 1 each in foundation, ItemDetailPage, OrganizerItemRoute, ParticipantItemsPreview, PendingActionsHost, reservedSlugs and TermPage. None of them are in `features/wanted` or in the wants tests. The new `reservedCaption.test.ts`, `WantMatchesView`, `useWantMatches`, `useWants` and `wantMatchesViewState` tests all pass.

### Lint, ruff, mypy
No hits in feature files. No lint problem is in `features/wanted`, `SimilarCard`, `reservedCaption` or `api/wants`. The only mypy error in a touched file, `app/main.py:21` (apscheduler stubs), is on an import line that already exists on HEAD and is in the baseline count.

### Backend run 1 cascade (52 failures, not reproduced): flaky/environment
- **Trigger** (the first F, test #257): `tests/test_event_reservations_migration.py::test_downgradeTo0072_contextlessReservationExists_refusesWithRecoveryPath`. Its cleanup at line ~188 raised `ForeignKeyViolation: inventories ... fk_accounts_inventory_id_inventories`. The `accounts` table still existing means the `alembic upgrade head` in the `finally` block did not reach 0102. Its return code is ignored at `tests/test_event_reservations_migration.py:187`, so the failure went unnoticed. The DB was left at about 0073, and the seeded reservation with `term_id IS NULL` leaked as a committed row.
- **Knock-on failures:**
  - Every `db_session` test that ran while the DB was low failed with `user_profiles.page_layout does not exist` or `categories.path_text does not exist`: test_events.py ×24 and test_event_reservations_migration ×3.
  - Later, every migration round-trip that downgrades across 0073 was refused with "Cannot downgrade 0073: 1 reservation(s) have term_id IS NULL": events_migration, group_join_code ×2, group_soft_delete, item_listing_status ×2, lend_listing_preferences, locations, messaging, needed_item_name ×2, organization_page_layout, personal_pickup ×3, photo_moderation_attempts ×2, pledge_fulfillment, terms_circle (also stale), vinted_category_seed ×4.
- **Evidence that it is not deterministic:**
  - The trigger test passes alone.
  - It passes after the 5 earlier alembic test files.
  - It passes after all 24 earlier test files (255 passed, 1 skipped, then the test itself). The spy shows `upgrade head rc=0`.
  - The full isolated rerun passes all of them.
  - Run 1 was the only run that overlapped with vitest, the matcher pytest (its own container) and mypy.
- **Attribution:** not the SIMILAR feature. The reordered `finally` block (upgrade before cleanup, with the comment "below 0102 every inventory has a ledger account") belongs to the parallel 0102 change. That change also edited `test_personal_pickup_migration.py` the same way.

## File attribution (from `git status`)
- Feature (SIMILAR tier): `alembic/versions/0100_pgvector.py`, `0101_want_similar.py`, `app/embeddings/`, `app/product/embeddings.py`, `app/wants/**`, `app/main.py`, `app/config.py`, the `tests/test_*embeddings*.py` and `test_want*_similar*.py` tests, `tests/conftest.py` (pgvector image, `FakeEmbedder`), `src/matcher/**`, `features/wanted/**` and `reservedCaption`.
- Parallel 0102 change (not this workflow): `alembic/versions/0102_ledger_entries_on_inventories.py`, `tests/test_ledger_entries_on_inventories_migration.py`, `app/inventory/{models,infrastructure/ledger,infrastructure/repository,application/inventory,router,schemas}.py`, `tests/{ledger_assertions,test_inventory_ledger,test_inventory_ledger_tables_migration}.py`, and the `finally` reorder in `tests/test_event_reservations_migration.py` and `tests/test_personal_pickup_migration.py`.

## Open Questions / Risks
1. **Fragile migration-test cleanup (0102 change, medium).** In `test_event_reservations_migration.py:184-193` and `test_personal_pickup_migration.py:199-207, 236-244`, `_alembic(..., "upgrade", "head")` runs first and its return code is never checked. If that upgrade fails once, for example on a 5 s `SET LOCAL lock_timeout` in 0074–0076/0080/0102 under machine load, the committed seed rows leak and about 50 later tests fail with misleading errors. The likely cause in run 1 is a lock timeout. This is not proven, because the upgrade stderr was discarded. Suggestion for the owner of 0102: assert `returncode == 0` on that upgrade, or delete the rows in a way that works below 0102.
2. Run the backend suite alone, not alongside vitest or the matcher suite, until item 1 is addressed.
3. Run-2 count: 1564 backend tests against 1354 in the baseline (+210, from the feature and 0102 tests). All of them pass apart from the two stale ones.

## Raw logs (scratchpad)
- Run 1: `C:\Users\karas\AppData\Local\Temp\claude\179f6a471ae7c590\c65fe494-c2e6-4bed-baae-254e4cccb09a\scratchpad\backend_pytest.txt`
- Run 2: `C:\Users\karas\AppData\Local\Temp\claude\179f6a471ae7c590\c65fe494-c2e6-4bed-baae-254e4cccb09a\scratchpad\backend_pytest2.txt`
- Vitest: `C:\Users\karas\AppData\Local\Temp\claude\179f6a471ae7c590\c65fe494-c2e6-4bed-baae-254e4cccb09a\scratchpad\vitest.txt`
