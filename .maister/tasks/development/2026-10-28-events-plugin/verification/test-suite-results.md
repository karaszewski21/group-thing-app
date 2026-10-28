# Test Suite Results — events plugin (re-verification, cycle 1)

## TL;DR
- Backend: **909 passed / 0 failed** (608.8s). Cycle 0 had 908, so one new test was added.
- Frontend: **1195 passed / 10 failed** (1205 tests, 109 files). 8 of the failures are known from before this feature and 2 are flaky. **No new regressions.**
- Plugin build (`plugins/events`, `npm run build` = `tsc -b && vite build`): **succeeded** (exit 0).
- Status: **passed_with_issues** (frontend pass rate 99.2%, and no failure is caused by the feature).

## Key Decisions
- `DeleteGroupDialog.test.tsx` "rejected onConfirm shows role=alert message and keeps dialog open" is not in the baseline list. It is classified as **flaky**, not a regression. It passed 4 of 4 runs in isolation. Neither `src/pages/meetings/DeleteGroupDialog.tsx` nor its test is modified in the working tree. The failure is a focus-timing assertion under full-suite load: `toHaveFocus()` expected the "Anuluj" button, but focus was still on the `role="alertdialog"` container.
- `OrganizerEditor.test.tsx` "saves only the changed layout and closes the sheet" failed again under load and passed in isolation. It was already known to be flaky.

## Open Questions / Risks
- Two tests are now flaky under load (OrganizerEditor, DeleteGroupDialog), and both involve focus or async timing. Neither is related to this feature, but they add noise to full-suite runs. Consider a separate hardening task.

## Commands
| Suite | Directory | Command | Result |
|---|---|---|---|
| Backend | `src/backend` | `uv run python -m pytest -q -p no:cacheprovider` | 909 passed, 0 failed, exit 0 |
| Frontend | `src/frontend` | `npx vitest run` | 1195 passed, 10 failed, exit 1 |
| Plugin | `plugins/events` | `npm run build` | built in 186ms, exit 0 |

## Metrics
| | Total | Passing | Failing | Errors | Skipped | Pass rate |
|---|---|---|---|---|---|---|
| Backend | 909 | 909 | 0 | 0 | 0 | 100% |
| Frontend | 1205 | 1195 | 10 | 0 | 0 | 99.17% |
| Combined | 2114 | 2104 | 10 | 0 | 0 | 99.53% |

Compared with cycle 0: backend went from 908 to 909 passed. Frontend went from 1192 passed / 9 failed to 1195 passed / 10 failed, a net +3 passing. The one extra failure is the flaky DeleteGroupDialog test.

## Frontend failures and their classification
| # | File | Test | Classification | Related to feature | Regression risk |
|---|---|---|---|---|---|
| 1 | src/test/auth.test.tsx | AuthContext > provides token/permissions/login/logout via useAuth hook | pre-existing | no | low |
| 2 | src/test/extension-points.test.tsx | Sidebar with plugin menu items > renders hardcoded items then plugin menu items | pre-existing | area touched (plugins) but failed on clean HEAD too | low |
| 3 | src/test/extension-points.test.tsx | ProductListPage with plugin filters > renders plugin filter iframes in filter bar | pre-existing | area touched (PluginFilterBar) but failed on clean HEAD too | low |
| 4 | src/test/foundation.test.tsx | Frontend Foundation > renders AppShell with sidebar and content area | pre-existing | no | low |
| 5 | src/test/PendingActionsHost.test.tsx | confirm flow > resolves a GIFT reservation id for the owner/lister side directly, post-term-end | pre-existing | no | low |
| 6 | src/test/PublicLayout.test.tsx | logged in: the top bar holds only the brand, Spotkania and the notification bell | pre-existing | PublicLayout.tsx has a 1-line change, but the test failed on clean HEAD too | low |
| 7 | src/test/PublicLayout.test.tsx | the logo is a named link to Start | pre-existing | same as #6 | low |
| 8 | src/test/TermPage.test.tsx | sign-up footer > anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice | pre-existing | no | low |
| 9 | src/test/OrganizerEditor.test.tsx | Organizer editor sheet > saves only the changed layout and closes the sheet | flaky (known) | no | low |
| 10 | src/test/DeleteGroupDialog.test.tsx | rejected onConfirm shows role=alert message and keeps dialog open | flaky (newly seen) | no | low |

All 10 are unit/component tests (Vitest + jsdom).

### Reruns in isolation
- `npx vitest run src/test/DeleteGroupDialog.test.tsx src/test/OrganizerEditor.test.tsx`: 2 files, 34 tests passed.
- `npx vitest run src/test/DeleteGroupDialog.test.tsx` three more times: 4/4 tests passed each time.

DeleteGroupDialog failure under load:
```
Error: expect(element).toHaveFocus()
Expected element with focus: <button type="button">Anuluj</button>
Received element with focus: <div role="alertdialog" aria-modal="true" tabindex="-1">…
```
Probable cause: the test asserts focus moved to the "Anuluj" button right after a rejected `onConfirm`. Under heavy parallel load, the focus move has not yet run when the assertion executes. The cause is in the test and is unrelated to the events plugin changes.

## Backend
909 passed, 0 failed. There are 36,874 warnings, mostly the `datetime.utcnow()` DeprecationWarning in tests and models. These are pre-existing and not caused by this feature.

## Regressions
count: 0

## Issues
| Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|
| test_suite | info | 8 frontend failures that also fail on clean HEAD | listed above | false (not caused by this feature) | track separately |
| test_suite | info | Two focus-timing tests are flaky under full-suite load | src/test/OrganizerEditor.test.tsx, src/test/DeleteGroupDialog.test.tsx | false | wrap the focus assertion in `waitFor` in a separate hardening task |

issue_counts: critical 0, warning 0, info 2
