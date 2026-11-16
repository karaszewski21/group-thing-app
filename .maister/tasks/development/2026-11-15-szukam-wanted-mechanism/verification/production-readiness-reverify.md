# Production Readiness Re-verification (cycle 1)

**Date**: 2026-11-16
**Path**: `src/backend/alembic/versions/0099_wants.py`, `src/backend/app/main.py` (`_run_want_scan`), `src/backend/app/wants/application/{scan,match_notifications,writes,matcher}.py`, `.maister/docs/project/architecture.md` ("Deploy / rollback for wants (migration 0099)"), `.maister/docs/INDEX.md`, `.maister/docs/standards/backend/time.md`
**Target**: production
**Status**: Not Ready (release gate only)
**Previous report**: `verification/production-readiness-report.md`

## TL;DR
- **NO-GO**, for the same single reason as before: the release gate (score the labelled Polish sample, set the thresholds) is still open. This is expected, by user decision.
- Fixed and verified: C1 (runbook verify step), C2 (rollback order), C3 (the downgrade deletes the WANT_* rows), and the code part of C4 (`logger.exception`). The new ACTIVE-only lock in the scan is correct and is tested.
- C5 (rate limit) and C6 (sweep locks) remain recorded risks by user decision. C4 has a residual part: there is still no alert.
- One new low-severity note: the scan's want row lock and a seeker's matching edit can deadlock. The seeker then gets a 500. This was possible before the fix, and the fix makes the lock come earlier. Tests: no new failures.

## Key Decisions
- The release gate is still the only **blocker**. It is a process gate, not a code defect, and it stays closed until the follow-up task (user decision).
- C5 and C6 are listed as **accepted risks**, not open concerns, because the user decided to keep them as recorded risks.
- The new scan/seeker deadlock is graded **info**. It needs an edit that changes matching to land inside the short write phase of a 15-minute scan, on a want that the same run has just paired. Production runs a single process.

## Open Questions / Risks
- The release gate still has no owner or date, and the whole release waits on it.
- Repeated scan failures now leave a formatted ERROR line, but nothing alerts on it. Nothing watches the age of `want_scan_markers.scanned_through` either.

## Executive Summary
- **Recommendation**: NO-GO until the release gate is closed. After that: GO with mitigations (accepted risks C5, C6 and the reverse-scan cost).
- **Overall Readiness**: 86% (was 80%)
- **Deployment Risk**: Medium while the gate is open. Low once it is closed.
- **Blockers**: 1  Concerns: 1  Recommendations: 5

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | Ready. No change. No new env vars or secrets. |
| Monitoring | 80% | With concerns. Failures are logged with `logger.exception` under `app.main`. No alert or marker-age check (project-wide). |
| Resilience | 88% | Ready. The scan locks only ACTIVE wants, in id order. The new note N1 is about a deadlock with seeker edits. |
| Performance | 80% | Unchanged. Reverse-scan cost and C6 are accepted risks. |
| Security | 85% | Unchanged. No rate limit (C5) is an accepted risk. |
| Deployment | 85% | The runbook and the downgrade are fixed. The release gate is still open. |

## Previous findings: resolved / residual

| # | Previous finding | Result | Evidence |
|---|---|---|---|
| B1 | Release gate open (sample not scored) | **Residual (blocker, expected)** | `architecture.md` 0099 runbook still opens with **Release gate**: "Do not deploy this release until…". `INDEX.md` repeats it. |
| C1 | Runbook verify step relied on a DEBUG log line | **Resolved** | Runbook step 3 now reads `want_scan_markers` after the first run and again after the next run, and expects a later `scanned_through`. It adds: "Do not look for a log line: a run that found nothing logs at DEBUG only." |
| C2 | Order of the image-only rollback not stated | **Resolved** | Rollback steps 1-3 in the runbook: stop the new backend, then the manual `DELETE` (image-only) or `alembic downgrade 0098`, then start the old image. |
| C3 | 0099 downgrade left WANT_* notification rows | **Resolved** | `0099_wants.py:151`: `DELETE FROM notifications WHERE kind IN ('WANT_MATCH_FOUND', 'WANT_EXPIRING')`. It runs first, after `SET LOCAL lock_timeout = '5s'` (line 150). The docstring is updated. `tests/test_wants_migration.py::test_migration0099_downgradeUpgrade_roundTrip` seeds a `WANT_MATCH_FOUND` row and a `SWAP_PROPOSED` row (line 91). |
| C4 | No alert / log on repeated scan failures | **Partly resolved** (logging fixed, alert residual) | `main.py:90-105`: a non-marker `IntegrityError` and any other exception call `logger.exception("want scan failed")` and re-raise. `tests/test_wants_scan.py:406` asserts the ERROR record. There is still no alert, error tracking or marker-age check (project-wide). |
| C5 | No per-user rate limit on want writes that re-run a match | **Residual, accepted risk** (user decision) | No change in `router/wants.py`. |
| C6 | Sweep locks during the match; unbounded window after downtime | **Residual, accepted risk** (user decision) | `scan.py::scan_wants`: expire, remind and purge still run before the unbounded reverse match, in the same transaction. |
| R1 | Doc note: one scan per process; `--workers N` wastes N-1 runs | Residual (info) | No note in `architecture.md`. |
| R2 | Deadlock 40P01 not treated as a lost race | Residual (info), now wider: see N1 | `main.py` still does not map 40P01. It now logs the deadlock as `want scan failed` with a traceback and re-raises. |
| R3 | TERYT refresh note for `wants.locality_id` RESTRICT | Residual (info) | `architecture.md:304` documents the RESTRICT FK. The TERYT refresh guidance (0078-0080 runbook) does not mention wants. |
| R4 | Metric / admin read of marker lag | Residual (info) | No change. |
| AR | Reverse scan 5.7 s at 500 x 10,000 (accepted) | Unchanged accepted risk | `architecture.md` Wants → Measured cost. |

Also confirmed: `INDEX.md` and `standards/backend/time.md` now list `app/search` and `app/wants` among the clock-guarded packages (six in total). The `INDEX.md` 0099 summary matches the runbook (downgrade deletes the rows, image-only order stop → delete → start).

## New operational risks from the fixes

### N1 (info): scan / seeker-edit deadlock gives the seeker a 500
- **Location**: `app/wants/application/match_notifications.py::_wants_to_notify` (`SELECT … FOR UPDATE`, id order) together with `app/wants/application/writes.py::update_want` (and `resume_want`, which also re-matches).
- **Mechanism**:
  1. The scan inserts pair (W, I) through `match_new_listings` and does not commit.
  2. A seeker's edit that changes matching flushes `UPDATE wants` for W and takes W's row lock.
  3. The seeker's `match_want` then inserts (W, I) `ON CONFLICT DO NOTHING`. That insert waits on the scan's uncommitted tuple.
  4. The scan's `FOR UPDATE` on W waits on the seeker. PostgreSQL detects the cycle after `deadlock_timeout` and aborts one side.
  - If the seeker is aborted, `_timeout_as_unavailable` re-raises SQLSTATE 40P01 (it maps only 57014), so the user gets a 500.
  - If the scan is aborted, it now logs `want scan failed` and the next run repeats the window. That side is harmless.
- **Is it new?** Not in kind. Before the fix, `_point_wants_at_rows` (an `UPDATE wants`) closed the same cycle, only later in the run. The `FOR UPDATE` moves the lock earlier and makes it explicit.
- **Related**: a seeker write that waits on the scan's lock for more than 3 s, under the forward `statement_timeout`, now becomes a 503 instead of the intended 409 after the version check. The lock is held only from the bell-row step to the commit, which is a few small statements, so this is unlikely.
- **Fixable**: true.
- **Suggestion**: map SQLSTATE 40P01 (and 40001) in the want write paths to the existing Polish 409 / "try again" answer, and in `_run_want_scan` to a WARNING like the lost race (this also covers R2). An alternative is to lock the candidate wants before the reverse insert, but that lengthens C6, so mapping the error is preferred.

### N2 (none): the downgrade `DELETE` under `lock_timeout`
- The statement takes ROW EXCLUSIVE on `notifications`. That lock conflicts with no ordinary read or write. Only row locks on rows that someone is marking read at the same moment could wait, and the runbook stops the backend first, so there are none.
- The statement is a sequential scan: the only index is `ix_notifications_party_id` (0022), and there is no index on `kind`. Its cost grows with the size of `notifications`. No `statement_timeout` is set, so it runs to the end.
- With `transaction_per_migration`, the `DELETE` and the drops share one transaction. A `lock_timeout` abort rolls back everything, and a retry is safe. No action needed.

### N3 (none): the ACTIVE-only lock is a correctness gain
- `_wants_to_notify` filters on `status == ACTIVE` and `notifications_enabled`, and `_point_wants_at_rows` repeats `status == ACTIVE`.
- Under READ COMMITTED, `FOR UPDATE` re-checks the predicate on the latest row version. A want withdrawn mid-run therefore gets no bell row and no pointer.
- Tested by `tests/test_wants_scan.py::test_writeBellRows_wantWithdrawnAfterItsPairWasStored_noRowAndPointerUntouched`.
- With several processes, two runs lock in the same id order, so this step adds no deadlock between scans. The pair-insert deadlock (R2) is unchanged.

### N4 (info): failures are logged twice
- `_run_want_scan` logs with `logger.exception` and then re-raises. APScheduler logs the same exception again ("Job … raised an exception") through Python's last-resort stderr handler.
- The second line is only noise, but it doubles the count in any future alert rule.
- **Fixable**: true. **Suggestion**: log only once, either by not re-raising or by relying on APScheduler with a configured `apscheduler` logger.

## Blockers (Must Fix)
1. **Release gate open** (critical, process).
   - **Location**: `architecture.md` 0099 runbook, Release gate; `app/wants/domain/limits.py` (`SIMILARITY_THRESHOLD_*`).
   - **Fixable**: false (needs the follow-up task).
   - **Suggestion**: score the sample of at least 200 pairs, set the thresholds from it, then deploy following the runbook.

## Concerns (Should Fix)
1. **C4 residual: no alert on repeated scan failures** (warning).
   - **Location**: `main.py::_run_want_scan`; project-wide.
   - **Fixable**: false (infrastructure).
   - **Suggestion**: add error tracking or a log-based alert on `want scan failed`, plus an alert when `now() - want_scan_markers.scanned_through > 1 h`.

## Accepted Risks (user decision, recorded)
- **C5**: no per-principal rate limit on POST / PATCH / `resume` for wants. Each request can cost up to 3 s of database time.
- **C6**: the sweep holds its row locks through the unbounded reverse match, and the window has no upper bound after downtime.
- **Reverse-scan cost**: 5.7 s at 500 listings x 10,000 wants.

## Recommendations (Nice to Have)
1. **N1 / R2** (info, fixable): map 40P01 / 40001 to a 409 in the want writes, and to a WARNING in the scan wrapper.
2. **N4** (info, fixable): log a scan failure once.
3. **R1** (info, fixable): add a note to the runbook that the scan runs once per process.
4. **R3** (info, fixable): add `wants.locality_id` RESTRICT to the TERYT dictionary refresh note.
5. **R4** (info): add a marker-lag read or metric.
6. **Runbook detail** (info, fixable): say that `alembic downgrade 0098` must run from the **new** image, for example as a one-off container with the backend stopped. The old image has no 0099 script.

## Test Evidence
- `verification/test-suite-results.md` (re-run after the fixes) shows 0 new failures and 0 regressions:

| Check | Result | Compared with |
|---|---|---|
| Backend pytest | 2 failed / 1469 passed | same 2 baseline ids |
| Vitest | 33 failed / 1824 passed | same 33 baseline ids, 6 more passing |
| mypy | 15 | unchanged |
| ruff | 65 | unchanged |
| typecheck | 0 | unchanged |
| lint | 10 errors / 28 warnings | unchanged |

- Each fix has its own test, read in the test files:
  - Downgrade deletes the WANT_* rows: `test_wants_migration.py:86-91`.
  - ACTIVE-only lock: `test_wants_scan.py:233`.
  - ERROR log on failure: `test_wants_scan.py:406`.

## Next Steps
1. Close the release gate (the follow-up task).
2. Optionally, before release: map deadlock and serialization errors (N1 / R2), and log a scan failure once (N4).
3. Deploy following the runbook. Add a marker-age alert when monitoring exists.
