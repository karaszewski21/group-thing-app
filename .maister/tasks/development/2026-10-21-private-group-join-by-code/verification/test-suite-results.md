# Test Suite Results — Re-verification Cycle 3

## TL;DR
- Status: **passed_with_issues**. No regressions.
- Backend: 860/860 passed (100%). Frontend: 1015/1022 passed. All 7 failures are known: 6 pre-existing and 1 flaky (OrganizerEditor, passed 32/32 when re-run alone).
- `tsc -b` is clean (exit 0). `TermPage.test.tsx` ran 3 times with the same result each time: 57/58, and the only failure is the pre-existing sign-up-footer test.
- Pass rate excluding the pre-existing failures: frontend 1015/1016 = 99.90% (100% once the flaky test is counted as passing on re-run); overall 1875/1876 = 99.95%.
- Compared with cycle 2: backend 860/860 → 860/860; frontend 1014/1021 → 1015/1022. The +1 is the new G2 test, and the failing set is the same: 6 pre-existing + 1 flaky.

## Open Questions / Risks
- The pre-existing TermPage failure ("anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice") is in the sign-up footer of the same file that changed in this cycle. Its error ("Found a label with the text of: Imię, however no form control was found") is the same failure seen on untouched HEAD, so it is not caused by this cycle's changes. But it also means this test cannot detect anything new in that flow.
- Backend warnings print test paths under `C:\Users\karas\Desktop\group-thing-app\...`, which no longer exists. `app` imports from the swaptime checkout. The old path probably comes from stale `__pycache__` bytecode left from before the project was moved; it is cosmetic and did not affect the results.

## Commands
| Suite | Command (cwd) | Result |
|---|---|---|
| Backend | `uv run python -m pytest -q -p no:cacheprovider` (`src/backend`) | 860 passed, 0 failed, 39027 warnings, 403 s, exit 0 |
| Frontend | `npx vitest run` (`src/frontend`) | 93 files (6 failed / 87 passed); 1022 tests (7 failed / 1015 passed) |
| Frontend type-check | `npx tsc -b` | exit 0, no output |
| Flaky re-run | `npx vitest run src/test/OrganizerEditor.test.tsx` | 32/32 passed |
| Stability ×3 | `npx vitest run src/test/TermPage.test.tsx` | Runs 1, 2 and 3: 57 passed / 1 failed (the same pre-existing test each time) |

## Metrics
| Suite | Total | Passing | Failing | Errors | Skipped | Pass rate | Pass rate excl. pre-existing |
|---|---|---|---|---|---|---|---|
| Backend | 860 | 860 | 0 | 0 | 0 | 100% | 100% |
| Frontend | 1022 | 1015 | 7 | 0 | 0 | 99.32% | 99.90% (1015/1016) |
| Combined | 1882 | 1875 | 7 | 0 | 0 | 99.63% | 99.95% (1875/1876) |

## Failures (frontend)
| # | Test | File | Error (short) | Classification |
|---|---|---|---|---|
| 1 | AuthContext > provides token/permissions/login/logout via useAuth hook | src/test/auth.test.tsx | `toHaveTextContent` mismatch on the token | Pre-existing |
| 2 | Sidebar with plugin menu items > renders hardcoded items then plugin menu items | src/test/extension-points.test.tsx | Unable to find text "Krąg grupy" | Pre-existing |
| 3 | ProductListPage with plugin filters > renders plugin filter iframes in filter bar | src/test/extension-points.test.tsx | expected 0 iframes ≥ 1 | Pre-existing |
| 4 | Frontend Foundation > renders AppShell with sidebar and content area | src/test/foundation.test.tsx | Unable to find text "Tomorrow" | Pre-existing |
| 5 | PanelPage — delete group (soft delete) > 409 message is shown inline in the dialog | src/test/PanelPage.test.tsx | Multiple buttons match `/^Usuń grupę /` | Pre-existing |
| 6 | TermPage — sign-up footer > anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice | src/test/TermPage.test.tsx | Label "Imię" has no associated form control | Pre-existing (same result in all 3 isolated runs) |
| 7 | Organizer editor colors tab > restores the default palette from a preset with three explicit nulls (link) | src/test/OrganizerEditor.test.tsx | `toHaveFocus` failed | Flaky (32/32 when run alone; the file was not touched in this cycle) |

Regressions: **0**. None of the failures is in code changed this cycle (TermPage.tsx, PrivateGroupGate.tsx, TermPage.test.tsx), apart from the pre-existing #6.

## Issues
| Severity | Description | Location |
|---|---|---|
| info | 6 failures that also fail on HEAD, unrelated to this task | auth/extension-points/foundation/PanelPage/TermPage tests |
| info | Known flaky focus assertion in OrganizerEditor (passes when run alone) | src/test/OrganizerEditor.test.tsx |

issue_counts: critical 0, warning 0, info 2
