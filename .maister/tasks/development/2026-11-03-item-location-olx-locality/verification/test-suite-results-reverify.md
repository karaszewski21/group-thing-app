# Test Suite Results — Re-verification (2026-11-04)

## TL;DR

**Status: passed_with_issues** (no regressions; every frontend failure is on the pre-existing clean-HEAD list)

| Suite | Command | Result |
|-------|---------|--------|
| Backend pytest | `uv run python -m pytest -q` (src/backend) | **1176 / 1176 passed**, 0 failed, 0 errors (796 s); was 1174 |
| Backend mypy | `uv run python -m mypy app` | **15 errors in 8 files** = baseline 15 |
| Frontend vitest | `npx vitest run` (src/frontend) | **1482 / 1503 passed**, 21 failed (7 files); was 1477/1498 |
| Frontend typecheck | `npm run typecheck` | **4 errors**, all pre-existing TS6133 in `ThreadPage.tsx` |

Pass rates: backend 100%, frontend 98.6%, combined 2658/2679 = 99.2%.
New tests since the previous run: +2 backend, +5 frontend, all passing.

## Open Questions / Risks

- The 21 frontend failures are pre-existing and unrelated to this task, but they still mask any regression in the same test cases (AppPage add-term/edit-group in particular, which touch place/location fields). Fixing them is a separate task.
- The previous run counted ~9 added tests; the measured delta is +7 (2 backend, 5 frontend). Some of the fixes may have changed existing tests instead of adding new ones. This doesn't affect the verdict.
- OrganizerEditor (known flaky) passed this run.
- The backend emits about 54.6k DeprecationWarnings (`datetime.utcnow()`). This is pre-existing and intentional under the domain-clock standard.

## Backend

- `1176 passed, 54664 warnings in 796.22s (0:13:16)`, exit 0.
- The mypy errors are the same 15 as the baseline (`exchange_summary.py` / `public_view.py` UUID vs int, `families/bootstrap.py`, `main.py` apscheduler stubs, etc.). None are new.

## Frontend vitest failures (all pre-existing, related_to_implementation: false, regression_risk: low)

| File | Count | Tests |
|------|-------|-------|
| `src/test/AppPage.test.tsx` | 12 | delete group ×2 (confirm calls deleteGroup; load survives 404); edit group ×4 (pre-fills default place/capacity; pre-fills name/layout_mode; saves every field; inline error on rejected save); add-term ×5 (rejected createTerm inline alert; rejected needed-item name toast; creates term then needed items; 'Dodaj termin' collapsed 'Potrzebne rzeczy'; R29 "Nowy termin" group select UUID); RSVP ×1 (leader's own RSVP under "Zapisane", not "Prowadzę") |
| `src/test/PublicLayout.test.tsx` | 3 | chat thread keeps top bar/drops search; logged-in top bar contents; logo named link to Start |
| `src/test/extension-points.test.tsx` | 2 | ProductListPage plugin filter iframes; Sidebar plugin menu items |
| `src/test/TermPage.test.tsx` | 1 | anonymous 'Zaloguj się, żeby się zapisać' opens login/guest choice |
| `src/test/foundation.test.tsx` | 1 | renders AppShell with sidebar and content area |
| `src/test/LayoutRenderer.test.tsx` | 1 | LINKS directory buttons + SCHEDULE compact hero |
| `src/test/PendingActionsHost.test.tsx` | 1 | resolves GIFT reservation id for owner/lister side post-term-end |

These match the pre-existing breakdown exactly: AppPage 12 (add-term 5, edit-group 4, RSVP 1, delete-group 2), TermPage 1, PublicLayout 3, extension-points 2, foundation 1, LayoutRenderer 1, PendingActionsHost 1. **Regressions: 0.**

## Typecheck

`src/features/messages/ThreadPage.tsx`: TS6133 unused `useAppNavigate` (2,16), `useHasInAppHistory` (2,46), `BackIcon` (10,1) and `isItem` (137,9). All 4 are pre-existing.

## Issue summary

- critical: 0
- warning: 1 (21 pre-existing frontend failures, not fixable within this task)
- info: 2 (4 pre-existing TS6133; mypy baseline 15)
