# Test Suite Results — Re-verification (cycle 2)

## TL;DR
- Status: **passed_with_issues**. Every failure is a known HEAD baseline; nothing regressed since cycle 1.
- Backend: 881 passed, 0 failed (cycle 1: 878). Took 508s.
- Frontend vitest: 1161 passed, 5 failed (cycle 1: 1159 / 5). All 5 failures are on the baseline list.
- tsc (`tsconfig.app.json`): clean. Lint: 16 problems (15 errors, 1 warning), the same as the baseline.

## Key Decisions
- The 5 frontend failures count as baseline, not regressions. They are the same tests named in the known-baseline list and in cycle 1.
- No file was re-run in isolation. No flaky failures came up (OrganizerEditor and useUnreadMessages passed).

## Commands
| Suite | Command (cwd) | Result |
|-------|---------------|--------|
| Backend | `uv run python -m pytest -q -p no:cacheprovider -W ignore::DeprecationWarning` (src/backend) | 881 passed, exit 0 |
| Frontend tests | `npx vitest run` (src/frontend) | 1161 passed / 5 failed, 108 files (104 pass / 4 fail) |
| Type check | `npx tsc -p tsconfig.app.json --noEmit` | exit 0 |
| Lint | `npm run lint` | 16 problems (baseline 16) |

## Metrics
| | Total | Passing | Failing | Errors | Skipped | Pass rate |
|---|---|---|---|---|---|---|
| Backend | 881 | 881 | 0 | 0 | 0 | 100% |
| Frontend | 1166 | 1161 | 5 | 0 | 0 | 99.57% |
| Combined | 2047 | 2042 | 5 | 0 | 0 | 99.76% |

## Delta vs cycle 1
- Backend: +3 net (878 → 881). This fits the reported changes: new tests for needed-item description moderation, GZip, category name stripping and 0069 outbox staging, minus the removed release_reservation test.
- Frontend: +2 passing (1159 → 1161). The failing set is the same.
- Regressions: **0**.

## Failures (all known baseline, unrelated to this task)
| Test | File | Cause (known) | Type | Related | Regression risk |
|------|------|---------------|------|---------|-----------------|
| AuthContext > provides token/permissions/login/logout via useAuth hook | src/frontend/src/test/auth.test.tsx | Expired JWT fixture | unit | no | low (baseline) |
| Sidebar with plugin menu items > renders hardcoded items then plugin menu items | src/frontend/src/test/extension-points.test.tsx | Sidebar removed by header/nav rework at HEAD | integration | no | low (baseline) |
| ProductListPage with plugin filters > renders plugin filter iframes in filter bar | src/frontend/src/test/extension-points.test.tsx | HEAD baseline | integration | no | low (baseline) |
| Frontend Foundation > renders AppShell with sidebar and content area | src/frontend/src/test/foundation.test.tsx | HEAD baseline (sidebar) | integration | no | low (baseline) |
| TermPage — sign-up footer > anonymous: 'Zaloguj się, żeby się zapisać' opens the login / guest choice | src/frontend/src/test/TermPage.test.tsx | "Imię" label baseline | integration | no | low (baseline) |

## Open Questions / Risks
- 5 baseline frontend failures and 16 lint problems are still open at HEAD. They are pre-existing tech debt outside this task's scope.
