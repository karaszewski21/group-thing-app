# TDD Green Gate

Date: 2026-10-13. Status: **GREEN confirmed** — every test from `tdd-red-gate.md` now passes.

## Backend — `src/backend/tests/test_term_clock_regressions.py` (unchanged since Red)
Command: `cd src/backend && uv run python -m pytest tests/test_term_clock_regressions.py` → **6 passed**

| Test | Red | Green |
|---|---|---|
| take after start, UTC server → "Termin już się odbył" | DID NOT RAISE | pass |
| confirm after start, UTC server → FULFILLED | "Termin jeszcze się nie odbył" | pass |
| accept swap after start → "Termin już się odbył" | DID NOT RAISE | pass |
| scan within 2h grace → no event | 1 == 0 | pass |
| swap for later Term not prompted when earlier Term ends | 1 == 0 | pass |
| control: scan past grace → 1 event | pass | pass |

## Frontend
The test relocated (with the modal) from `PanelPage.test.tsx` to `src/frontend/src/test/PendingActionsHost.test.tsx`, same assertion; expected title is now "Potwierdź przekazanie".
Command: `cd src/frontend && npx vitest run src/test/PendingActionsHost.test.tsx -t "snoozes it without marking"` → **1 passed**

## Fixes that made them pass
- `app/core/clock.py` `local_now()` (Europe/Warsaw from a UTC instant) used at every Term-time comparison (Groups 1, 2).
- Accept-swap Term gate (Group 2).
- `TERM_END_GRACE = 2h` + swap scoping by `proposer_reservation.term_id` in `term_end_scan.py` (Group 3).
- `PendingActionsHost` snooze store — "Później" no longer calls `markNotificationRead` (Group 10).
