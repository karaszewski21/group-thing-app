# Production Readiness Report (re-verification after cycle-1 fixes)

**Date**: 2026-10-28
**Path**: `C:\Users\karas\Desktop\swaptime\group-thing-app` (uncommitted working tree vs HEAD `12587e6`)
**Target**: production
**Status**: With Concerns
**Baseline**: `verification/production-readiness-report.md` (cycle 1, NO-GO, 2 blockers / 6 concerns)

## TL;DR
- **GO WITH MITIGATIONS.** Both blockers are now mitigated by procedure, not by code. B1: the runbook's dump step plus the verified dev-DB dump. B2: a written rollback that restores the dump. No blocker is left open.
- The residual risk is human. `docker compose up` still runs the destructive 0067/0069 with no code guard. A deploy to VPS A that skips runbook step 1 loses data irreversibly. The dev-DB dump does not protect VPS A.
- C2, C3 and C6 are resolved in code and docs. C1 is still pending: about 19 untracked files, to be committed at finalization. C4 is still open in the other repo. C5 is accepted, and the runbook now documents the downtime.
- New risks from the fixes are minor. On a stack without Spaces, the staged photo-delete entries go FAILED after 5 polls; this is harmless. GZip on Starlette 1.6.0 excludes `text/event-stream` and has no streaming endpoints to break.

## Key Decisions
- **No env-var guard is acceptable for this release.** The user chose the runbook plus a backup instead. I count B1 as *mitigated*, not *resolved*. Nothing in code stops an accidental `up` against a populated DB, so the mitigation only works if the operator follows the runbook.
- **The dev-DB dump counts only for the dev volume.** `C:\Users\karas\Desktop\swaptime\db-backups\group-thing-app-dev-20261027T210313Z-rev0063.dump` exists (238 010 B, rev 0063, outside the repo; the work-log records 45 TABLE DATA entries in `pg_restore --list`). It is not a VPS A backup. For production, runbook step 1 has to be done separately on deploy day.
- **The 0069 outbox staging matches the app's own producer.** Keys are `storage_key || '/w1600.webp'` and `'/w400.webp'`, the same as `ProductPhoto.large_key`/`thumb_key` (`app/product/models.py:108,112`) that `_stage_photo_files_delete` uses. The payload shape `{"keys": [...]}` matches `_handle_objects_delete`. Staging one entry per photo keeps each call far below the 1000-key `DeleteObjects` limit. The rows are inserted before `product_photos` is deleted, inside the same migration transaction. `tests/test_vinted_category_seed_migration.py:289` asserts the entry.
- **Wipe row counts reach the logs.** The logger is `alembic.runtime.migration`. In `alembic.ini`, `logger_alembic` is set to INFO and propagates to the console handler, so each `0069 legacy wipe: <table> holds N rows` line lands in the backend container log.

## Open Questions / Risks
- **Does VPS A hold real user data?** This is carried over from cycle 1 and is still unanswered. If it does, the wipe is a product decision that needs user communication, not just an ops step. The runbook describes how to wipe safely, not whether to.
- **Partial-failure state is not in the runbook.** Each migration runs in its own transaction. If 0069 fails (for example a missing fixture because of C1), 0064–0068 stay committed and the backend crash-loops. The runbook should add one line: "if the backend does not come up, check `alembic_version`; fix the cause and restart, or restore the dump".
- **Outbox entries go FAILED where storage is unavailable (info).** `_handle_objects_delete` raises `RuntimeError("Photo storage is not configured")` when `get_storage()` is None. `dispatch_pending` retries on each poll with no backoff and marks the entry FAILED at `MAX_ATTEMPTS = 5` (`app/outbox/dispatcher.py:17,71`).
  - On dev or test stacks without `SPACES_*`, this leaves one FAILED row per wiped photo. It is harmless and does not block the poller, since each entry commits on its own.
  - On production, a Spaces outage longer than about 5 poll intervals fails the cleanup the same way. Those objects are then orphaned, as they were before the fix.
  - This behaviour already existed in `delete_product`; it is not specific to 0069.
- **The runbook has no orphan check (info).** No step confirms that the staged deletes ran. After the deploy, a `SELECT status, count(*) FROM outbox_entries WHERE event_type='storage.objects_delete' GROUP BY status` would show it.

## Executive Summary
- **Recommendation**: GO WITH MITIGATIONS (mitigations: follow the runbook on deploy day, especially a verified `pg_dump` of the target DB; commit every untracked file; answer the VPS A data question)
- **Overall Readiness**: 88% (was 70%)
- **Deployment Risk**: Medium on a DB with real data if the runbook is followed, Critical if it is skipped; Low on a dev DB (backup exists)
- **Blockers**: 0 (2 mitigated)  Concerns: 4 open (C1 pending commit, C4 cross-repo, C5 accepted, new N1)  Recommendations: 3

## Re-judgement of cycle-1 findings

| ID | Cycle-1 finding | Verdict | Evidence |
|----|-----------------|---------|----------|
| B1 | Destructive 0067/0069 run automatically, with no backup or gate | **Mitigated (procedural)**, residual warning | Runbook step 1 in `architecture.md:229` (pg_dump -Fc, verify with `pg_restore --list`, keep it off the host). Dev dump present. `docker-compose.yml:45` still runs `alembic upgrade head` on every start, and 0069 has no populated-DB guard (user decision). |
| B2 | No rollback plan; image rollback impossible | **Resolved** | `architecture.md:226-236`: "Cutover / rollback for the category-tree release (migrations 0064–0069)". Steps: dump, stop cron, deploy together, verify (2286 / 9 roots / `alembic_version`=0069 / `GET /api/categories`), restart cron, smoke test. Rollback is `pg_restore` into an empty DB plus the previous image, stated explicitly as the only rollback. |
| C1 | Untracked migrations, fixture and modules | **Residual (pending)**, warning | `git status` still shows `??` for `alembic/data/` (json + README), `0064`–`0069`, `CategoryTreePicker.tsx`, `categoryTree.ts`, 8 backend and 3 frontend test files. The commit is deferred to finalization on a feature branch, so this is acceptable only if that commit includes all of them. |
| C2 | Spaces photo objects orphaned | **Resolved** | `0069_vinted_categories.py`, `_STAGE_PHOTO_FILES_DELETE`, runs before step 9. Keys and payload match the app producer and listener. Covered by a test. |
| C3 | Stale "items cannot be listed" note | **Resolved** | `architecture.md:67` now reads "photos stay PENDING and are hidden from non-owners, although their items can still be listed". L64 shows `PUT /api/item-listing-preferences/{item_id} → listed whatever the photo status`. |
| C4 | `group-thing-ai` README drift | **Residual**, warning (other repo) | `../group-thing-ai/README.md:469` ("their listings cannot be published") and `:498` (`python -m scripts.withdraw_unmoderated_listings`) are unchanged. The `src/backend/scripts/` package is now deleted, so step 4 of that README fails with "No module named scripts". `:307` should be re-checked too. The lines are listed in the work-log. |
| C5 | Not zero-downtime (0068 drops a column) | **Accepted / documented** | `architecture.md:227` says the old and new backend cannot run side by side, and step 3 says to "expect a short downtime". |
| C6 | 0069 logs no counts | **Resolved** | Per-table `log.info("0069 legacy wipe: %s holds %d rows", ...)`. Alembic logger at INFO. `DROP TABLE IF EXISTS` before each temp table makes a retry within one session safe. |

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | No new env vars. The fixture is in the image context but untracked (C1). |
| Monitoring | 90% | Wipe counts are now logged. Project baseline gaps (no `/health`, no error tracking) are unchanged and not counted (R3). |
| Resilience | 85% | Photo cleanup is durable through the outbox. FAILED after 5 attempts with no backoff (N1, info). Partial-failure path not in the runbook. |
| Performance | 92% | GZipMiddleware (min 1000 B) cuts the ~580 KB `GET /api/categories`. One outbox row per photo, set-based insert. |
| Security | 92% | Needed-item description is now moderated (`ensure_no_contact_info` + `check_text`). GZip has no BREACH-relevant secret reflection on the category endpoint. |
| Deployment | 75% | Runbook and rollback written. Still auto-run destructive migrations with no code guard. Commit pending. Cross-repo README stale. |

## Blockers (Must Fix)
None open. B1 and B2 are mitigated or resolved (see table).

## Concerns (Should Fix)

### W1 (B1 residual). Auto-run destructive migration with no code guard (warning, fixable: true)
- **Location**: `docker-compose.yml:45`, `src/backend/alembic/versions/0069_vinted_categories.py:upgrade()`
- **Issue**: Safety depends entirely on the operator doing runbook step 1 on the target host before `docker compose up`. A routine `git pull && docker compose up -d --build` on VPS A wipes data with no prompt.
- **Recommendation**: Keep the user's decision. On deploy day, take the VPS A dump *before* pulling the new code. If extra safety is wanted later, a one-line guard (refuse when `products` count > 0 unless `ALLOW_LEGACY_WIPE=1`) would turn this into a safe failure.

### W2 (C1). Untracked release files (warning, fixable: true)
- **Location**: see the C1 evidence above.
- **Recommendation**: In the finalization commit, `git add` every `??` path, especially `src/backend/alembic/data/vinted_categories_pl.json`, `0064`–`0069`, `CategoryTreePicker.tsx` and `categoryTree.ts`. Then confirm with `git status --short | grep '^??'` that only task-folder artifacts you intend to exclude, if any, remain.

### W3 (C4). Cross-repo README is stale (warning, fixable: true)
- **Location**: `../group-thing-ai/README.md:469`, `:498` (and possibly `:307`)
- **Recommendation**: Update that README in its own repo before anyone follows its "Cutover" section again. Its step 4 now fails, because the script and the `scripts` package are deleted.

### W4 (new). Runbook lacks the partial-failure branch and an outbox check (info, fixable: true)
- **Location**: `.maister/docs/project/architecture.md:226-236`
- **Recommendation**:
  - After step 3, add: if the backend does not start, read `alembic_version`. At 0068 or earlier, fix the cause (often a missing fixture) and restart, or roll back with the dump.
  - Optionally, after step 4, check that the `storage.objects_delete` entries reach PROCESSED.

### N1 (new). Staged photo deletes become FAILED where storage is missing or down (info, fixable: false)
- **Location**: `app/storage/outbox_listener.py:_handle_objects_delete`, `app/outbox/dispatcher.py:71`
- **Issue**: There is no backoff, and an entry is marked FAILED after 5 attempts. On stacks without Spaces, this produces harmless FAILED rows. On production, a Spaces outage could leave orphans, the same as the existing `delete_product` path.
- **Recommendation**: Accept. If needed, re-queue the entries manually (`UPDATE outbox_entries SET status='PENDING', attempts=0 WHERE event_type='storage.objects_delete' AND status='FAILED'`).

### C5. Not zero-downtime (warning, fixable: false)
Accepted and documented in the runbook. No action.

## Recommendations (Nice to Have)
- **R1** (info, fixable: true): The gift limit is a soft limit under concurrency. Unchanged from cycle 1.
- **R2** (info): The smoke test is now runbook step 6. Also check that `GET /api/categories` returns `Content-Encoding: gzip` when the request sends `Accept-Encoding: gzip`. `src/frontend/nginx.conf` does not double-compress, because nginx skips responses that already carry a `Content-Encoding`.
- **R3** (info, fixable: false): The project baseline gaps (no `/health`, no error tracking, no rate limiting, no CI) predate this task and are not counted.

## Next Steps
1. Answer whether VPS A holds user data that must survive. If it does, decide on communication or a mapping migration before deploying.
2. Finalization commit on a feature branch, including every untracked file (W2). Verify with `git status`.
3. Optionally add the partial-failure line and the outbox check to the runbook (W4).
4. Update `../group-thing-ai/README.md` in its own repo (W3).
5. Deploy day on VPS A: follow the runbook exactly, starting with a verified `pg_dump` taken on and kept off that host.

## Structured Result
```yaml
status: with_concerns
recommendation: GO_WITH_MITIGATIONS
report_path: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-26-item-vinted-categories\verification\production-readiness-reverify.md
overall_readiness: 88
deployment_risk: medium
categories:
  configuration: { score: 95, status: ok }
  monitoring: { score: 90, status: ok }
  resilience: { score: 85, status: ok }
  performance: { score: 92, status: ok }
  security: { score: 92, status: ok }
  deployment: { score: 75, status: with_concerns }
issues:
  - { source: production_readiness, severity: warning, category: deployment, description: "B1 residual: destructive 0067/0069 auto-run with no code guard; mitigated only by runbook + dump", location: "docker-compose.yml:45, alembic/versions/0069_vinted_categories.py", fixable: true, suggestion: "Take VPS A dump before pulling; optional ALLOW_LEGACY_WIPE guard" }
  - { source: production_readiness, severity: warning, category: deployment, description: "C1: migrations 0064-0069, fixture, CategoryTreePicker/categoryTree and tests still untracked", location: "git status ??", fixable: true, suggestion: "Commit all ?? paths at finalization; re-check git status" }
  - { source: production_readiness, severity: warning, category: deployment, description: "C4: group-thing-ai README references deleted script and removed gate", location: "../group-thing-ai/README.md:469,498", fixable: true, suggestion: "Update README in that repo" }
  - { source: production_readiness, severity: warning, category: deployment, description: "C5: 0068 drops column; short downtime (documented)", location: "0068_needed_item_name.py", fixable: false, suggestion: "Accept maintenance window" }
  - { source: production_readiness, severity: info, category: deployment, description: "Runbook lacks partial-failure branch and outbox PROCESSED check", location: ".maister/docs/project/architecture.md:226-236", fixable: true, suggestion: "Add one line each" }
  - { source: production_readiness, severity: info, category: resilience, description: "Staged storage.objects_delete entries go FAILED after 5 no-backoff attempts without Spaces", location: "app/outbox/dispatcher.py:71, app/storage/outbox_listener.py", fixable: false, suggestion: "Accept; re-queue manually if needed" }
  - { source: production_readiness, severity: info, category: resilience, description: "Gift limit is a soft limit under concurrency", location: "app/groups/application/term_item_listings.py", fixable: true, suggestion: "FOR UPDATE on owner row if a hard limit matters" }
  - { source: production_readiness, severity: info, category: monitoring, description: "Project baseline gaps (no /health, error tracking, rate limiting, CI) predate task", location: "project-wide", fixable: false, suggestion: "Separate task" }
issue_counts: { critical: 0, warning: 4, info: 4 }
```
