# Test Suite Results: wants semantic SIMILAR tier (re-verification cycle 2)

> **Cycle 2.** This re-verification ran after fix cycle 2, on the current working tree, on 2026-11-18. It replaces the cycle-1 results.

## TL;DR
- **Status: passed_with_issues.** Every suite matches the HEAD 92659eb baseline, and there are **no new failures**.
- Backend pytest, run alone: 2 failed / 1577 passed / 1 skipped in 20m12s. Both failures are the known stale baseline tests. There was no alembic cascade. ruff 65 and mypy 15 match the baseline.
- Matcher: 125 passed, ruff clean, mypy clean (24 files).
- Frontend: 33 vitest failures, and their ids are IDENTICAL to the baseline (diffed). typecheck shows 0 errors. lint shows 38 problems (10 errors, 28 warnings), the same as the baseline.

## Open Questions / Risks
1. Test counts have gone up since cycle 1. Backend passes went from 1575 to 1577 (+2) and matcher tests from 123 to 125 (+2). These fit the tests added in fix cycle 2. The individual tests were not reconciled.
2. The migration tests that run `alembic upgrade head` in a `finally` block are still fragile under machine load. Keep running the backend suite alone, as was done here.

## Preconditions
- `src/backend/alembic/versions` ends at `0099_wants.py`, `0100_pgvector.py`, `0101_want_similar.py`. There is no 0102.
- The suites ran strictly one after another: backend first, then matcher, then frontend. The backend pytest ran with nothing else running.

## Commands and metrics

| Suite | Command (cwd) | Result | Baseline | Verdict |
|---|---|---|---|---|
| Backend pytest | `uv run python -m pytest -q -p no:warnings` (src/backend) | 2 F / 1577 P / 1 S (1212 s) | 2 F | = baseline |
| Backend ruff | `uv run python -m ruff check .` | 65 errors | 65 | = |
| Backend mypy | `uv run python -m mypy app` | 15 errors in 8 files | 15 | = |
| Matcher pytest | `uv run python -m pytest -q` (src/matcher) | 125 passed (44 s) | n/a | pass |
| Matcher ruff | `uv run python -m ruff check .` | All checks passed | n/a | pass |
| Matcher mypy | `uv run python -m mypy matcher tests` | no issues (24 files) | n/a | pass |
| Frontend vitest | `npx vitest run` (src/frontend) | 33 F / 1873 P (177 files, 12 failing) | 33 F | = (identical ids) |
| Frontend typecheck | `npm run typecheck` | 0 errors | 0 | = |
| Frontend lint | `npm run lint` | 38 problems (10 errors, 28 warnings) | 38 (10/28) | = |

Pass rates: backend 1577/1579 = 99.9%, frontend vitest 1873/1906 = 98.3%, matcher 100%.

## Failures (all pre-existing)

### Backend
- `tests/test_owner_items_page.py::test_getOwnerItems_nearest_privateCircleTermExcludedPublicTermWithPath`: a dict mismatch on the nearest-term (`kind: TERM`) payload. This is the stale assertion from the baseline. Pre-existing; low regression risk.
- `tests/test_terms_circle_occurs_on_index_migration.py::test_migration0053_downgradeUpgrade_roundTrip`: `['circle_group_id'] == ['group_id']`. Stale test, pre-existing.

### Frontend vitest
All 33 failing test ids were extracted and diffed against `2026-11-15-szukam-wanted-mechanism/implementation/baseline/frontend-vitest.txt` (sorted, unique): **IDENTICAL**. The failures are in AppPage, EventPage, PublicLayout, extension-points, routeManifest, foundation, ItemDetailPage, OrganizerItemRoute, ParticipantItemsPreview, PendingActionsHost, reservedSlugs and TermPage. None are in `features/wanted` or the wants tests.

### Lint, ruff, mypy
- No lint problem matches wanted, wants, `SimilarCard` or `reservedCaption`.
- No ruff error is in a want, embeddings, 0100, 0101 or similar file.
- The 15 mypy errors are in `families/bootstrap.py` (1), `groups/application/exchange_summary.py` (3), `public_view.py` (4), `term_item_listings.py` (1), `inventory/application/inventory_items.py` (1), `main.py` (1, the existing apscheduler-stubs import), `organizations/service.py` (1) and `plugin/router.py` (3). All are baseline.

## Regressions
None.

## Raw logs (scratchpad)
- `C:\Users\karas\AppData\Local\Temp\claude\179f6a471ae7c590\c65fe494-c2e6-4bed-baae-254e4cccb09a\scratchpad\be-pytest.txt`
- `C:\Users\karas\AppData\Local\Temp\claude\179f6a471ae7c590\c65fe494-c2e6-4bed-baae-254e4cccb09a\scratchpad\fe-vitest.txt`
- `C:\Users\karas\AppData\Local\Temp\claude\179f6a471ae7c590\c65fe494-c2e6-4bed-baae-254e4cccb09a\scratchpad\fe-lint.txt`
