# Production Readiness Report

**Date**: 2026-11-20
**Path**: points & reputation stage 1 (migrations 0103–0105, `app/points`, `app/groups/application/attendance_points.py`, `app/main.py` job, matrix rows 68–70, frontend `/admin/points`, `/account/points`)
**Target**: production
**Status**: Ready (with minor recommendations)

## TL;DR
- Recommendation: **GO**. No blockers. 0 warnings, 6 info items.
- Migrations are reversible, named within 63 chars, 0104 sets `lock_timeout`, 0105 seeds EMISSION + config and refuses its downgrade once any `point_transactions` row exists, naming the recovery path. Each step has a round-trip or refusal test.
- The auto-close job reads up to 100 candidates without locks, rechecks each under `SKIP LOCKED` in its own transaction, logs a lost race once as a WARNING and other failures with a traceback, writes one summary line per run and never re-raises.
- The runbook (architecture.md, 0103–0105) covers: dump first, no image-only rollback, guard count, downgrade run from the new image, losses listed, restore path.

## Key Decisions
- Project-wide gaps that already exist (no Sentry/error tracking, no metrics, no rate limiting, a single uvicorn process) are not counted against this feature. The feature adds no new public endpoint, external call or infrastructure. Health stays `GET /api/health`.
- The frontend production build (`next build`) was not run, because its `prebuild` writes `public/assets/plugin-sdk.js` and this check is read-only. Typecheck (0 errors, per test-suite-results.md) and ESLint on every new points file (clean) were used in its place.

## Open Questions / Risks
- Nothing alerts on the auto-close job. Its health is the `attendance close: closed=… awarded=…` log line every 15 min, the same model the matcher and the embedding reconcile use.
- 0105 has no `lock_timeout`. Its full-table `UPDATE inventory_items` and `UPDATE terms` run before uvicorn starts, when the old backend is already stopped. Only the matcher could contend, and it does not lock those rows. Risk is low.
- The rollback target `downgrade 0102` assumes 0102 (commit 246ea24) is already deployed. If 0102 ships in the same release, its own runbook applies as well.

## Executive Summary
- **Recommendation**: GO
- **Overall Readiness**: 95%
- **Deployment Risk**: Low
- **Blockers**: 0  Concerns: 0  Recommendations: 6

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 100% | `points_config` single row (unique on `((true))`), seeded by 0105. The admin PUT validates the full replace (integer ranges, multipliers 0.01–9.99 with two decimal places, 1–5 distinct levels 0–1000) with Polish 400s via the `ValueError` handler and an `updated_at` compare → 409 under `FOR UPDATE`. No env vars or secrets added. |
| Monitoring | 85% | One summary log line per job run, one WARNING per lost race, a traceback per failed term, and an outer catch that logs a failed candidate read. No metrics or alerting (pre-existing project pattern). |
| Resilience | 95% | `mapped_transaction_conflicts` maps 40P01/40001 to rollback + `StaleDataError` 409 on confirm, presence, close and config writes. Other errors propagate. The unique source key catches a duplicate award (IntegrityError → 409). Locks are taken term → accounts (party-id order) → items. |
| Performance | 95% | Job batch 100 with `ix_terms_occurs_on_attendance_open` (partial, open lists). Point reads use `ix_point_entries_account_id_transaction_id` and `ix_point_transactions_party_counterparty_occurred_at`. 0105 backfill is a single `UPDATE … FROM`. |
| Security | 100% | Row 68 `GET/PUT /api/points/config` ADMIN only. Row 69 `GET /api/points(/.*)?` READ only, no `mcp:*`. Row 70 presence PUT EDIT/mcp:edit, placed before rows 26–27, with the organizer check in the service. Personalised `/me` routes set `private, no-store`. `/account` and `/admin` are already in `PROTECTED_PREFIXES`. |
| Deployment | 95% | 0103 creates tables only, 0104 adds columns only, 0105 seeds data only. Downgrades drop in reverse dependency order. The runbook is complete. Tests: 0103 and 0104 downgrade→head round-trips, the 0105 seed test and the 0105 refusal test. Suites green against baseline (backend 1673/2 known stale, matcher 125, vitest 33 baseline failures, typecheck 0). |

## Blockers (Must Fix)
None.

## Concerns (Should Fix)
None.

## Recommendations (Nice to Have)
1. **Auto-close starvation by a failing term** (`app/groups/application/attendance_points.py::close_due_attendance`). Candidates are read oldest first with `LIMIT 100`. A term that fails permanently for a reason other than a race is logged and retried every run, and it keeps its place at the head of the batch. Only 100 or more such terms would block newer ones. Possible fix: alert on repeated `attendance close of term … failed`, or order failed terms after the rest.
2. **0105 without `lock_timeout`** (`alembic/versions/0105_points_seed.py`). Add `SET LOCAL lock_timeout = '5s'` for consistency with 0104 and `migrations.md`. Low risk, because the backend is stopped while it runs.
3. **Run `next build` before release** (src/frontend). Two new client-only route files (`admin/(shell)/points/page.tsx`, `(panel)/account/points/page.tsx`). Typecheck and lint are clean, but the production build has not been run for this change.
4. **Alerting on the job log line**. If any log monitoring exists, alert when no `attendance close:` line appears for more than 30 min. This is the same shape as the matcher window line.
5. **0104 lock timeout aborts container start**. If 0104 hits its 5 s `lock_timeout`, `alembic upgrade head` fails and the backend, which has no restart policy, stays down. The runbook says "retry if it times out". Spell out the retry command (`docker compose up -d backend`).
6. **Pre-existing, project-wide**: no error tracking (Sentry), no metrics, no rate limiting. This feature does not make any of them worse. They are listed for completeness, not as blockers for this feature.

## Verified Details
- Constraint and index names, longest first: `ix_point_transactions_party_counterparty_occurred_at` (52), `fk_point_transactions_counterparty_party_id_parties` (51), `fk_point_entries_transaction_id_point_transactions` (50). All are 63 characters or fewer.
- EMISSION uniqueness: partial unique index `uq_point_accounts_account_type_emission`, plus CHECK `ck_point_accounts_party_id_account_type`.
- The 0105 guard counts `point_transactions` and raises `RuntimeError` naming two ways out: restore the dump, or purge (losing balances) and rerun. `env.py` uses `transaction_per_migration=True`.
- The scheduler uses `misfire_grace_time=None, coalesce=True`, so late runs collapse into one. With a single uvicorn process the job is not duplicated, and `SKIP LOCKED` would make duplicates safe anyway.
- No secrets were read or printed.

## Next Steps
1. Optional: add `lock_timeout` to 0105 and run `next build` once before release.
2. Deploy per the architecture.md 0103–0105 runbook: `pg_dump`, matcher suite, `up -d`, then the verify queries and the job log line.
