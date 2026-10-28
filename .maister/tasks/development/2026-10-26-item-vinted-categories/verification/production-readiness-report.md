# Production Readiness Report

**Date**: 2026-10-27
**Path**: `C:\Users\karas\Desktop\swaptime\group-thing-app` (uncommitted working tree vs HEAD `12587e6`)
**Target**: production
**Status**: Not Ready

## TL;DR
- **NO-GO for any database that holds real data** (VPS A prod, or a dev compose volume you want to keep). It becomes GO WITH MITIGATIONS once B1 and B2 are done: take a verified `pg_dump`, then follow a written cutover runbook.
- The code is sound: backend 878/878 tests pass, frontend has only the 5 known HEAD failures, and tsc is clean. The VPS B moderation-cron contract is intact.
- The risk is in deployment. `docker-compose.yml` runs `alembic upgrade head` on every backend start. So the next `docker compose up` runs 0067 and 0069 automatically, with no operator gate, and irreversibly wipes all products, items, reservations, swaps, conversations, ledger rows, needed items and pledges.
- You cannot roll back by switching images. The old image's head is 0063, so it fails on a DB stamped 0069, and the downgrades of 0067, 0068 and 0069 are lossy or refuse to run. The only real rollback is restoring the dump.
- The wipe orphans the Spaces photo objects, even though the outbox `storage.objects_delete` mechanism already exists and could clean them up.

## Key Decisions
- **What was assessed.** I judged the delta this task introduces, not the whole app. The project-wide production gaps (no `/health` endpoint, no error tracking, no rate limiting, no CI) existed before this task. They are listed once as info and are not counted as blockers of this change.
- **The data wipe is a deployment risk, not a code defect.** The spec deliberately accepts it as "dev data" (spec, "Destructive data revision"). It only becomes a blocker because nothing stops it from running against a persistent DB. Whether VPS A holds real user data is an open question.
- **VPS B cron contract: verified intact.** The cron (`group-thing-ai/app/photo_store.py`, `scripts/moderation_db_role.sql`) only touches `product_photos` columns `id, storage_key, content_sha256, status, moderation_attempts, moderation_retry_at, created_at, updated_at` and INSERTs into `moderation_decisions`. This task does not change `app/product/models.py`, and none of those columns change. The cron never read listings or `item_listing_preferences`, so removing the gate has no effect on it. If 0069 deletes a photo the cron has leased, the guarded finalize (`status='PENDING' AND moderation_attempts=<claimed>`, `rowcount != 1`, then discard) drops the result and writes no decision row. Nothing breaks.
- **The deleted `scripts/withdraw_unmoderated_listings.py` was a one-time cutover cleanup.** No code, compose file or cron imports or schedules it. Only documentation references it, and the `group-thing-ai` README is now out of date (C4).
- **Frontend/backend deploy order.** One compose release rebuilds both services, so there is no mixed-version window between them. `listing_mode` on `POST /api/inventory-items` is optional, so creating items stays backward compatible. The needed-item contract (`name` replaces `product_id`/`product_name`; `MyPledgeResponse.item_name`) and the snake_case `Category` are breaking changes. A browser tab still holding the old SPA will get 422 errors or show blank values until it reloads. This is acceptable for a single release.

## Open Questions / Risks
- **Does VPS A (production) already hold user data?** If yes, 0069 deletes every user's items and conversations. That is a product decision, not just an ops step. Users would need to be told, or the wipe would need replacing with a mapping migration.
- **Is there a persistent staging DB?** None is defined. Only one `docker-compose.yml` exists, and VPS A deploys with it.
- **Partial-failure state.** Alembic uses `transaction_per_migration=True`. If 0069 fails (for example a missing fixture file or an unexpected FK), 0064–0068 stay committed: needed items and pledges are already gone, and the DB sits at 0068. The backend then never starts, because `alembic upgrade head && uvicorn` stops at the failed migration. The fix is to correct the cause and re-run. Restoring the dump is only needed if you want the needed items back.
- **Vinted tree depth is incomplete** (accepted by the user on 2026-10-27). Products created now sit on today's leaves. When a later task deepens the tree, those leaves become inner nodes, and products on them can no longer be re-categorized there (the leaf-only rule). That later task needs its own data plan.

## Executive Summary
- **Recommendation**: NO-GO (GO WITH MITIGATIONS once B1 and B2 are done)
- **Overall Readiness**: 70%
- **Deployment Risk**: Critical on a DB with real data; Low on a throwaway dev DB
- **Blockers**: 2  Concerns: 6  Recommendations: 3

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 95% | No new env vars. The fixture `alembic/data/` is inside the image context (`src/backend/.dockerignore` does not exclude it) but is still untracked (C1). |
| Monitoring | 80% | No change in this task. The 0069 wipe logs no row counts. Project baseline gaps listed under info. |
| Resilience | 85% | The gift limit is a documented soft limit under concurrency. Each migration runs in its own transaction, so a failure leaves a well-defined state. |
| Performance | 90% | One batched insert of 2286 rows. Set-based deletes through temp tables. Category list stays a single query. |
| Security | 90% | Needed-item names go through `ensure_no_contact_info` and `check_text`. No new endpoints are exposed without authorization. |
| Deployment | 30% | Destructive, auto-run, irreversible migration with no backup step, runbook or rollback plan. Spaces objects orphaned. Cross-repo docs out of date. |

## Blockers (Must Fix)

### B1. The destructive 0067/0069 migrations run automatically on deploy, with no backup or gate (critical, fixable: true)
- **Location**: `docker-compose.yml:45` (`alembic upgrade head && exec uvicorn ...`), `src/backend/alembic/versions/0067_wipe_needed_items.py`, `src/backend/alembic/versions/0069_vinted_categories.py`
- **Issue**: Any `docker compose up` after merging runs both migrations against the `postgres_data` volume:
  - 0067 deletes every pledge and needed item.
  - 0069 deletes every category, every product (all products are in the wiped categories), and every item with its reservations, ledger rows, swaps, conversations and messages, balances, listing preferences, photo rows, moderation decisions, related notifications, and PENDING term-end outbox events.

  There is no confirmation step, no environment guard and no pre-migration backup.
- **Fix**:
  1. Before deploying to any DB you want to keep, take a verified dump: `pg_dump -Fc` as the DB owner, then confirm it restores into a scratch database.
  2. Treat the wipe as a deliberate, announced step.
  3. Optionally add a guard in 0069, for example refusing when the `products` count is above a threshold unless an explicit opt-in env var is set, so an accidental `up` on a populated DB fails safely.

### B2. No rollback plan, and image rollback is impossible (critical, fixable: true)
- **Location**: `0067.downgrade` (no-op), `0068.downgrade` (deletes all needed items and pledges), `0069.downgrade` (raises if any product exists), `.maister/docs/project/architecture.md` (no notes on 0064–0069)
- **Issue**: Redeploying the previous image fails at start. Its Alembic history ends at 0063, so `alembic upgrade head` cannot locate revision 0069 and the backend crash-loops. A schema downgrade with the new image (`alembic downgrade 0063`) first requires deleting every product created after the release, and it still does not bring back the wiped data. In practice, restoring the B1 dump is the only rollback.
- **Fix**: Add a "Category tree / legacy wipe cutover (0064–0069)" section to `architecture.md`, next to the existing 0048 and VPS B cutover notes. It should cover:
  - **Pre-deploy**: take the dump; set `MODERATION_CRON_ENABLED=false` on VPS B, which is optional but avoids leases on rows about to be deleted.
  - **Deploy**: run `docker compose up -d`.
  - **Verify**:
    - `SELECT count(*) FROM categories` = 2286.
    - 9 roots.
    - Products and items = 0.
  - **Re-enable** the cron.
  - **Rollback**: stop the backend, `pg_restore` the dump, deploy the old image.

  Also state explicitly that rollback is restore-only.

## Concerns (Should Fix)

### C1. New migrations, the fixture and new modules are untracked (warning, fixable: true)
- **Location**: `git status`: `?? src/backend/alembic/data/`, `?? src/backend/alembic/versions/0064..0069_*.py`, `?? src/frontend/src/components/shared/CategoryTreePicker.tsx`, `?? src/frontend/src/utils/categoryTree.ts`, plus 8 new backend and 3 new frontend test files.
- **Issue**: If the commit leaves out `alembic/data/vinted_categories_pl.json`, 0069 raises `FileNotFoundError` after 0064–0068 have already committed (see Open Questions, partial-failure state). If it leaves out `categoryTree.ts` or `CategoryTreePicker.tsx`, the frontend build breaks.
- **Fix**: Commit every `??` path in this list together with the modified files. Run `git status` after the commit to confirm.

### C2. Spaces photo objects orphaned by the wipe (warning, fixable: true)
- **Location**: `0069_vinted_categories.py`, `_WIPE_DELETES` step 9 (`DELETE FROM product_photos ...`)
- **Issue**: The `large`/`thumb` objects of every deleted `product_photos` row stay in the bucket. Approved ones also stay publicly readable through the CDN if someone has the URL. The spec says "a migration cannot reach storage", but the app already has a durable path for this: `app/storage/outbox_listener.py` handles `storage.objects_delete` with payload `{"keys": [...]}`. `delete_product` stages it through `_stage_photo_files_delete`.
- **Fix**: In 0069, before deleting `product_photos`, insert `outbox_entries` rows with `event_type='storage.objects_delete'` and the derived `large_key`/`thumb_key` of the `wipe_photos` set, batched. The API poller then deletes the objects after commit. Alternatively, before the deploy, list the `storage_key` values from the dump and run a one-off bucket cleanup under `products/`.

### C3. Out-of-date "items cannot be listed" pairing note in architecture.md (warning, fixable: true)
- **Location**: `.maister/docs/project/architecture.md:67`
- **Issue**: The note still says that with the app flag on and the cron off, photos stay PENDING "and their items cannot be listed". With the gate removed, items can be listed; only the photos stay hidden from non-owners.
- **Fix**: Change the sentence to "...photos stay PENDING and are visible only to their owner".

### C4. Cross-repo documentation drift in `group-thing-ai` (warning, fixable: true)
- **Location**: `../group-thing-ai/README.md` "Pairing with the app" (~L467: "their listings cannot be published") and "Cutover" step 4 (~L498: `docker compose exec backend python -m scripts.withdraw_unmoderated_listings`)
- **Issue**: An operator who follows that README for a fresh VPS A/B setup will run a script that no longer exists and fails with `No module named scripts.withdraw_unmoderated_listings`. The pairing note also describes a gate that has been removed. `architecture.md` in this repo was already updated (step 4 now reads "No longer needed").
- **Fix**: Mirror the `architecture.md` change in the `group-thing-ai` README, in that repo.

### C5. Not zero-downtime: 0068 drops `needed_items.product_id` (warning, fixable: false)
- **Location**: `0068_needed_item_name.py`
- **Issue**: An old backend process that is still serving fails on every needed-item query once the column is gone. Compose recreates the container (stop old, start new), so the result is a short outage rather than errors, but this is not a rolling deploy.
- **Fix**: Accept a short maintenance window and note it in the runbook (B2).

### C6. 0069 wipe logs no counts (info, fixable: true)
- **Location**: `0069_vinted_categories.py`, `upgrade()`
- **Issue**: Nothing records how many products, items or photos were deleted, which makes it hard to audit a production run afterwards.
- **Fix**: Print or log the sizes of the `wipe_*` temp tables before deleting. Alembic output lands in the backend container logs.

## Recommendations (Nice to Have)
- **R1** (info, fixable: true): The gift limit (`MAX_GIFT_ITEMS=10`, `_require_gift_capacity` in `app/groups/application/term_item_listings.py:99`) is a documented soft limit, because two concurrent requests for different items can both pass. If a hard limit matters, lock the owner's profile row (`FOR UPDATE`) before counting.
- **R2** (info, fixable: true): After deploying, smoke-test:
  - creating an item with "Oddam" mode (ACTIVE, preference row present);
  - the 11th gift (409, Polish message);
  - a non-leaf category (409);
  - adding and editing a needed item by name on the public term page.
- **R3** (info, fixable: false): These project baseline gaps predate this task and are not counted against it: no `/health` endpoint, no error tracking (Sentry or similar), no rate limiting, no CI/CD (`architecture.md`: "No CI/CD yet"). There is also drift in `architecture.md:221`: it says compose uses `runtime-dev` with `MODERATION_TEXT_ENABLED="false"`, but `docker-compose.yml` uses `target: runtime` with `"true"`.

## Next Steps
1. Decide whether VPS A holds data that must survive (Open Questions). If it does, reconsider the wipe before anything else.
2. Commit every untracked migration, fixture, component and test file (C1).
3. Write the cutover and rollback runbook in `architecture.md` (B2) and fix the out-of-date pairing note (C3).
4. Optionally stage `storage.objects_delete` in 0069 (C2), add the populated-DB guard (B1) and the count logging (C6).
5. Update the `group-thing-ai` README (C4).
6. On deploy day: take a verified `pg_dump`, disable the cron, run `docker compose up -d`, check that 2286 categories and 9 roots exist, re-enable the cron, then run the smoke test (R2).

## Structured Result
```yaml
status: not_ready
recommendation: NO-GO
report_path: C:\Users\karas\Desktop\swaptime\group-thing-app\.maister\tasks\development\2026-10-26-item-vinted-categories\verification\production-readiness-report.md
overall_readiness: 70
deployment_risk: critical
categories:
  configuration: { score: 95, status: ok }
  monitoring: { score: 80, status: ok }
  resilience: { score: 85, status: ok }
  performance: { score: 90, status: ok }
  security: { score: 90, status: ok }
  deployment: { score: 30, status: not_ready }
issue_counts: { critical: 2, warning: 5, info: 4 }
```
