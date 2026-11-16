# Production Readiness Report

**Date**: 2026-11-16
**Path**: `src/backend/app/wants/`, `src/backend/alembic/versions/0099_wants.py`, `src/backend/app/main.py` (want scan job), `src/backend/app/notifications/`, `src/backend/app/core/authorization_matrix.py` (rows 66-67), frontend `/wanted`, `/wanted/[id]`, `/wanted/[id]/edit`, `/add/wanted`
**Target**: production
**Status**: Not Ready (release gate open). The code itself has no blockers.

## TL;DR
- **NO-GO for now.** The only blocker is the written release gate in `architecture.md`: the labelled Polish sample (at least 200 pairs) is not scored yet, and the 0.70 / 0.60 thresholds are not set from it. There is no feature switch, so the gate cannot be met by turning the feature off.
- The code is ready otherwise. Migration 0099 is additive with `lock_timeout`, it touches no existing table, and its round-trip test passes. The scan survives a race between processes. It logs one line per run. There are no new test failures.
- Accepted risk: the reverse scan takes 5.7 s at 500 listings x 10,000 wants. It runs without a statement timeout.
- 6 concerns (warnings), all fixable or documentation-only. The most useful one: the runbook's "the log has a `want scan:` line" check fails on a quiet first run, because an idle run logs at DEBUG and DEBUG is dropped.

## Key Decisions
- The release gate counts as a **blocker** because the project's runbook says "Do not deploy this release until…". It is a process blocker, not a code defect.
- The 5.7 s reverse scan is recorded as an **accepted risk** (accepted by the user on 2026-11-16). It is not a blocker or a concern.
- The project has no error tracking (no Sentry or similar) and no general rate limiting. Both gaps predate this task and cover the whole project, so they are reported as **warnings**, not blockers. Nothing in this feature makes either one worse in kind.
- Production runs a single process (`uvicorn app.main:app` with no `--workers`, in `docker-compose.yml:28` and `src/backend/Dockerfile:50,63`). Multi-worker behaviour was judged for safety only, not for its cost.

## Open Questions / Risks
- Release gate: who scores the sample, and when? Until then this branch cannot ship, and nothing else in the release can ship with it.
- The scan has no statement timeout and holds row locks on `wants` for the whole run (expire/remind run first, matching after). Suppose a large window builds up: a long image-only rollback, or a scan that keeps failing so the marker never moves. Then one run can take minutes. While it runs, seeker writes to the expired or reminded wants block on those locks.
- If the scan keeps failing for a reason other than the race, nothing raises an alert. APScheduler logs the exception to stderr through the root logger's last-resort handler. The marker does not move, so each next window is larger.

## Executive Summary
- **Recommendation**: NO-GO, until the release gate is closed. After that: GO with mitigations (the concerns below).
- **Overall Readiness**: 80%
- **Deployment Risk**: Medium (low once the gate is closed and the runbook fixes are made)
- **Blockers**: 1  Concerns: 6  Recommendations: 4

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | Ready. No new env vars or secrets. Limits are code constants in `domain/limits.py`. |
| Monitoring | 70% | With concerns. One scan log line, but quiet runs log at DEBUG (dropped). No error tracking (pre-existing). |
| Resilience | 85% | Ready. Race between runs handled, versioned writes, forward 3 s timeout mapped to 503. |
| Performance | 80% | Accepted risk on the reverse scan. Forward match is at most 17 ms. |
| Security | 85% | Ready. Matrix rows 66-67, owner-scoped 404s, MCP scopes excluded. No rate limit (pre-existing). |
| Deployment | 65% | Release gate open. Runbook complete except two small gaps. |

## Findings by Area

### Migration 0099 (`src/backend/alembic/versions/0099_wants.py`)
- `SET LOCAL lock_timeout = '5s'` in both upgrade and downgrade, as `standards/backend/migrations.md` requires.
- Only new tables. The FKs to `parties`, `categories` and `localities` take brief SHARE ROW EXCLUSIVE locks on the referenced tables. No validation scan is needed, since the new tables are empty. The generated `name_folded`/`name_query` columns are added to an empty table, so no rewrite. Names follow `pk_`/`fk_`/`ix_`/`uq_`/`ck_`. The PKs are UUIDs with `gen_random_uuid()`.
- The downgrade drops in reverse dependency order: index, then FK, then tables. It is unguarded and lossy, which is justified because no ledger row depends on a want. `tests/test_wants_migration.py::test_migration0099_downgradeUpgrade_roundTrip` covers it.
- The downgrade does **not** delete `notifications` rows of the two new kinds. The runbook makes this a manual step instead (see the concern below).

### Image-only rollback
- `notifications.kind` is `_enum_column(NotificationKind, 30)` (`src/backend/app/notifications/models.py:76`). The previous image's enum has no `WANT_MATCH_FOUND`/`WANT_EXPIRING`, so it cannot load such a row, and the bell breaks for every party holding one. The runbook (`architecture.md`, "Deploy / rollback for wants (migration 0099)") covers this with `DELETE FROM notifications WHERE kind IN ('WANT_MATCH_FOUND','WANT_EXPIRING');` before a downgrade or an image-only rollback. That is correct. The ordering detail is missing (concern C2).
- Re-deploy after a rollback: the first run reads from the stored marker minus 5 minutes, so it catches up in one run. The runbook says so. The cost of that run grows with the length of the rollback (risk above).

### Scheduler and concurrency (`src/backend/app/main.py::_run_want_scan`, `app/wants/application/scan.py`)
- **Within one process**, APScheduler's default `max_instances=1` stops runs from overlapping.
- **Across processes or workers**: each process schedules its own job. Both runs do expire/remind with set-based UPDATEs. Under READ COMMITTED, the second run waits on the first run's row locks and then re-checks `reminded_at IS NULL`. Pair inserts use `ON CONFLICT DO NOTHING`. The marker is written through the ORM with `updated_at` as the version column. The run that loses gets `StaleDataError`, or `IntegrityError` on `uq_want_scan_markers_scan_name` when both are first runs. The wrapper rolls the whole run back and logs a WARNING, so no duplicate bell rows or reminders are committed. `test_runWantScan_lostMarkerRace_isSwallowedAndRolledBack_nextRunLeavesOneMarker` covers this. Conclusion: **safe**, with the cost of N-1 wasted runs per interval. One residual case remains: two runs can lock overlapping `wants` rows in different orders, which gives a deadlock error. That error is not caught, so it is logged as a job failure and the next run recovers (R2).
- Seeker writes that loaded a want before a run fail the version check. The shared `stale_data_error_handler` turns that into a 409 with a Polish message. This is the intended behaviour.
- Graceful shutdown: the scheduler is shut down in the lifespan with `wait=False`. An interrupted run rolls back as a whole (one transaction) and the marker does not move, so the next run covers the window again.

### Logging and observability
- One line per run: window, counts, `duration_ms`. It logs at INFO when the run did work and at DEBUG otherwise. `app.*` is set to INFO in `main.py:65-68`, so **DEBUG lines are dropped in production**.
- A race loss logs a WARNING. Any other exception propagates to APScheduler (`apscheduler.executors.default`). That logger has no handler, so Python's last-resort handler writes it to stderr (WARNING and above, with traceback). It shows up in the container logs, but nothing alerts on it.
- No metrics or error tracking. Project-wide and pre-existing.

### Error handling
- Forward match: `SET LOCAL statement_timeout = '3s'`. SQLSTATE 57014 rolls the write back and returns 503 with a Polish message.
- Scan: one transaction and one commit. Only the two marker-race errors are swallowed, and the `IntegrityError` is narrowed to the marker constraint name. Everything else propagates.
- `write_bell_rows` skips a single match whose item is gone. Messages are capped with `clock.fit_notification_message`.

### Configuration and secrets
- No new environment variables, secrets or external calls. `grep` over `app/wants` finds no credentials. No `.env` file is staged. Thresholds, intervals and limits are code constants, which is consistent with the project, but changing a threshold after the gate needs a new image.

### Performance
- Forward match: at most 17 ms at 20,000 items and 10,000 wants, with both text indexes used (`implementation/measurement/results.md`).
- Reverse scan: about 12 ms per new listing at 10,000 active wants. **Accepted risk:** 5.7 s at 500 listings x 10,000 wants, against a 2 s budget, with no statement timeout. The fallback options are written down ("Remaining gap"). The seeded data had no groups, so the cost of PRIVATE listings is underestimated.
- The scan issues a constant number of statements (`test_scanWants_oneOrSeveralWantsAndListings_sameStatementCountAtMostSixteen`). No index on `item_listing_preferences.created_at`, which was measured and not needed.

### Security
- Matrix rows 66 (GET `^/api/wants(/.*)?$` → READ) and 67 (POST/PATCH → EDIT). There is no DELETE route. The OAuth `mcp:*` scopes are deliberately not accepted. Every `/{want_id}` route is selected by id **and** seeker, and answers 404 otherwise.
- Matching respects item visibility: PRIVATE listings match only through a shared private group, and the seeker's own items are excluded.
- Text moderation: the module has a `moderation_acl` (`text_guard` changed in this diff). There is no per-user rate limit on create, edit or resume. Each of these can run a forward match of up to 3 s, so a logged-in user can spend database time in a loop. The 30-ACTIVE cap limits the number of wants, not the number of requests.

## Blockers (Must Fix)
1. **Release gate open**. Location: `.maister/docs/project/architecture.md` ("Deploy / rollback for wants (migration 0099)", Release gate), `src/backend/app/wants/domain/limits.py` (`SIMILARITY_THRESHOLD_*`). Issue: the labelled Polish sample (at least 200 pairs) is not scored, and the 0.70 / 0.60 thresholds are unmeasured. The feature has no switch. Fix: run the follow-up task that scores the sample, set the thresholds from it, then deploy. The alternative is to add a feature switch, which would be a design change.

## Concerns (Should Fix)
1. **C1: the runbook check for the log line cannot pass on a quiet first run** (warning, fixable). Location: `architecture.md` step 3 of the 0099 runbook; `scan.py:129-131`. Issue: an idle run logs at DEBUG, and `app` is at INFO. Fix: change the runbook to check `want_scan_markers` only, or "a `want scan:` line once a run stored or expired something". Or log every run at INFO; one line every 15 minutes is cheap.
2. **C2: the order of the image-only rollback is not stated** (warning, fixable). Location: `architecture.md` 0099 rollback. Issue: if `DELETE FROM notifications …` runs while the new image is still up, a scan can write new `WANT_*` rows before the old image starts. Fix: "stop the new backend, then delete, then start the old image or run the downgrade."
3. **C3: the downgrade leaves rows that break the old image** (warning, fixable). Location: `0099_wants.py::downgrade`. Issue: the required `DELETE` is a manual step. Fix: run `DELETE FROM notifications WHERE kind IN ('WANT_MATCH_FOUND','WANT_EXPIRING')` inside `downgrade()`. The image-only rollback still needs the manual step.
4. **C4: no alert when the scan keeps failing** (warning, not fixable within this task). Location: `main.py::_run_want_scan`; project-wide, no error tracking. Issue: a recurring error (for example a query error after a data change) only goes to stderr. The marker does not move, so each next window is larger. Fix: catch and `logger.exception("want scan failed")` under the `app` logger so it has a formatted line. In the long term, add error tracking and an alert on marker age (`now() - scanned_through > 1 h`).
5. **C5: no request rate limit on the want writes that re-run a match** (warning, not fixable within this task). Location: `router/wants.py` (POST `""`, PATCH, `/resume`). Issue: each one can cost up to 3 s of database time. Pre-existing project-wide gap. Fix: a per-principal limiter on these routes, or accept it given the single-process scale.
6. **C6: long scan transaction after a backlog** (warning, not fixable within this task). Location: `scan.py::scan_wants`. Issue: expire/remind take row locks before the unbounded reverse match. After a long rollback or a run of failures, seekers' writes to those wants can block for the whole run. Fix (optional): run expire/remind/purge after the match, or in their own transaction. Or cap the window per run: process at most N listings and advance the marker to the last one processed.

## Recommendations (Nice to Have)
1. R1 (info): a startup sanity log, or a doc note, that the scan runs once per process. Running with `--workers N` wastes N-1 runs per interval.
2. R2 (info): treat a deadlock (`DBAPIError` with SQLSTATE 40P01) in `_run_want_scan` like a lost race: one WARNING and no traceback.
3. R3 (info): `wants.locality_id` uses FK RESTRICT. A future refresh of the TERYT dictionary that deletes or TRUNCATEs localities must handle wants as well as locations. Add this to the TERYT refresh note.
4. R4 (info): a metric or admin read of `want_scan_markers.scanned_through` lag, for monitoring.

## Accepted Risks
- Reverse scan: 5.7 s at 500 new listings x 10,000 active wants (2 s budget), with no statement timeout. Accepted by the user on 2026-11-16 (`architecture.md`, Wants → Measured cost). Options if that scale is reached: match each listing when it is created, add an index-backed pre-filter on the want side, or run the candidate select apart from the insert.

## Test Evidence
- `verification/test-suite-results.md`: no new failures. Backend 1469 passed and 2 baseline failures; Vitest 1818 passed and 33 baseline failures; mypy 15, ruff 65 and lint unchanged; typecheck 0.
- Migration round-trip, generated columns and CHECKs: `tests/test_wants_migration.py`. Scan race, version conflict, constant statement count, log levels: `tests/test_wants_scan.py`.

## Next Steps
1. Close the release gate: score the labelled sample and set the thresholds.
2. Fix runbook C1 and C2 (documentation only), and optionally C3 (a one-line downgrade change and its test).
3. Optionally add `logger.exception` in `_run_want_scan` (C4).
4. Deploy following the runbook: `pg_dump -Fc`, then frontend and backend together, then verification (with the corrected C1 check).
