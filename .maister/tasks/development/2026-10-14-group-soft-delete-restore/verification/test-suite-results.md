# Test Suite Results — group soft delete + admin restore

**Date**: 2026-10-14
**Status**: PASSED (no regressions). 11 known pre-existing frontend failures, plus 1 flaky failure that only shows up in the full run.

## Commands

| Suite | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run python -m pytest -q` (src/backend) | 846 passed, 0 failed, 806.9s, exit 0 |
| Backend types | `uv run python -m mypy app` (src/backend) | 32 errors in 12 files, same as the baseline of 32 |
| Frontend tests | `npx vitest run` (src/frontend) | 913 passed, 12 failed (925 total); 82 files, 6 failing |
| Frontend types | `npx tsc -p tsconfig.app.json --noEmit` (src/frontend) | exit 0, no errors |

## Metrics

| | Total | Passing | Failing | Errors | Skipped | Pass rate |
|---|---|---|---|---|---|---|
| Backend pytest | 846 | 846 | 0 | 0 | 0 | 100% |
| Frontend vitest | 925 | 913 | 12 | 0 | 0 | 98.7% |
| Combined | 1771 | 1759 | 12 | 0 | 0 | 99.3% |

The new backend test files (`test_group_soft_delete*.py`, 35 tests) were collected and passed.

## Frontend failures

### Known pre-existing, also failing on main (11)

1. PanelPage.test.tsx > PanelPage — hamburger promotion > "Moja organizacja" links directly to the public organization page once one already exists
2. PanelPage.test.tsx > PanelPage — hamburger promotion > completing the GUEST 2-step flow calls createMyCircle then createTerm and flips isOrganizer to true after reload
3. PanelPage.test.tsx > PanelPage — hamburger promotion > shows "Dodaj pierwszy termin" (not "Chcę dodać krąg") for a GUEST-without-circle session and opens FirstTermStepperGuest
4. PanelPage.test.tsx > PanelPage — hamburger promotion > shows "Moja organizacja" (linking to /organization) for an organizer session with no Organization yet
5. PanelPage.test.tsx > PanelPage — hamburger promotion > shows an inline error (not a silent failure) when createMyCircle rejects in the GUEST stepper
6. PanelPage.test.tsx > PanelPage — hamburger promotion > shows neither hamburger item for an ORGANIZER who already has terms
7. auth.test.tsx > AuthContext > provides token/permissions/login/logout via useAuth hook
8. foundation.test.tsx > Frontend Foundation > renders AppShell with sidebar and content area
9. extension-points.test.tsx > Sidebar with plugin menu items > renders hardcoded items then plugin menu items
10. extension-points.test.tsx > ProductListPage with plugin filters > renders plugin filter iframes in filter bar
11. TermPage.test.tsx > TermPage — sign-up footer > anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice

### Other failure (1): flaky, not a regression

- **OrganizerEditor.test.tsx > Organizer editor sheet > saves only the changed layout and closes the sheet**
  - Error: `expect(element).toHaveFocus()`. After the sheet closed, focus had not returned to the "Ustawienia" opener button.
  - Type: unit/component. Related to the implementation: no. This task did not modify the test file or the organizer editor component; the file was last changed in 747783d.
  - Rerunning the file on its own (`npx vitest run src/test/OrganizerEditor.test.tsx`) gave 32/32 passed, 3 runs out of 3.
  - Classification: a flake caused by focus-return timing when the full suite runs under parallel load. Regression risk: low.
  - Suggestion (optional, separate task): wrap the focus assertion in `await waitFor(() => expect(btn).toHaveFocus())`.

## Regressions

None. All backend tests pass. mypy is at the baseline count. tsc is clean. Apart from the 11 known failures, the only frontend failure is the unrelated flaky test above.

Modified frontend tests in this task (AdminGroupsPage, PanelPage outside the known hamburger group, RzeczyViewCategory) and the new ones (DeleteGroupDialog, useModerationGroups) all pass.

## Notes

- pytest warning output shows some paths under `C:\Users\karas\Desktop\group-thing-app\...`. That directory does not exist. The paths are stale `co_filename` values in cached bytecode. `app` was confirmed to import from `C:\Users\karas\Desktop\swaptime\group-thing-app\src\backend`.
- uv prints a warning that an unrelated `VIRTUAL_ENV` (group-thing-ai) is active and ignores it. The project `.venv` was used.
- Most of the 39135 pytest warnings are `datetime.utcnow()` DeprecationWarnings. Per the domain-clock standard, `utcnow()` is intentional for audit timestamps.

## Issue summary

| Severity | Count | Description |
|---|---|---|
| critical | 0 | none |
| warning | 0 | none |
| info | 2 | 11 known pre-existing frontend failures; 1 flaky OrganizerEditor focus assertion under full-suite load |
