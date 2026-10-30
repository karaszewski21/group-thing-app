# Production Readiness Report: Re-verification after fixes

**Date**: 2026-10-30
**Path**: `.maister/tasks/development/2026-10-29-event-public-page` (backend `src/backend`, migrations 0071–0072, runbook in `.maister/docs/project/architecture.md`)
**Target**: production
**Status**: With Concerns
**Previous report**: `verification/production-readiness-report.md` (GO with mitigations, 82%)

## TL;DR
- **GO with mitigations.** The migration lock and rollback concerns are fixed. Migration 0071 now sets `SET LOCAL lock_timeout = '5s'`, and the setting really applies: `alembic/env.py` runs each migration in its own transaction (`transaction_per_migration=True`, online and offline). The 0071–0072 runbook is accurate and you can follow it as written.
- The new migration 0072 adds two plain `CREATE INDEX` statements (not `CONCURRENTLY`) on the young, small `events` and `event_attendances` tables. Each takes a brief SHARE lock that blocks writes but not reads. Its downgrade drops both indexes in reverse order. A dedicated migration test covers it, and the exact index-set test in `tests/test_events_migration.py` is updated (3/3 pass, as reported).
- The `sign_up` fix works. The guest name is validated and moderated before the `FOR SHARE` lock, and `_require_open` runs again under the lock, so the row lock no longer lasts as long as the moderation call. The DB connection, however, **is still checked out** for the whole moderation call (see I-new-1).
- Two accepted risks are still open: W8, the unthrottled guest sign-up (previous report's W2), and W9, the uncapped public page (previous report's W3). Both are recorded only as "left as follow-ups" in `orchestrator-state.yml` and in the work log. Neither has its own follow-up task yet.

## Key Decisions
- **`SET LOCAL` takes effect.** Alembic's `begin_transaction(_per_migration=True)` opens a real transaction around each revision on PostgreSQL, which has transactional DDL. The connection is fresh from `connectable.connect()`, so `_in_external_transaction` is false. `SET LOCAL` therefore covers every lock 0071 acquires (`ADD COLUMN`, the FK to `events`, the two index builds, both FK drops and recreations) and resets on commit. It does not reach 0072. The runbook's "If 0071 fails" claim (nothing applied, `alembic_version` stays at `0070`) is correct for the same reason.
- **0072 without `lock_timeout` or `CONCURRENTLY` is accepted.** The tables only arrived in 0070 and hold little data. A SHARE lock does not conflict with readers, and the build takes milliseconds. Not a concern at this volume.
- **W8/W9 stay warnings (accepted risk), not blockers.** The reasoning is the same as before. The spec accepts W8 explicitly, the other public writes in the app are unthrottled too, and the user deferred both items.

## Open Questions / Risks
- **Row counts.** What are the production row counts of `messages` and `conversation_reads`? `lock_timeout` only limits how long the migration waits for a lock. Once 0071 holds ACCESS EXCLUSIVE, the FK validation scans still block chat traffic for as long as they take. Runbook step 1 covers this: check the counts, and split into `NOT VALID` + `VALIDATE` if needed.
- **Crash-loop on failure.** `docker-compose.yml` runs `alembic upgrade head && exec uvicorn ...`. If 0071 hits the 5s lock timeout, the backend container exits and restarts until it succeeds. During that time the whole API is down, not only chat. The runbook documents this ("crash-loops on start"). Anyone deploying should be ready to clear the blocking query in `pg_stat_activity`.
- **Follow-up tasks for W8/W9.** Are follow-up tasks or issues for W8 and W9 going to be created? Today the only record is inside this task folder.

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 88% (was 82%)
- **Deployment Risk**: Medium, down from Medium-high on the migration side. The remaining risk is the unthrottled public write plus the FK validation time on `messages`.
- **Blockers**: 0  Concerns: 2 (W8, W9; both accepted, follow-up)  Recommendations: 4

## Prior issues: status

| Prior ID (this report / impl-verification) | Issue | Status | Evidence |
|---|---|---|---|
| W1 / W7 | 0071 takes locks with no `lock_timeout` | **Resolved** | `0071_event_conversations.py` `upgrade()` starts with `op.execute("SET LOCAL lock_timeout = '5s'")`. `env.py` sets `transaction_per_migration=True` (lines 33, 45). |
| W2 / W8 | Unthrottled public guest sign-up; spam guests can't be removed and block event delete | **Residual, accepted follow-up** | `router.py` and `service.py` have no limiter. The work log says "Left open: W8". `orchestrator-state.yml:304` says "W8/W9/W12 left as follow-ups". |
| W3 / W9 | Public event page payload uncapped | **Residual, accepted follow-up** | `app/events/page.py` still returns every active attendee and their items (`attendee_count=len(attendee_party_ids)`, no cap). |
| W4 / W10 | 0071 rollback undocumented and data-destroying | **Resolved** (destruction documented, mitigated by dump step) | See the runbook check below. |
| Code review W2 | Missing per-party indexes | **Resolved**, via 0072 | `ix_events_author_party_id`, partial `ix_event_attendances_party_id WHERE withdrawn_at IS NULL`. The models declare the same indexes. |
| Code review W3 | `sign_up` held `FOR SHARE` during moderation | **Resolved** (row-lock scope) | `service.py:399-406` |
| I1 | Event delete silently cascades chat (no audit) | Open (nice-to-have) | — |
| I2 | Reserved slug `event`: check existing orgs | **Resolved as a runbook step** | Runbook step 2 |
| I3 | OG description length | Open (cosmetic) | — |
| I4 | Old `/events/:id` links 404 | Open (accepted); now noted in runbook step 4 | — |

## Verification details

### 0071: lock_timeout
- `SET LOCAL lock_timeout = '5s'` is the first statement of `upgrade()`, so every later lock acquisition in the same transaction is bounded.
- `transaction_per_migration=True` in both `run_migrations_offline` and `do_run_migrations` means one transaction per revision. `SET LOCAL` is scoped to 0071 only and does not leak into 0072 or later revisions.
- `downgrade()` has no `lock_timeout`. A rollback runs manually and is rare, so this is info only (I-new-2).

### 0072: event party indexes
- **Lock impact**: non-concurrent `CREATE INDEX` takes a SHARE lock on `events` and on `event_attendances`. Inserts, updates and deletes (event create/edit, sign-up, withdraw) wait for the build, while reads continue. At current volume the build takes milliseconds. No `lock_timeout`, but SHARE only waits for in-flight writers on two low-traffic tables.
- **Reversibility**: `downgrade()` drops `ix_event_attendances_party_id`, then `ix_events_author_party_id`, in reverse order. No data is touched.
- **Tests**: the new `test_event_party_indexes_migration.py` does downgrade then upgrade. The exact index sets in `test_events_migration.py` (lines 82 and 95) now include both indexes. The suite was not re-run, per instructions. The caller reports 3/3 passing.
- **Model parity**: `app/events/models.py` declares `Index("ix_events_author_party_id", ...)` and the partial attendance index, so ORM and schema agree.

### Runbook check ("Deploy / rollback for the event page release (migrations 0071–0072)")
Checked against the migration code:
- **Accurate.**
  - FK names and the CASCADE scope ("for every conversation kind") match `_recreate_child_fks("CASCADE")`.
  - Index names and the partial predicate match.
  - The "nothing of 0071 is applied" failure mode matches `transaction_per_migration`.
  - "`alembic downgrade 0070` deletes every EVENT conversation together with its messages and read markers" is correct. `downgrade()` runs `DELETE FROM conversations WHERE kind = 'EVENT'` while the CASCADE FKs still exist, and only then restores the non-cascading FKs.
  - "Downgrading 0072 only drops its two indexes" is correct.
- **Actionable.** The steps are ordered and concrete:
  1. Size check, with the `NOT VALID` + `VALIDATE` escape hatch.
  2. Reserved-slug query.
  3. `pg_dump -Fc` of the three messaging tables.
  4. Deploy frontend and backend together.
  5. Verification queries and smoke steps.
  6. Lock-timeout recovery.
  7. Image-only rollback preferred over downgrade.
- **Minor gaps** (info):
  - Step 1 says to split into `NOT VALID` + `VALIDATE` but gives no row-count threshold. The previous report suggested about 1M rows.
  - The "If 0071 fails" text doesn't say that the crash-loop takes down the whole API, not just chat.
  - Image-only rollback leaves EVENT rows that make `/api/conversations/{id}` return 500 on the old image. This is documented. It is acceptable as a short-lived state.

### sign_up lock scope
- **Guest path**:
  1. Unlocked `db.get(Event)` plus `_require_open`, which fails fast on missing or ended events before any moderation cost.
  2. `_validate_guest_name`.
  3. `check_text(PROFILE_NAME)`.
  4. `db.get(..., with_for_update={"read": True}, populate_existing=True)`, then `_require_open` again under the lock.
- **Effect**: the row-level `FOR SHARE` lock is now held only for the insert and commit, so a concurrent `delete_event` or update no longer waits on moderation latency. Correct.
- **Caveat (I-new-1)**: the session autobegins at the first unlocked `db.get`, so the pooled connection stays checked out, with an open transaction holding ACCESS SHARE on `events`, for the whole `check_text` call. Moderation has a timeout (`text_guard.py`), so this is bounded. The fix shortens **row-lock** time, not **connection** hold time. Under W8-style abuse, pool slots are still tied up for each moderation call. Calling `await db.rollback()` (or committing) before `check_text` on the guest path would release the connection.

## Category Breakdown

| Category | Score | Status |
|---|---|---|
| Configuration | 95% | OK. No new config; the reserved slug is covered by the runbook. |
| Monitoring | 85% | Unchanged / not affected. Moderation timeouts are logged. |
| Resilience | 85% | Improved: lock timeout, `_require_open` re-check under lock |
| Performance | 80% | Improved: 0072 indexes. Residual: uncapped page (W9), connection held during moderation. |
| Security | 75% | Residual: unthrottled public sign-up (W8, accepted) |
| Deployment | 92% | Improved: lock_timeout, reversible 0072, accurate runbook |

## Blockers (Must Fix)
None.

## Concerns (Should Fix)

### W8: Public guest sign-up unthrottled (residual, accepted follow-up)
- **Location**: `src/backend/app/events/router.py` (`sign_up`), `src/backend/app/events/service.py` (`sign_up`, `delete_event`)
- **Issue**: Unchanged. Anonymous requests each trigger moderation, a guest profile and an attendance row. Guests can't be removed, and they block event delete.
- **Recommendation**: Add an nginx `limit_req` on `^/api/events/.+/attendances$`, or an in-process limiter like `send_limiter.py`. Separately, add an author or moderator action to remove guests. Turn this into a tracked follow-up task.

### W9: Public event page payload uncapped (residual, accepted follow-up)
- **Location**: `src/backend/app/events/page.py`
- **Issue**: Unchanged. The page returns every attendee plus their listed items. Expanding `IN` lists fail at roughly 32k attendees.
- **Recommendation**: Show the first N attendees plus `attendee_count`, and cap items per attendee. Track it together with W8.

## Recommendations (Nice to Have)
- **I-new-1**: On the guest path of `sign_up`, release the connection before `check_text`, for example with `await db.rollback()` after the cheap pre-check. Moderation latency then doesn't hold a pool slot.
- **I-new-2**: Optionally add `SET LOCAL lock_timeout` to 0071 `downgrade()` and to 0072. Its value grows with table size.
- **I-new-3**: In runbook step 1, give a concrete row-count threshold (about 1M rows) for the `NOT VALID` split. In "If 0071 fails", say that the whole API is unavailable during the crash-loop.
- **I1 / I3 / I4** (carried over): audit log for cascaded chat deletes; truncate the OG description; redirect for old `/events/:id` links.

## Next Steps
1. Before deploy, run runbook steps 1–3: row counts of `messages` and `conversation_reads`, the `slug = 'event'` query, and `pg_dump` of the messaging tables.
2. Deploy off-peak and watch the first start. If `lock_timeout` fires, clear the blocker via `pg_stat_activity` and restart.
3. Create follow-up tasks for W8 (rate limit and guest removal) and W9 (page cap). Today they are recorded only in this task's state and work log.
4. Optional: I-new-1 and I-new-3.
