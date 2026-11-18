## TL;DR

- **Still NO-GO, and that is because of B1 alone.** The 0099 release gate (a scored labelled Polish sample of at least 200 pairs) is still open by design. Nothing else blocks a release.
- **Once B1 passes, this becomes GO with mitigations.** W1, W2, W3 and W6 are fixed in code and documented. Their small leftover risks are listed below.
- **W4, W5 and W7 are unchanged by user decision.** They stay as accepted concerns.
- **One new low-severity concern (N1).** The 2-minute overlap is not counted in the 300-listing cap. A dense burst of roughly 1,200 or more listings inside 2 minutes could still make one window run hit the timeout over and over. The match would stall; the sweep would not. The docs call the backlog risk "resolved", which is true for spread-out backlogs but not for this burst case.
- **Checks run**: matcher has 86 tests passing (previously 81), ruff is clean and mypy (strict) is clean. Backend `tests/test_outbox.py` has 6 tests passing, including a new check of the ERROR log on FAILED. `docker compose config --quiet` passes. No dev-stack container was touched.

# Production Readiness Re-verification

**Date**: 2026-11-17
**Path**: `.maister/tasks/development/2026-11-17-wants-matcher-service` (uncommitted: `docker-compose.yml`, `src/matcher/**`, `src/backend/app/outbox/dispatcher.py`, `src/backend/tests/test_outbox.py`, `.maister/docs/project/architecture.md`, `tech-stack.md`)
**Target**: production
**Baseline**: `verification/production-readiness-report.md` (NO-GO, B1 plus W1–W7)
**Status**: Not Ready (release gate only)

## Executive Summary

- **Recommendation**: NO-GO until B1 passes. After that, GO with mitigations.
- **Overall Readiness**: 80% (previously 68%)
- **Deployment Risk**: High while the gate is unmet. Without the gate it is Low to Medium (lossy rollback W7, burst case N1).
- **Blockers**: 1 (B1)  Concerns: 4 residual (W4, W5, W7 and new N1) plus 2 minor leftovers (W1, W6)  Recommendations: I1–I7 unchanged, plus N2 and N3

## Category Breakdown

| Category | Before | Now | Status |
|----------|--------|-----|--------|
| Configuration | 75% | 75% | With concerns (W4 unchanged) |
| Monitoring | 50% | 65% | With concerns (log-based only, no healthcheck or alerts) |
| Resilience | 75% | 90% | Ready (restart, clean SIGTERM, sweep isolated) |
| Performance | 65% | 80% | With concerns (W5 unchanged, N1) |
| Security | 75% | 75% | With concerns (W4 unchanged, I1) |
| Deployment | 55% | 60% | Not ready (B1 release gate, W7) |

## Status of the Original Issues

| ID | Issue | Status | Evidence |
|----|-------|--------|----------|
| B1 | Release gate unmet | **Open (by design)** | `architecture.md` Wants "Release gate" and runbook step 1 still say do not deploy. `rules.py` still has `WORD_SIMILARITY_MIN = 0.65` and `SHORT_WORD_MAX_CHARS = 4` as unmeasured starting values. |
| W1 | No restart policy, no liveness | **Resolved; minor residual** | `docker-compose.yml` matcher has `restart: unless-stopped`. The reason for having no healthcheck is documented (`architecture.md` Shutdown paragraph, deployment section, runbook step 7). Residual: a hung process that never exits is not restarted, and idle runs still log at DEBUG. Detection depends on the marker query in step 7. Plain compose does not restart unhealthy containers anyway, so a healthcheck would only add visibility. Accepted. |
| W2 | Window timeout never recovers | **Resolved for backlogs; residual for dense bursts (see N1)** | `window.py`: `_sweep` runs in its own transaction and commits before `_match`. `_window_end` caps the run at `WINDOW_MAX_LISTINGS = 300` new listings past the marker. `window_loop` skips the sleep after a capped run. The advisory lock is now session-level and is released in `finally` (pool reset also unlocks all). Tests: `test_runWindow_hoursOldMarkerAboveTheCap_drainsInCappedRuns_markerEndsAtNow`, `test_windowLoop_cappedRun_nextRunStartsWithoutTheInterval`, `test_runWindow_matchStatementFails_sweepStaysCommitted_lockReleased`. |
| W3 | No SIGTERM handling | **Resolved** | `__main__.py`: `install_stop_handlers` covers SIGTERM and SIGINT (loop handlers on POSIX, `signal.signal` fallback on Windows), cancels the main task, `_close` waits `SHUTDOWN_GRACE = 5 s` and then calls `pool.terminate()`, and `task.uncancel()` lets it return normally, so the exit code is 0. That fits inside compose's 10 s stop timeout. Test: `test_main_sigterm_loopsCancelledListenerAndPoolClosed_returnsNormally`. |
| W4 | Literal DSN, superuser role | **Residual (user decision)** | The DSN is still a literal in compose with the shared login `aj`. No `gt_matcher` role exists. This is project-wide debt shared with the backend. |
| W5 | Bells handler blocks the shared poller | **Residual (user decision, follow-up)** | Unchanged. The follow-up is documented in `architecture.md`. |
| W6 | FAILED bells drop silently | **Resolved; minor residual** | `dispatcher.py` logs one ERROR `outbox entry <id> (<event_type>) FAILED after <n> attempts: <last_error>` on the transition. It is tested in `tests/test_outbox.py`, which asserts that the ERROR record appears exactly once, and documented in runbook step 7 (`grep "FAILED after"`). Residual: nothing pushes an alert. Someone still has to read the logs, because the project has no error tracking (I2). The dropped bells are not retried. |
| W7 | Lossy rollback, no image-only path | **Residual (accepted while unreleased)** | Unchanged. Keep the step-4 `pg_dump` mandatory. |

## Blockers (Must Fix)

### B1. The 0099 release gate is unmet (critical, not fixable in code, open by design)

- **Location**: `.maister/docs/project/architecture.md` (Wants "Release gate"; runbook step 1); `src/matcher/matcher/rules.py`; the `stem_word_pl`/`stem_query_pl`/stop-list SQL in `src/backend/alembic/versions/0099_wants.py`.
- **How to fix**: Score the labelled sample of at least 200 pairs and set the thresholds from the results. If the SQL rules change, follow the documented path. Note one inconsistency in `architecture.md`: line 294 says a change to the short-word limit needs "a new revision", while the original report and runbook step 5 describe amending 0099 while it is unreleased. Settle which one applies before the gate work starts.

## Concerns (Should Fix)

### N1 (new). The overlap is not counted in the window cap (warning, low likelihood, fixable)

- **Location**: `src/matcher/matcher/window.py` `_match`: `start = marker - WINDOW_OVERLAP`, while `_window_end` counts only listings after `marker`.
- **Issue**: A capped run moves the marker to the 300th listing. The next run starts again at `marker - 2 min`, so it matches every listing created in the 2 minutes before the marker on top of the next 300. In a spread-out backlog the overlap holds few listings, so the cap works as intended. In a dense burst (for example a bulk import, or many listings created within 2 minutes) each run carries the whole burst so far. Using the measured cost (about 20 ms per listing and statement at 10,000 wants), one statement hits the 30 s timeout at about 1,500 listings in a run. That is about 1,200 or more listings inside a 2-minute span. The window for that run is then fixed (same marker, same 300), so every retry fails the same way, and matching and bells stop until volume or the number of wants changes. Expire, remind and purge keep running because the sweep is now separate, so the blast radius is much smaller than the original W2.
- **Likelihood**: low before and shortly after launch. The app has no bulk listing path that is known to produce this.
- **Recommendation**: Count the overlap inside the cap: bound the run by the first N listings after `start`, not after `marker`. Or cap the overlap part separately, or shrink the overlap to the skew budget when a run is capped. Also soften the line in `architecture.md` (Measured cost, "the earlier risk that a backlog never clears is resolved") to cover the burst case. Watch for repeated `window run failed` ERROR lines with the same marker.

### W4, W5, W7: residual by user decision

See the status table. The recommendations from the original report still apply.

### Minor leftovers of W1 and W6

There is no push alerting. The matcher's health and FAILED outbox rows are visible only through logs and the runbook step 7 queries. This is acceptable at current scale, together with I2.

## Recommendations (Nice to Have)

- **I1–I7**: unchanged from the original report.
- **N2**: the FAILED ERROR line includes `last_error` (up to 1000 characters of the handler's exception text). For SQLAlchemy errors this can include bound parameters (ids, notification text). It holds no secrets, and the same text is already stored in `outbox_entries.last_error`, but keep it in mind if logs ever ship to a third party.
- **N3**: consider one INFO heartbeat every N idle window runs. Then "alive but idle" and "dead or hung" can be told apart from the logs alone, without the marker query. This is the cheap remainder of W1.

## Next Steps

1. Run the release-gate labelling task, score the rules and set the constants (B1). Settle whether SQL rule changes amend 0099 or need a new revision.
2. Optional before launch: count the overlap inside the window cap (N1) and fix the doc wording.
3. Follow-ups already agreed: batch the bells visibility check (W5) and a least-privilege `gt_matcher` role with the DSN from `.env` (W4).
4. At deploy: follow the 0099 runbook exactly (build first, mandatory dump, step-3 query, step 5 only for old-0099 databases). After deploy, check that the marker advances and grep for `FAILED after` (step 7).
