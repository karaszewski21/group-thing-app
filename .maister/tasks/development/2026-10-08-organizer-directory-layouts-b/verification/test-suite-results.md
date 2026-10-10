# Test Suite Results — Feature B (organizer read model + SCHEDULE/CIRCLES/EXCHANGE layouts)

**Date**: 2026-10-10
**Scope**: HEAD (1a72956 + 60a7ec7) plus uncommitted verification fixes in working tree
**Status**: ⚠️ passed_with_issues — no regressions; only the 17 known pre-existing frontend failures

## Summary

| Suite | Command | Total | Pass | Fail | Errors | Skipped | Pass rate |
|-------|---------|-------|------|------|--------|---------|-----------|
| Backend (pytest, TestContainers Postgres) | `uv run python -m pytest` (src/backend) | 702 | 702 | 0 | 0 | 0 | 100% |
| Frontend (vitest) | `npx vitest run` (src/frontend) | 780 | 763 | 17 | 0 | 0 | 97.8% |
| Frontend typecheck | `npx tsc -b` | — | clean | 0 | — | — | exit 0 |
| Backend typecheck | `uv run python -m mypy app` | — | — | 32 errors | — | — | = baseline 32 |
| **Combined tests** | | **1482** | **1465** | **17** | 0 | 0 | **98.9%** |

Backend runtime: 403.7s; 33,388 warnings (mostly `datetime.utcnow()` DeprecationWarnings, pre-existing).

## Backend

All 702 tests passed. No HEAD comparison needed because nothing failed.
Feature-related files that were collected and passed: test_organizer_page (12), test_organizer_page_queries (5),
test_organizer_bridges (6), test_organizer_terms (4), test_exchange_summary (8), test_public_term (20), test_public_preview (7).

Note: some warning paths show `C:\Users\karas\Desktop\group-thing-app\...` (that directory does not exist). These come from stale
`__pycache__` .pyc files compiled before the repo moved, which still carry the old file paths. `app` is imported from the
`swaptime` checkout (checked), so the results are valid. Deleting `__pycache__` would remove the misleading paths.

## Frontend failures (all pre-existing, none are regressions)

All 17 match the known list from HEAD exactly (TermPage 5, PanelPage 8, extension-points 2, foundation 1, auth 1).
No organizer test file fails (OrganizerTermsPage.test.tsx and organizerBlocks.test.tsx pass).

| File | Count | Tests |
|------|-------|-------|
| src/test/TermPage.test.tsx | 5 | header subtitle; anonymous sign-up footer; failed fetch of another term shows 'Nie znaleziono'; private-group pending refetch; PRIVATE member full view |
| src/test/PanelPage.test.tsx | 8 | hamburger promotion x6; join-request pending action x2 |
| src/test/extension-points.test.tsx | 2 | Sidebar plugin menu items; ProductListPage plugin filter iframes |
| src/test/foundation.test.tsx | 1 | renders AppShell with sidebar and content area |
| src/test/auth.test.tsx | 1 | AuthContext provides token/permissions/login/logout |

Category: pre-existing (unit/component, jsdom). Related to implementation: no. Regression risk: low.
Flaky: none seen; the failure set is the same as the known baseline.

## mypy

32 errors in 12 files, the same count as the HEAD baseline of 32. The errors are UUID-vs-int typing issues across groups/application
(including public_view.py and exchange_summary.py) plus the untyped apscheduler import. They are not new by count.

## Issues

| Severity | Description | Location | Fixable |
|----------|-------------|----------|---------|
| info | 17 pre-existing FE failures, unchanged from HEAD | src/frontend/src/test/{TermPage,PanelPage,extension-points,foundation,auth}.test.tsx | false (out of scope) |
| info | mypy at baseline (32); no new errors by count | src/backend/app/groups/application/* | false (pre-existing) |
| info | Stale .pyc files show old repo paths in warnings | src/backend/**/__pycache__ | true (delete __pycache__) |

Issue counts: critical 0, warning 0, info 3. Regressions: 0.
