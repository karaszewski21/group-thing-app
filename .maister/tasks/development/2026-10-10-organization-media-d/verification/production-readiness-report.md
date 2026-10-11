# Production Readiness Report

**Date**: 2026-10-11
**Path**: `.maister/tasks/development/2026-10-10-organization-media-d` (group-thing-app `src/backend`, `src/frontend`; sibling repo `group-thing-ai`)
**Target**: production
**Status**: With Concerns

## Executive Summary
- **Recommendation**: GO with mitigations
- **Overall Readiness**: 82%
- **Deployment Risk**: Medium. The code is sound. The risk is in the operator steps: the 3-step cross-repo deploy order, the grants re-run that also sets the cron password, and a rollback that destroys data.
- **Blockers**: 0  Concerns: 7  Recommendations: 5

Evidence gathered for this review:
- **Backend feature tests**: 48 passed. Suites: `test_organization_media*` (6 files) and `test_public_preview`. They run against TestContainers Postgres, and the migration tests cover both upgrade and downgrade.
- **group-thing-ai contract tests**: 51 passed (`test_photo_store`, `test_deploy_artifacts`, `test_moderation_cron`). They confirm that the grants SQL matches `REQUIRED_PRIVILEGES` and that the round-robin covers 3 subjects.
- **Alembic chain**: one head. `0054` revises `0053`, and no other revision claims `0053`.
- **Secrets**: none read or printed. Only variable names were listed from `.env.example`. The migration docstring, the SQL and the README hold no credentials (the SQL takes the password from `:'cron_password'` at run time).

## Category Breakdown
| Category | Score | Status |
|----------|-------|--------|
| Configuration | 85% | Pass with concern (`MODERATION_IMAGE_ENABLED` defaults to false in compose) |
| Monitoring | 75% | Pass with concern (sweep logs; no error tracker, which is a pre-existing project gap) |
| Resilience | 85% | Pass (put→lock→commit with file cleanup, status-predicated deletes, SKIP LOCKED sweep) |
| Performance | 85% | Pass (2-statement public read, batched sweep, partial indexes) |
| Security | 85% | Pass (EDIT matrix row + ownership check, files private until APPROVED, least-privilege cron grants) |
| Deployment | 75% | Concerns (uncommitted files, cross-repo ordering, password re-set, data-destroying rollback) |

## Blockers (Must Fix)
None in the code. The items under Deployment below are **deploy-time gates**: an operator must do each of them correctly. They are not code defects.

## Concerns (Should Fix / Gate Before Deploy)

### C1. All changes are uncommitted, including new modules the app imports at startup (deployment, warning, fixable)
- **Location**: group-thing-app has 8 untracked backend files and 5 untracked frontend files. The backend files are `app/organizations/media.py`, `alembic/versions/0054_organization_media.py` and the tests. The frontend files are `hooks/useOrganizationMedia.ts`, `GalleryBlock.tsx`, `PhotosTab.tsx` and their tests. The group-thing-ai changes are uncommitted as well.
- **Risk**: `app/main.py` imports `app.organizations.media.sweep_superseded_media`. If a commit or image build leaves out the untracked `media.py`, the backend fails at import and the whole API is down. If it leaves out `0054_organization_media.py`, the code runs against a missing table and every `/public/{slug}` and `/mine` call returns 500.
- **Fix**: Commit using the spec's "Suggested Commit Split", with `git add` on the untracked files. Before deploying, confirm `git status` is clean. The group-thing-ai commit goes separately and must not be deployed until step 2 below.

### C2. Cross-repo deploy order must be followed exactly (deployment, warning, not fixable in code)
- **Location**: spec "Deploy order"; group-thing-ai `README.md` ("Deploy order for organization photos"); `scripts/moderation_db_role.sql`.
- **Risk**: The three-subject cron runs a fail-fast `check_requirements()`. If it starts before the `organization_media` grants exist, it refuses to start, and **all** image moderation stops (products and avatars included).
- **Order** (verified as documented):
  1. Deploy the app. The compose `backend` command runs `alembic upgrade head` on start, so 0054 is applied automatically.
  2. Re-run the grants SQL as the DB owner.
  3. Deploy the cron.

  The code supports this order: the app tolerates a missing third subject (rows wait PENDING and admins can approve them manually), and the previous cron ignores the new table.
- **Mitigation**: Check off each step in the release checklist. After step 3, follow the README smoke step for org media and confirm exactly one `moderation_decisions` row with `ORGANIZATION_MEDIA`.

### C3. The grants re-run always resets the cron password (deployment/configuration, warning, fixable)
- **Location**: `group-thing-ai/scripts/moderation_db_role.sql` runs `ALTER ROLE gt_moderation_cron PASSWORD :'cron_password'` unconditionally.
- **Risk**: If step 2 is run with a value other than the one in `.env.cron`, the password changes under the running two-subject cron. Its new connections fail, and all moderation stops until `.env.cron` is updated and the cron restarted. This is documented in the README "Password warning" and the SQL header (audit M3).
- **Recommendation**: Pass the current password without displaying it, for example by having psql read it from a file. Optionally split the grants into a separate grants-only script, or make the `ALTER ROLE` conditional on a non-empty variable, so that adding grants never touches the password. That would be a small SQL change (`fixable: true`).

### C4. Rollback destroys data and needs a manual step with the new image (deployment, warning, not fixable)
- **Location**: spec "Rollback"; `0054_organization_media.py::downgrade` (drops `organization_media`); `docker-compose.yml` backend command `alembic upgrade head`.
- **Risk 1, crash loop**: If the previous image is redeployed while the DB is at 0054, its `alembic upgrade head` fails on the unknown revision, and the backend crash-loops. This is a full API outage.
- **Risk 2, data loss**: A correct rollback, with the cron stopped first and then `alembic downgrade 0053` run from the **new** image, permanently deletes every organization's logo, cover and gallery rows. It also leaves orphaned files under `organizations/` in Spaces.
- **Mitigation**:
  - Write the exact command into the release notes: `docker compose run --rm backend alembic downgrade 0053` with the new image, before switching images.
  - Take `pg_dump -t organization_media` before any downgrade.
  - Prefer fix-forward, because the feature is additive and old clients ignore the new fields.

### C5. `MODERATION_IMAGE_ENABLED` defaults to `false` in compose (configuration, warning, fixable)
- **Location**: `docker-compose.yml` sets `MODERATION_IMAGE_ENABLED: ${MODERATION_IMAGE_ENABLED:-false}`.
- **Risk**: If the production env does not set the variable to `true`, organization logos, covers and gallery photos are APPROVED and public immediately, without moderation. These images appear on a public, shareable page. The flag is pre-existing and shared with products and avatars, so production probably sets it already, but this was not verified.
- **Fix**: Run a presence-only check on VPS A, and do not print the value beyond true/false. For example: `docker compose exec -T backend sh -c '[ "$MODERATION_IMAGE_ENABLED" = "true" ] && echo on || echo off'`. The startup log line `MODERATION_IMAGE_ENABLED=%s` also shows it.

### C6. No error tracking; sweep failures are visible only in logs (monitoring, warning, not fixable here)
- **Location**: `app/main.py::_run_media_sweep`. The project has no Sentry or equivalent; this is a pre-existing gap, not introduced by this feature.
- **Risk**: If the sweep raises (DB error), APScheduler logs "Job raised an exception" at ERROR level and retries 15 minutes later. Nothing alerts anyone. Correctness of the public read does not depend on the sweep (R12): a failing sweep only leaves superseded rows and files behind longer.
- **Recommendation**: Accept for this release. Track adding error tracking at project level.

### C7. Reorder returns 409 when storage is unconfigured (resilience, info, fixable)
- **Location**: `app/organizations/media.py::reorder_gallery` raises `PHOTO_UPLOAD_DISABLED_MESSAGE` when `storage is None`.
- **Risk**: This deviates from spec R11 ("delete and reorder still work on rows"); it was found in G15. The impact is minimal: with no storage the owner sees no media at all, so there is nothing to reorder.
- **Fix**: Either update R11 to match the code, or return `[]`/URL-less rows. A documentation alignment is the cheapest option.

## Recommendations (Nice to Have)
1. **S3 I/O under locks in admin `decide`**:
   - **Where**: `app/moderation/service.py::decide`. For org media it now takes the organization row lock (`lock_parent`), then the media row lock, then calls `storage.set_public` twice before committing.
   - **Impact**: boto3 default timeouts are about 60 s each, with retries. A slow Spaces call therefore blocks that organization's owner writes for its duration. The scope is a single organization and admin actions are rare.
   - **Fix**: Consider explicit `connect_timeout`/`read_timeout` in the boto3 `Config` (`app/storage/service.py`). This is pre-existing and also applies to products and avatars.
2. **Upload abuse throttling**:
   - **Risk**: An owner with EDIT can upload repeatedly. Each upload decodes up to 50 Mpx in a worker thread and writes two S3 objects. Slot replacement and the gallery limit bound the stored data, but not the CPU and S3 cost.
   - **Fix**: No rate limiting exists anywhere in the app (pre-existing; product photos are the same). Consider a per-user upload limit, either in nginx or in the app.
3. **Orphaned large rendition on a failed thumb put**:
   - **Where**: `upload_media` stores both renditions before its `try`, so if the thumb `put` fails, the w1600 object is orphaned.
   - **Status**: Same pattern as products and avatars; listed in Known Limitations. Moving the second `put` inside the cleanup scope would close it.
4. **Deprecated `datetime.utcnow()`**: `media.py::_set_sort_orders` uses it, which raises DeprecationWarning on Python 3.12. It is used elsewhere in the codebase, so align it when the project migrates.
5. **Optional observability**: log the counts of org media uploads, deletes and takedowns at INFO, so the first days after release can be checked from the logs. The sweep already logs deleted counts when greater than 0, and the cron logs one line per image with kind `organization photo`.

## Checks Passed (summary)
- **Configuration**:
  - no new env vars;
  - the sweep interval is a code constant (15 min) and the batch size is 200;
  - storage `None` degrades to empty media on reads and 409 on upload, so the page still renders.
- **Monitoring**:
  - `/api/health` exists;
  - the sweep logs its deleted counts;
  - the cron log kinds now include `organization photo`;
  - no image bytes or secrets are logged.
- **Resilience**:
  - The upload does its S3 `put` before the organization lock. On any failure it rolls back and deletes the new keys.
  - Replace deletes are status-predicated and delete-by-id decides from `RETURNING status` (H2). Race tests pass.
  - The sweep uses `ORDER BY id … FOR UPDATE SKIP LOCKED`, so it cannot deadlock with owner or admin transactions. It is idempotent, and its scheduler has `coalesce=True` and `misfire_grace_time=None`.
  - Graceful shutdown is unchanged: `scheduler.shutdown(wait=False)`.
  - A DB-level partial unique index and the per-kind unique act as race backstops; `IntegrityError` maps to 409.
- **Performance**:
  - The public read is exactly 2 statements, or 1 without storage (tested).
  - `/mine` adds 1 statement.
  - The moderation list adds 1 count statement.
  - The claim index has the same shape as 0051.
  - Image processing runs in `asyncio.to_thread`.
  - Upload reads are capped at `MAX_UPLOAD_BYTES + 1`, and nginx sets `client_max_body_size 16m` on `/api/`.
- **Security**:
  - Mutations go through matrix row 50 (EDIT) plus a service-level ownership check (403).
  - The public payload contains URLs only.
  - Pending and rejected files stay private and are served to the owner through presigned URLs.
  - Cron grants are column-level SELECT/UPDATE on the 8 contract columns only.
  - `app.organizations` does not import `app.moderation.service` (gate test).
- **Deployment**:
  - The migration is small and reversible, with explicit names and operator notes in its docstring.
  - The change is backward compatible for clients: new response fields are additive and default, and the second `PublicOrganizationResponse` caller (the meta preview) is unchanged and tested.
  - The previous cron is unaffected by the new table.

## Next Steps
1. Commit everything, including the untracked files, in the spec's 4-commit split. Build the images from a clean tree (C1).
2. On VPS A, confirm `MODERATION_IMAGE_ENABLED` is `true` with a presence-only check (C5).
3. Take a DB backup, then deploy the app. Confirm in the startup logs that `alembic upgrade head` reached 0054 (C2 step 1).
4. Re-run `moderation_db_role.sql` with the **current** cron password, supplied without echoing it (C3, C2 step 2).
5. Deploy the three-subject cron. Run the README org-media smoke step (C2 step 3).
6. Record the rollback runbook: stop or roll back the cron, `pg_dump -t organization_media`, run `alembic downgrade 0053` with the new image, then redeploy the old image. Prefer fix-forward (C4).
7. Follow-ups: decide on C7 (spec or code); project-level error tracking (C6); boto3 timeouts and upload throttling (R1, R2).
