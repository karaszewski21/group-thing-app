# Test Suite Results — item-vinted-categories

## TL;DR
- Status: **passed_with_issues**. No regressions; every frontend failure is either on the known HEAD baseline or a flake under load.
- Backend pytest: **878 / 878 passed** (100%). The run took 1:05:03 because the machine was loaded.
- Frontend Vitest: 1155 / 1161 passed. The 5 known baseline failures remain, plus 1 OrganizerEditor flake that passed 32/32 when its file was re-run alone.
- `tsc -p tsconfig.app.json --noEmit`: clean (exit 0). `npm run lint`: 16 problems (15 errors, 1 warning), the same count as HEAD, and none are in this task's files.

## Key Decisions
- The OrganizerEditor "description tab" failure is classed as a load flake, not a regression. Re-running `src/test/OrganizerEditor.test.tsx` alone gave 32/32 passing, which matches the flake note in the brief.
- The 5 baseline failures were matched by test name to the known HEAD list and treated as out of scope.

## Commands
| Suite | Command (cwd) | Result |
|---|---|---|
| Backend | `uv run python -m pytest -q -p no:cacheprovider -W ignore::DeprecationWarning` (src/backend) | 878 passed, 0 failed, 0 skipped, exit 0 |
| Frontend tests | `npx vitest run` (src/frontend) | 108 files (103 passed, 5 failed); 1161 tests (1155 passed, 6 failed) |
| Frontend tests, isolated re-run | `npx vitest run src/test/OrganizerEditor.test.tsx` | 32/32 passed |
| Type-check | `npx tsc -p tsconfig.app.json --noEmit` | exit 0, no errors |
| Lint | `npm run lint` | 16 problems (15 errors, 1 warning), same as baseline |

## Metrics
| Suite | Total | Passing | Failing | Skipped | Pass rate |
|---|---|---|---|---|---|
| Backend pytest | 878 | 878 | 0 | 0 | 100% |
| Frontend Vitest (full run) | 1161 | 1155 | 6 | 0 | 99.48% |
| Frontend after flake re-run | 1161 | 1156 | 5 (all baseline) | 0 | 99.57% |
| Combined | 2039 | 2034 | 5 | 0 | 99.75% |

## Failures (frontend, all unit/component tests)
| Test | File | Classification | Regression risk |
|---|---|---|---|
| AuthContext > provides token/permissions/login/logout via useAuth hook | src/test/auth.test.tsx | Known baseline (JWT fixture expired around 2026-10-26) | low |
| Sidebar with plugin menu items > renders hardcoded items then plugin menu items | src/test/extension-points.test.tsx | Known baseline ("Krąg grupy" vs "Panel") | low |
| ProductListPage with plugin filters > renders plugin filter iframes in filter bar | src/test/extension-points.test.tsx | Known baseline | low |
| Frontend Foundation > renders AppShell with sidebar and content area | src/test/foundation.test.tsx | Known baseline | low |
| TermPage — sign-up footer > anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice | src/test/TermPage.test.tsx | Known baseline ("Imię" label has no associated control) | low |
| Organizer editor description tab > opens Zdjęcia i opis from the about ghost, previews the typed description live and saves it trimmed | src/test/OrganizerEditor.test.tsx | Flake under load; passed when run alone | low |

## Regressions
Count: 0.

## Lint (baseline, unrelated to this task)
The 16 problems are in AuthContext.tsx, onboarding/steps/organizerSteps.tsx, shared/Icons.tsx, plugins/PluginContext.tsx, plugins/PluginFrame.tsx (the warning), router.tsx, test/plugin-sdk-auth.test.ts, test/plugin-sdk.test.ts and test/plugins.test.tsx. None of these files belong to the categories or add-item feature.

## Issues
| Severity | Description | Location | Fixable |
|---|---|---|---|
| info | 5 known baseline frontend failures still fail; out of scope | see table above | true (separate task) |
| info | OrganizerEditor description tab flakes under load | src/test/OrganizerEditor.test.tsx | false (timing/environment) |

## Open Questions / Risks
- The backend run took 65 min instead of the usual ~7 min because the machine was loaded. Timing is not a concern for correctness, but a slower machine could hit the agents' timeouts.
