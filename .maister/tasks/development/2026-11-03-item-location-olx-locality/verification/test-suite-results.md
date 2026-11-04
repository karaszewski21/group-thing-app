# Test Suite Results — item-location-olx-locality

## TL;DR
- Status: **passed_with_issues**. No regressions: every failure is in the known pre-existing set.
- Backend pytest: **1174 passed, 0 failed** (820.8 s). mypy: **15 errors**, the same as the baseline.
- Frontend vitest: **1477 passed, 21 failed** (1498 tests; 7 of 148 files failed). All 21 match the known pre-existing list exactly. OrganizerEditor passed this run.
- Typecheck: **4 errors**, all the pre-existing TS6133 errors in `ThreadPage.tsx`.

## Key Decisions
- Failures were classified against the orchestrator's list of known clean-HEAD failures. Each failing test name was checked against that list, and the counts match by group (AppPage 12, TermPage 1, PublicLayout 3, extension-points 2, foundation 1, LayoutRenderer 1, PendingActionsHost 1 = 21).

## Open Questions / Risks
- The pre-existing AppPage failures cover add-term, edit-group default place/capacity and group selection. Those are next to the location work, so if they are later fixed on HEAD, the location-related forms should be checked again. They still don't count as regressions.
- One pytest warning shows `tests/test_swap_proposal_model.py` under `C:\Users\karas\Desktop\group-thing-app\...` (a different checkout path), which is probably a stale `.pyc`/`co_filename`. It doesn't affect results, but it's worth a look if paths are ever confusing.
- About 54.6k DeprecationWarnings (`datetime.utcnow()`), which are pre-existing and expected under the domain-clock standard.

## Commands
| Suite | Command (cwd) | Result |
|---|---|---|
| Backend tests | `uv run python -m pytest -q` (src/backend) | 1174 passed, 0 failed, 0 errors, 0 skipped; 100% |
| Backend types | `uv run python -m mypy app` (src/backend) | 15 errors in 8 files (baseline 15) |
| Frontend tests | `npx vitest run` (src/frontend) | 1477 passed / 21 failed of 1498; 98.6% |
| Frontend types | `npm run typecheck` (src/frontend) | 4 errors (pre-existing ThreadPage.tsx TS6133) |

Combined: 2651 passed / 21 failed of 2672 (99.2%).

## Metrics
- total: 2672 (backend 1174 + frontend 1498)
- passing: 2651
- failing: 21
- errors: 0
- skipped: 0
- pass_rate: 99.2%

## Frontend failures (all pre-existing, related_to_implementation: false, regression_risk: low, type: unit/component)
**src/test/AppPage.test.tsx (12)**
- add-term (5): moderation › rejected createTerm inline alert; moderation › rejected needed-item name toast; moderation › creates term then needed items; per-term links › 'Dodaj termin' keeps 'Potrzebne rzeczy' collapsed; R29 › "Nowy termin" group select keeps UUID
- edit-group (4): pre-fills default place and capacity / sends null; pre-fills name and layout_mode; saves every field in one updateGroup call; inline error on rejected save
- "Prowadzę" RSVP (1): leader's own RSVP shows under "Zapisane"
- delete group "· N" (2): confirm calls deleteGroup; load survives 404 from getGroup

**Other (9)**
- src/test/TermPage.test.tsx: anonymous 'Zaloguj się, żeby się zapisać' opens login/guest choice
- src/test/PublicLayout.test.tsx (3): chat thread keeps top bar/drops search; logged-in top bar contents; logo is a named link to Start
- src/test/extension-points.test.tsx (2): ProductListPage plugin filter iframes; Sidebar plugin menu items
- src/test/foundation.test.tsx: renders AppShell with sidebar and content area
- src/test/LayoutRenderer.test.tsx: LINKS directory buttons / SCHEDULE compact hero
- src/test/PendingActionsHost.test.tsx: GIFT reservation id for owner/lister side post-term-end

## Regressions
count: 0

## Issue summary
- critical: 0
- warning: 0
- info: 3 (21 pre-existing vitest failures; 4 pre-existing typecheck errors; mypy at baseline 15)
