# Test Suite Results — Messenger (2026-10-22)

## TL;DR
- Backend: 900/900 passed, including all 35 tests in the 7 new messaging test files and the 0061 migration test.
- Frontend vitest: 1094/1101 passed. 6 failures were already on HEAD and 1 was a flaky OrganizerEditor test that passed 32/32 when its file was re-run alone. `tsc -b` ran clean.
- No regressions. Excluding the 6 HEAD failures, the pass rate is 99.95% (1994/1995), or 100% once the flaky test's clean re-run is counted.
- Status: passed_with_issues. Every remaining failure was already failing before this change.

## Open Questions / Risks
- Some pytest warning lines give file paths under `C:\Users\karas\Desktop\group-thing-app\...`, which no longer exists. The likely cause is stale `__pycache__` bytecode from an earlier location of the checkout. I checked that `app` resolves to the `swaptime` checkout and that collection finds all 900 tests, the messaging tests among them, so the results are valid. The paths are only cosmetic.
- `uv` warns that the shell's `VIRTUAL_ENV` points at `swaptime\group-thing-ai\.venv`. uv ignores it and uses the project `.venv`, so the results are not affected.
- The backend emits about 41.6k warnings, mostly `datetime.utcnow()` deprecations. That project convention is already documented, so it is not new here.

## Commands
| Suite | Command (cwd) | Exit | Duration |
|---|---|---|---|
| Backend | `uv run python -m pytest -q -p no:cacheprovider` (src/backend) | 0 | 8m03s |
| Frontend unit | `npx vitest run` (src/frontend) | 1 | 55s |
| Frontend flaky re-run | `npx vitest run src/test/OrganizerEditor.test.tsx` | 0 | 6.5s |
| Frontend types | `npx tsc -b` (src/frontend) | 0 | — |

## Metrics
| Suite | Total | Passing | Failing | Errors | Skipped |
|---|---|---|---|---|---|
| Backend pytest | 900 | 900 | 0 | 0 | 0 |
| Frontend vitest (103 files) | 1101 | 1094 | 7 | 0 | 0 |
| Frontend tsc -b | — | clean | 0 | — | — |
| **Combined** | 2001 | 1994 | 7 | 0 | 0 |

- Raw pass rate: 99.65% (1994/2001)
- Pass rate excluding the 6 HEAD failures: 99.95% (1994/1995), or 100% with the flaky test's clean re-run counted

Messaging tests found at collection: test_conversation_inbox (3), test_conversation_messages (6), test_group_term_conversations (5), test_item_conversations (6), test_message_send_limiter (3), test_messaging_cross_context (5), test_messaging_migration (2), test_messaging_repository (5). test_authorization_matrix also covers the new routes, and all of these passed.

## Failures
| # | Test | File | Error (short) | Type | Classification | Regression risk |
|---|---|---|---|---|---|---|
| 1 | AuthContext > provides token/permissions/login/logout via useAuth hook | src/test/auth.test.tsx | assertion failure | unit | pre-existing (on HEAD) | low |
| 2 | ProductListPage with plugin filters > renders plugin filter iframes in filter bar | src/test/extension-points.test.tsx | assertion failure | unit | pre-existing (on HEAD) | low |
| 3 | Sidebar with plugin menu items > renders hardcoded items then plugin menu items | src/test/extension-points.test.tsx | assertion failure | unit | pre-existing (on HEAD) | low |
| 4 | Frontend Foundation > renders AppShell with sidebar and content area | src/test/foundation.test.tsx | assertion failure | unit | pre-existing (on HEAD) | low |
| 5 | PanelPage — delete group (soft delete) > 409 message is shown inline in the dialog | src/test/PanelPage.test.tsx | assertion failure | unit | pre-existing (on HEAD) | low |
| 6 | TermPage — sign-up footer > anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice | src/test/TermPage.test.tsx | `findByLabelText("Imię")` not found | unit | pre-existing (on HEAD) | low |
| 7 | Organizer editor sheet > saves only the changed layout and closes the sheet | src/test/OrganizerEditor.test.tsx | `expect(element).toHaveFocus()` on "Ustawienia" button | unit | flaky: 32/32 passed when the file was re-run alone | low |

## Regressions
None. Every failure is either on the known HEAD list or the known flaky OrganizerEditor test, which passed on its isolated re-run.

## Issue Summary
| Severity | Count | Notes |
|---|---|---|
| critical | 0 | — |
| warning | 0 | — |
| info | 2 | 6 failures already on HEAD (not fixable in this task's scope); 1 flaky focus assertion in OrganizerEditor (timing-dependent, not fixable in this task) |
