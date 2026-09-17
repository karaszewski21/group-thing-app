# Phase 5 Technical Clarifications

## Periodic worker implementation for term-end detection (D3 follow-up)

**Decision**: Add **APScheduler** as a new backend dependency
(`pyproject.toml`) to implement the periodic worker that scans for `Term`
rows whose `occurs_on` has just passed and emits the "term ended" domain
event into the outbox exactly once per affected active
giveaway/swap-proposal (idempotency via a marker/flag, per D3 in
`analysis/scope-clarifications.md`).

This is a deliberate exception to the "minimal dependencies" standard,
explicitly chosen by the user over the zero-new-dependency in-process
`asyncio.create_task` loop alternative, in exchange for APScheduler's
built-in misfire handling and schedule management.

Implementation notes for the specification/plan:
- Scheduler must be wired into the FastAPI app lifecycle (start on startup,
  shut down cleanly on app shutdown) — follow whatever composition-root
  pattern `app/main.py` already uses for other startup wiring (e.g. the
  outbox listener registration).
- The scan job itself lives in `app/groups` (or a small new module) since it
  needs to read `Term`/`TermAttendance`/listing-and-proposal state — it must
  not import into `app.circulation` directly; use the existing
  `circulation_bridge` for any cross-context reads it needs.
