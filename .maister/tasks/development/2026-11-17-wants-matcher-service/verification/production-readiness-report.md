# Production Readiness Report

**Date**: 2026-11-17
**Path**: `.maister/tasks/development/2026-11-17-wants-matcher-service` (uncommitted changes: `docker-compose.yml`, `src/matcher/**`, `src/backend/app/wants/**`, `src/backend/app/main.py`, `src/backend/alembic/versions/0099_wants.py`, architecture runbook)
**Target**: production
**Status**: Not Ready

## TL;DR

- **NO-GO.** The 0099 release gate is still unmet: no labelled Polish sample of 200 or more pairs has been scored, so the matcher constants and the stemmer are unvalidated. The docs themselves say "do not deploy".
- The code is close to ready. Startup gating, reconnects, the failure policy, transactional runs, the ≤5-connection budget and keeping secrets out of logs and images all hold up under review.
- Fix these before the gate is lifted: the matcher has no `restart:` policy and no liveness signal, and a window run that hits its timeout never recovers (each retry has a bigger window).
- Rollback is documented and works. It loses all wants data, and there is no image-only rollback. That is acceptable only while 0099 is unreleased.

## Key Decisions

- **The release gate decides the verdict.** Everything else is a concern, not a blocker, because the feature is pre-launch and the volumes are small.
- **The checklist's "blocker" items were reclassified for a worker with no port.** A missing HTTP health check and a missing SIGTERM handler are warnings here. Each window or claim is one transaction, so killing the process loses no data. The practical risk is a stall or crash that nobody notices, so the fix asked for is a restart policy plus a liveness check.
- **Project-wide gaps are listed as info, not counted against this change.** These are: no error tracking (Sentry or similar), no metrics, the DB user `aj` being the Postgres superuser, Postgres port 5432 published, literal credentials in the tracked compose file, and containers running as root. The matcher follows the same patterns and does not make them worse, except that it is one more process holding superuser credentials.
- **Rates are from the measurements.** Scalability rates use `implementation/measurement/results.md`, which was measured on a laptop. The plan shapes and timeout behaviour were accepted by the user on 2026-11-17.

## Open Questions / Risks

- **Window timeout spiral** (`src/matcher/matcher/window.py`). Expire, remind, purge, match, outbox rows and the marker move all happen in one transaction. If one statement hits the 30 s `statement_timeout`, the whole run rolls back and the marker does not move. The next run's window is then larger, so it times out again. This stops matching, bells, expiry, reminders and purge with no end. The trigger is about 1,500 takeable listings in one window at 10,000 wants, or a matcher outage long enough to build up that many listings since the marker. The docs only say to watch `duration_ms`.
- **Silent outage.** Compose has no `restart:` on `matcher`, and the image and compose file have no healthcheck. Idle runs log at DEBUG. There is no error tracking. If the process crashes (for example `create_pool` failing right after the gate, or a missing `DATABASE_URL`), it stays down. Only the runbook's manual marker query would notice.
- **Bell loss.** If the `wants.bells_due` handler fails 5 times, the outbox row is marked FAILED. Up to 1000 bells are dropped and no alert fires.
- **After the gate.** If scoring the sample changes `stem_word_pl`, `words_pl` or the stop-list (SQL in 0099), the DB contract changes. While 0099 is unreleased, that means amending 0099 again and repeating runbook step 5. Changing only `rules.py` constants is just a new image.

## Executive Summary

- **Recommendation**: NO-GO. Once the release gate passes, this becomes GO with mitigations (W1–W3 fixed).
- **Overall Readiness**: 68%
- **Deployment Risk**: High. The gate is unmet and the only rollback is lossy. Without the gate, risk is Medium.
- **Blockers**: 1  Concerns: 7  Recommendations: 7

## Category Breakdown

| Category | Score | Status |
|----------|-------|--------|
| Configuration | 75% | With concerns |
| Monitoring | 50% | With concerns |
| Resilience | 75% | With concerns |
| Performance | 65% | With concerns |
| Security | 75% | With concerns |
| Deployment | 55% | Not ready (release gate) |

### What was verified as fine

- **Configuration**: The only setting is `DATABASE_URL`. It is validated at startup (`settings.load` raises when it is empty) and kept out of `repr` (`field(repr=False)`). The driver suffix is stripped. Constants live only in `matcher/rules.py`, and `REMINDER_LEAD` is pinned to the backend by `tests/test_constants_drift.py`.
- **Startup ordering**: compose has `depends_on` for postgres (`service_healthy`) and backend (`service_started`). The real gate is `db.wait_for_contract`, which retries every 10 s until `alembic_version` is at least 99 **and** `matchable_listings` exists. It also retries while the DB is unreachable and logs only the exception type. The backend lifespan refuses to start on an old-0099 schema (`_check_wants_contract`).
- **Connection limits**: pool `min_size=1, max_size=4`, plus one LISTEN connection, gives ≤5 per copy. The gate's connection is closed before the pool opens. The backend pool is the SQLAlchemy default (5 + 10 overflow), so the total stays well under Postgres' default of 100.
- **Error handling**: `db.log_failure` logs `40P01`/`40001` and lost marker races as one WARNING each, and anything else once with its traceback. Neither loop re-raises. One failing want is isolated by a per-process doubling backoff (60 s up to 15 min). If the LISTEN connection is lost it is reopened. The 10 s poll keeps requests draining even when the LISTEN connection is half-open.
- **Concurrency**: claims use `FOR NO KEY UPDATE SKIP LOCKED` and the flag is cleared by compare-and-set. The window runs under `pg_try_advisory_xact_lock`. The marker moves by compare-and-set. Outbox rows are inserted in the same transaction as the pairs. Several copies can run safely.
- **Bells handler**: `bells_due.py` re-checks every pair against `visible_matches`, and each reminder against ACTIVE status, inside a savepoint. It is registered in the lifespan through `outbox_acl`. The backend's poller is the only outbox consumer (the moderation worker is gone), so no other process can mark these rows PROCESSED without handling them.
- **Removal of the in-process scan**: the APScheduler job and `scan.py`, `matcher.py` and `text_queries.py` are gone, and `tests/test_wants_scan_removed.py` pins that.
- **Secrets**: `matcher/.dockerignore` excludes `.env`, `.env.*`, `.venv`, caches and tests. The Dockerfile takes no build secret or ARG and uses a frozen `uv.lock` with `asyncpg==0.31.0` pinned. No log call prints the DSN. Connection failures log the type name only, and asyncpg auth errors do not contain the password. The caches under `src/matcher` (`.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.venv`) are git-ignored and docker-ignored.
- **Degradation**: the backend does not depend on the matcher at runtime. If the matcher is down, the frontend shows the slow state („Wyniki pojawią się wkrótce”) after 60 s of polling.
- **Tests**: the matcher has 81 tests, all passing, with ruff and mypy (strict) clean. The backend has 0 regressions (see `verification/test-suite-results.md`).
- **Runbook**: the last section of `architecture.md` covers building images first, the old-0099 detection query, a `pg_dump` backup, `downgrade 0098` + `upgrade head` from the new image, the do-not-`up`-first warning, verification queries (including the UTF-8 ctype check) and a rollback that stops the matcher before the downgrade. The downgrade takes `lock_timeout` and tolerates either 0099 shape. Commands avoid printing configuration.

## Blockers (Must Fix)

### B1. The 0099 release gate is unmet (critical, not fixable in code)

- **Location**: `.maister/docs/project/architecture.md` (Wants, "Release gate"; runbook step 1); `src/matcher/matcher/rules.py` (`WORD_SIMILARITY_MIN = 0.65`, `SHORT_WORD_MAX_CHARS = 4`); the `stem_word_pl`, `words_pl` and stop-list SQL in `src/backend/alembic/versions/0099_wants.py`.
- **Issue**: The feature has no feature switch, and the documented rule is "do not deploy until the labelled Polish sample (≥200 want/item pairs) is scored against the per-word rule". No such sample or scoring exists in the repo, and `orchestrator-state.yml` and `spec.md` still list it as pending. `measurement/results.md` and `orchestrator-state.yml` also record known false positives from stem prefixes („Kurtyna”, „Legowisko”).
- **How to fix**: Run the follow-up labelling task, score the final rules, and set the constants from the results. If the stemmer, stop-list or `words_pl` change, amend 0099 while it is still unreleased and repeat runbook step 5 on dev and test databases.

## Concerns (Should Fix)

### W1. No restart policy and no liveness signal for `matcher` (warning, fixable)

- **Location**: `docker-compose.yml` (service `matcher`); `src/matcher/Dockerfile`.
- **Issue**: There is no `restart:` and no `healthcheck`. The process exits for good if `create_pool` fails after the gate, if `DATABASE_URL` is missing, or if anything escapes `asyncio.gather`. Runs that found nothing log only at DEBUG, so an idle-but-healthy matcher and a dead one look the same in the logs.
- **Recommendation**: Add `restart: unless-stopped`. Add a healthcheck that compares `want_scan_markers.scanned_through` against `now() - interval '5 minutes'`, or that checks a heartbeat file the window loop touches. Optionally log one INFO heartbeat every N idle runs.

### W2. A window-run timeout never recovers (warning, fixable)

- **Location**: `src/matcher/matcher/window.py` (`run_window`, `start = marker - WINDOW_OVERLAP` with no upper bound on the window span).
- **Issue**: When a statement hits the 30 s timeout, the whole run rolls back, including expire, remind and purge. The marker stays where it was, so every later window is larger and fails again. The measured cost is about 39 ms per takeable listing at 10,000 wants. One statement reaches the timeout at about 1,500 listings in a window. A matcher outage of a few hours at moderate traffic could cause this on restart.
- **Recommendation**: Cap the window end at, for example, `min(now, start + MAX_WINDOW_SPAN)` or the N oldest listings, and move the marker to that cap. Run expire, remind and purge in their own short transaction so they keep working while matching is slow. Alert on `duration_ms` reaching about 20 s.

### W3. No SIGTERM handling, so `docker stop` waits 10 s and then kills (warning, fixable)

- **Location**: `src/matcher/matcher/__main__.py`; `src/matcher/Dockerfile` (`CMD ["python", "-m", "matcher"]` as PID 1).
- **Issue**: Python installs no SIGTERM handler, and the kernel ignores default-action signals sent to PID 1. Every deploy therefore waits for the 10 s grace period and ends with SIGKILL. Data is safe because every run is one transaction, but connections are cut without a clean close and deploys are slower.
- **Recommendation**: Add `loop.add_signal_handler(SIGTERM, ...)` that cancels the gather and closes the pool, or set `init: true` in compose.

### W4. The matcher DSN is a literal in the tracked compose file and uses the superuser role (warning, fixable)

- **Location**: `docker-compose.yml`, `matcher.environment.DATABASE_URL`.
- **Issue**: It repeats the backend's literal DSN instead of using `${DATABASE_URL}` interpolation from `.env`. The role is the Postgres image's `POSTGRES_USER`, which is a superuser. The matcher needs only SELECT on the contract views and tables, INSERT on `want_matches` and `outbox_entries`, UPDATE and DELETE on `wants`, and INSERT and UPDATE on `want_scan_markers`. The moderation cron already uses a least-privilege role (`gt_moderation_cron`), which is the precedent.
- **Recommendation**: Read the DSN from `.env` (and add a placeholder for it to `.env.example`). Create a `gt_matcher` role with column-level grants in a migration or runbook step. This is the same project-wide debt the backend has (see I1).

### W5. The bells handler sends one statement per seeker and blocks the shared outbox poller (warning, fixable)

- **Location**: `src/backend/app/wants/application/bells_due.py` (`_visible_pairs`); `app/outbox/dispatcher.py`.
- **Issue**: A 1000-pair row takes about 3 s (461 statements). The single poller handles up to 50 entries in series every 60 s, so a burst of large rows holds up notification and storage-delete events for minutes. The docs list this as an accepted follow-up.
- **Recommendation**: Batch `visible_matches` for all seekers in one statement, or pass an `event_types` filter to a dedicated poller.

### W6. A FAILED `wants.bells_due` row drops bells silently (warning, fixable)

- **Location**: `app/outbox/dispatcher.py` (`MAX_ATTEMPTS = 5`); `bells_due.py`.
- **Issue**: After 5 failures the row is marked FAILED and up to 1000 bells are lost. Nothing alerts, apart from the manual query in runbook step 7.
- **Recommendation**: Log at ERROR on the transition to FAILED, and add the FAILED count to monitoring or the healthcheck.

### W7. Rollback is lossy and has no image-only path (warning, not fixable by design)

- **Location**: `architecture.md`, 0099 runbook step 8; `0099_wants.py` `downgrade()`.
- **Issue**: Any rollback is `downgrade 0098` from the new image, which deletes every want, match and `WANT_*` notification. The alternative is restoring the step-4 dump. This is acceptable only while 0099 is unreleased, and it becomes a real data-loss rollback once users create wants.
- **Recommendation**: Keep the step-4 dump mandatory. Once released, any later contract change should be a new forward revision, not another amendment.

## Recommendations (Nice to Have)

- **I1 (project-wide)**: the tracked compose file holds literal DB credentials and publishes `5432:5432`. If this compose file is used on VPS A as the runbook suggests, the production DB port should not be published. `src/matcher/Dockerfile` and the backend run as root; add a non-root `USER`.
- **I2**: there is no error tracking (Sentry) or metrics anywhere in the project. For the matcher, the window log line (`duration_ms`, `matches`, `outbox_rows`) is the only signal. Consider shipping it as JSON or as metrics.
- **I3**: while a run is in progress, the window transaction holds row locks on the wants it expires or reminds (up to the run's duration, about 18 s at 500 listings). A seeker's PATCH, extend or close on one of those wants waits until the run ends and then gets the 409. This is rare and harmless, but worth knowing.
- **I4**: the matcher clock (`clock.utcnow`) is compared with `created_at` values written by the backend. Both containers share the host clock today. If the matcher ever moves to another host (for example VPS B), it needs NTP, because the 2-minute overlap is the skew budget.
- **I5**: backoff is held in memory per process. A restart retries failing wants at once. This is documented and acceptable.
- **I6**: the outbox rows staged by the matcher are left behind after `downgrade 0098`. The old image marks them PROCESSED without handling them, which is harmless.
- **I7**: the frontend and backend must be deployed together (`matching`, `/suggestions`). This is covered in runbook step 6.

## Next Steps

1. Run the release-gate labelling task (≥200 pairs), score the per-word rule, and set the constants. Amend 0099 if the SQL rules change. (B1)
2. Add `restart: unless-stopped` and a marker-freshness healthcheck to `matcher`. (W1)
3. Bound the window span and split expire, remind and purge into their own transaction. (W2)
4. Add a SIGTERM handler or `init: true`. (W3)
5. Move the DSN to `.env` and plan a least-privilege `gt_matcher` role. (W4)
6. Follow-ups: batch the bells handler visibility check (W5) and alert on FAILED outbox rows (W6).
7. At deploy time, follow the 0099 runbook exactly: build first, take the dump, run the step-3 query, and run step 5 only for old-0099 databases.
