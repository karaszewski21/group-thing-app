## TL;DR
- Vitest: 1373 cases, 1360 passed, 13 failed (all known pre-existing); 1 flaky id (OrganizerEditor description tab).
- tsc -b: exit 0, 0 errors. eslint: 15 errors, 1 warning (exit 1).
- pytest: 1136 passed, 0 failed, 0 errors. ruff: 76 errors (65 E501, 10 I001, 1 UP017). mypy app: 15 errors in 8 files.
- Gates (A0 = HEAD 2fcb7f5): no baseline-passing Vitest/pytest id may stop passing (compare scripts below); eslint must stay at 15 errors / 1 warning or fewer, tsc at 0 errors, mypy at 15 or fewer.

## Counts per tool

| Tool | Command (cwd) | Exit | Result |
|------|---------------|------|--------|
| Vitest | `npx vitest run --reporter=json` (src/frontend) | 1 | 1373 total / 1360 passed / 13 failed / 0 skipped; 403 suites, 17 failed suites |
| tsc | `npx tsc -b` (src/frontend) | 0 | 0 errors |
| eslint | `npx eslint . -f json` (src/frontend) | 1 | 471 files, 15 errors (8 react-refresh/only-export-components, 7 @typescript-eslint/no-explicit-any), 1 warning (react-hooks/exhaustive-deps) |
| pytest | `uv run python -m pytest -q -rA -p no:cacheprovider` (src/backend) | 0 | 1136 passed, 0 failed, 0 errors, 52969 warnings, 913 s |
| ruff | `uv run python -m ruff check .` (src/backend) | 1 | 76 errors (65 E501, 10 I001, 1 UP017; 11 fixable) |
| mypy | `uv run python -m mypy app` (src/backend) | 1 | 15 errors in 8 files (211 files checked); matches the known baseline of 15 |

## Known Vitest failures (pre-existing, not regressions)

- src/test/AppPage.test.tsx › AppPage — Term/Group ids stay UUID strings (R29) "Nowy termin" group select keeps the selected group's UUID
- src/test/AppPage.test.tsx › AppPage — moderation errors inline in the add-group page and add-term / edit-group forms add term: a rejected createTerm shows an inline alert, creates no needed items and stays on the page
- src/test/AppPage.test.tsx › AppPage — moderation errors inline in the add-group page and add-term / edit-group forms add term: a rejected needed-item name does not block the term — one toast, the page goes to Spotkania
- src/test/AppPage.test.tsx › AppPage — moderation errors inline in the add-group page and add-term / edit-group forms add term: creates the term first, then the needed items by name (no resolveProduct)
- src/test/AppPage.test.tsx › AppPage — per-term public links & copy-link button 'Dodaj termin' dialog keeps 'Potrzebne rzeczy' collapsed behind a small optional button
- src/test/PendingActionsHost.test.tsx › PendingActionsHost — confirm flow resolves a GIFT reservation id for the owner/lister side directly, post-term-end
- src/test/PublicLayout.test.tsx › PublicLayout logged in: the top bar holds only the brand, Spotkania and the notification bell
- src/test/PublicLayout.test.tsx › PublicLayout the logo is a named link to Start
- src/test/TermPage.test.tsx › TermPage — sign-up footer anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice
- src/test/auth.test.tsx › AuthContext provides token/permissions/login/logout via useAuth hook
- src/test/extension-points.test.tsx › ProductListPage with plugin filters renders plugin filter iframes in filter bar
- src/test/extension-points.test.tsx › Sidebar with plugin menu items renders hardcoded items then plugin menu items
- src/test/foundation.test.tsx › Frontend Foundation renders AppShell with sidebar and content area

## Flaky ids

A second full Vitest pass (scratchpad `vitest-A0-pass2.json`) gave 14 failures: the 13 above plus:

- src/test/OrganizerEditor.test.tsx › Organizer editor description tab opens Zdjęcia i opis from the about ghost, previews the typed description live and saves it trimmed

It passed in A0 and failed in pass 2, which matches the known OrganizerEditor flake. Ignore it in later gates via the known-flaky file below. No pytest flakes were checked: only one backend pass was run (15 min).

## Baseline numbers for later gates

- Vitest: 1360 passing ids; the case-count delta is reported by the compare script (baseline 1373).
- tsc: 0 errors.
- eslint: 15 errors, 1 warning.
- pytest: 1136 passing ids.
- ruff: 76. mypy: 15.

## Compare scripts (scratchpad, not committed)

- `C:\Users\karas\AppData\Local\Temp\claude\C--Users-karas-Desktop-swaptime-group-thing-app\1d2a09c5-a177-4001-acce-8aa4b662cc95\scratchpad\compare-vitest.mjs`: `node compare-vitest.mjs <A0.json> <candidate.json> [ignore.json]`; `--list <json>` prints the sorted id list used to make vitest-A0.txt. Ids are `<path from src/> › <fullName>`.
- `C:\Users\karas\AppData\Local\Temp\claude\C--Users-karas-Desktop-swaptime-group-thing-app\1d2a09c5-a177-4001-acce-8aa4b662cc95\scratchpad\compare-pytest.mjs`: `node compare-pytest.mjs <pytest-A0.txt> <candidate -rA output> [ignore.json]`. A raw candidate output works; it reads only the PASSED/FAILED/ERROR/SKIPPED/XFAIL/XPASS lines.
- `C:\Users\karas\AppData\Local\Temp\claude\C--Users-karas-Desktop-swaptime-group-thing-app\1d2a09c5-a177-4001-acce-8aa4b662cc95\scratchpad\vitest-known-flaky.json`: ignore file holding the OrganizerEditor flaky id. Format: `[ids]` or `{"ids":[],"flaky":[],"replacements":{"oldId":"newId"}}`.

Both scripts exit 1 when a baseline-passing id is missing or no longer passing in the candidate, 0 otherwise, and 2 on a usage error.
Self-check: A0 against itself gives 0 regressions and delta +0 for both scripts. Vitest A0 against pass 2 gives 1 regression (the flaky id), and 0 when the flaky file is passed. pytest with one id removed gives 1 regression (`[missing]`), exit 1.

## Files

- vitest-A0.json (raw reporter output, absolute paths), vitest-A0.txt (sorted `file › full name → status` list + TOTAL)
- tsc-A0.txt, eslint-A0.json, eslint-A0.txt (counts by rule + every message)
- pytest-A0.txt (header + sorted -rA result lines; captured log sections dropped), ruff-A0.txt, mypy-A0.txt
- No secret values appeared in any output. Checked by grepping for key names only.
