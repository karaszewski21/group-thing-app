# Test Suite Results — Handover Quick Wins Phase 0 (re-verification after fixes)

Date: 2026-10-13 · Branch: feat/redesign-organizer-page (uncommitted working tree)

## Status: ✅ passed (no new regressions)
Backend is 100% green. All frontend failures are known pre-existing (fail identically on clean HEAD dfacf08) or known flaky.

## Backend
- Command: `cd src/backend && uv run python -m pytest -q`
- Result: **798 passed, 0 failed, 0 errors, 0 skipped** (413.6 s), exit code 0
- Pass rate: 100%
- Warnings: 37,324 (mostly `datetime.utcnow()` DeprecationWarnings in tests). Not failures.
- Note: some warning paths show `C:\Users\karas\Desktop\group-thing-app\...`. These come from stale `__pycache__` bytecode compiled before the repo was moved. The `app` package resolves to `...\swaptime\group-thing-app\src\backend\app`, so the correct code was tested. Cosmetic only.

## Frontend
- Command: `cd src/frontend && npx vitest run`
- Result: **875 passed, 12 failed, 0 skipped** (887 total; test files: 73 passed, 6 failed), 45.7 s
- Pass rate: 98.6% (99.9% with pre-existing and flaky failures excluded)

| # | Test | File | Classification |
|---|------|------|----------------|
| 1–6 | PanelPage — hamburger promotion (×6) | src/test/PanelPage.test.tsx | Pre-existing (fails on HEAD dfacf08) |
| 7 | TermPage — sign-up footer > anonymous "Zaloguj się, żeby się zapisać" | src/test/TermPage.test.tsx | Pre-existing |
| 8 | AuthContext > provides token/permissions/login/logout via useAuth hook | src/test/auth.test.tsx | Pre-existing |
| 9 | Sidebar with plugin menu items > renders hardcoded items then plugin menu items | src/test/extension-points.test.tsx | Pre-existing |
| 10 | ProductListPage with plugin filters > renders plugin filter iframes | src/test/extension-points.test.tsx | Pre-existing |
| 11 | Frontend Foundation > renders AppShell with sidebar and content area | src/test/foundation.test.tsx | Pre-existing |
| 12 | Organizer editor sheet > saves only the changed layout and closes the sheet | src/test/OrganizerEditor.test.tsx | Flaky under load: the failing step is the focus assertion in `expectSheetClosedAfterSave()` (line 152, `toHaveFocus()`). The file passes 32/32 in isolation in two separate re-runs |

New regressions: **0**

## Issues
- info: OrganizerEditor focus assertion is flaky under full-suite load. Consider using `vi.waitFor` for the `toHaveFocus()` check at line 152 (fixable).
- info: 11 pre-existing frontend failures remain outstanding from HEAD and are not part of this task.
- info: Backend tests emit many `datetime.utcnow()` deprecation warnings.
