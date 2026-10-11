# Implementation Plan: D — Zdjęcia organizacji (logo, okładka, galeria)

## Overview
Total Steps: 84
Task Groups: 15 (14 implementation + 1 test review)
Expected Tests: ~70-80 new tests (backend ~38, group-thing-ai ~5, frontend ~32) plus up to 10 in the review group. This is above the usual 16-34 band because the feature spans two repos, 3 subjects of moderation, a concurrency-sensitive slot model and 4 UI surfaces; every group still stays within 2-8 tests.

Repos and paths:
- `group-thing-app` backend: `src/backend` (paths below are relative to repo root)
- `group-thing-app` frontend: `src/frontend`
- `group-thing-ai`: sibling repo `C:/Users/karas/Desktop/swaptime/group-thing-ai` (written as `../group-thing-ai/...`)

Commands:
- Backend tests: `cd src/backend && uv run pytest tests/<file>.py -q` (TestContainers Postgres; Docker must be running)
- mypy: `cd src/backend && uv run python -m mypy app` (baseline ~32 errors at HEAD; must not increase). ruff: `uv run ruff check app tests && uv run ruff format --check app tests`
- Frontend tests: `cd src/frontend && npx vitest run src/test/<file>`; type-check/lint per `package.json` scripts
- group-thing-ai tests: `cd ../group-thing-ai && uv run pytest tests/<file>.py -q`

**Secrets rule (applies to every group touching config, storage, scheduler, deploy or the grants SQL):** never print secret values. Do not run `env`, `printenv`, `docker compose exec <svc> env`, `docker inspect` (Env), or `cat .env` / `cat .env.cron`. Check configuration by presence only (e.g. `[ -n "$SPACES_KEY" ] && echo set || echo missing`). Never write secret values into code, tests, docs, reports, task folders or commits; use placeholders such as `:'cron_password'`.

## Implementation Steps

---

### Task Group 1: Image module relocation (R1)
**Dependencies:** None
**Files to Modify:** `src/backend/app/storage/images.py` (new, moved), `src/backend/app/product/images.py` (deleted), `src/backend/app/product/service.py`, `src/backend/app/product/router.py`, `src/backend/app/users/service.py`, `src/backend/app/users/router.py`, `.maister/docs/project/tech-stack.md`
**Estimated Steps:** 5

- [x] 1.0 Complete image module move
  - [x] 1.1 Identify the regression tests that cover the module (no new tests; this is a pure move per spec BE-1)
    - `tests/test_product_photos.py`, `tests/test_my_profile.py` (avatar upload paths), `tests/test_photo_moderation_gate.py`
    - Record their pass state at HEAD before moving
  - [x] 1.2 Move `app/product/images.py` → `app/storage/images.py` with `git mv`, content unchanged (`process_upload`, `ProcessedImage`, `MAX_UPLOAD_BYTES`, `INVALID_IMAGE_MESSAGE`, `TOO_LARGE_MESSAGE`)
    - No re-export shim left in `app/product/`
  - [x] 1.3 Update imports: `app/product/service.py`, `app/product/router.py` (l.25 `from .images import MAX_UPLOAD_BYTES` → `from app.storage.images import ...`), `app/users/service.py`, `app/users/router.py` (l.17); grep `tests/` and `app/` for `product.images` / `monkeypatch` string targets and update them
  - [x] 1.4 Update `.maister/docs/project/tech-stack.md` l.102 path reference to `app/storage/images.py`
  - [x] 1.5 Ensure regression tests pass
    - Run ONLY the tests listed in 1.1; run ruff and mypy (no new errors)

**Acceptance Criteria:**
- `app/product/images.py` no longer exists; `grep -rn "product.images" src/backend/app src/backend/tests` returns nothing
- Product photo and avatar tests listed in 1.1 pass unchanged
- mypy error count not above baseline

---

### Task Group 2: Model, migration 0054 and migration-number docs (R2, R3, R30)
**Dependencies:** None
**Files to Modify:** `src/backend/app/organizations/models.py`, `src/backend/alembic/versions/0054_organization_media.py` (new), `src/backend/tests/test_organization_media_migration.py` (new), `.maister/tasks/development/2026-10-08-organizer-directory-layouts-b/implementation/spec.md`, `.maister/tasks/development/2026-10-08-organizer-directory-layouts-b/implementation/implementation-plan.md`, `.maister/tasks/development/2026-10-08-organizer-directory-layouts-b/workflow-summary.md`, `.maister/tasks/development/2026-10-08-organizer-directory-layouts-b/verification/code-review-report.md`, `.maister/tasks/research/2026-10-07-organizer-page-layouts-theming/outputs/high-level-design.md`
**Estimated Steps:** 6

- [x] 2.0 Complete data layer
  - [x] 2.1 Write 4-5 focused tests in `tests/test_organization_media_migration.py` (template: `tests/test_organization_page_layout_migration.py`, `tests/test_photo_moderation_attempts_migration.py`)
    - `upgrade_createsTableWithConstraintsAndIndexes`: table, `pk_organization_media`, both FKs, `uq_organization_media_organization_id_kind_content_sha256`, `ix_organization_media_status`, `ix_organization_media_pending_created_at` (partial `status='PENDING'`), `uq_organization_media_one_pending_per_slot`
    - `cronColumns_matchProfileAvatars`: the 8 cron columns (`id`, `storage_key`, `content_sha256`, `status`, `moderation_attempts`, `moderation_retry_at`, `created_at`, `updated_at`) have identical names, types, nullability to `profile_avatars` (information_schema)
    - `partialUnique_secondPendingLogo_rejected` (IntegrityError) and `partialUnique_twoPendingGallery_allowed`
    - `downgrade_dropsTable` (downgrade to 0053 then upgrade head again)
  - [x] 2.2 Add `MediaKind` StrEnum (LOGO/COVER/GALLERY) and `OrganizationMedia(BaseEntity)` to `app/organizations/models.py`
    - Columns per R3 table via `_enum_column` (String(10) kind, String(20) status via `ModerationStatus`), `sort_order` default 0, `moderation_attempts` default 0, nullable `moderation_retry_at`
    - Plain FK columns `organization_id`, `uploaded_by_user_id`; no `relationship()`
    - `__table_args__`: `UniqueConstraint(organization_id, kind, content_sha256, name=...)`; comment that partial indexes are migration-only (as `ProductPhoto`)
    - Business-key `__eq__`/`__hash__` on `storage_key`; `large_key` / `thumb_key` properties
    - Docstring: cron column contract (0054, subject `ORGANIZATION_MEDIA`), private-until-APPROVED, gallery limit 3 in app layer, "newest APPROVED per LOGO/COVER slot is the public one"
    - Reuse: `ProfileAvatar` in `app/users/models.py:71-111`
  - [x] 2.3 Write `alembic/versions/0054_organization_media.py` (`revision="0054"`, `down_revision="0053"`), template `0051_profile_avatars.py`
    - UUID PK `gen_random_uuid()`; FKs without cascade; the 4 constraints/indexes exactly as R3; downgrade drops 3 indexes then the table
    - Docstring operator notes: re-run `scripts/moderation_db_role.sql` after upgrade (with the current cron password, never written into the file), stop cron before downgrade, downgrade orphans `organizations/` files, decisions logged with `ORGANIZATION_MEDIA`, the recorded deviations (no width/height, per-kind unique)
    - Secrets rule: no credentials or passwords in the migration or its docstring
  - [x] 2.4 Verify autogenerate drift: `uv run alembic check` (or `revision --autogenerate` dry-run) shows no diff between model and migration (partial indexes excepted, as for `ProductPhoto`)
  - [x] 2.5 R30 docs: in the files listed above replace "task C takes 0054" with "D takes 0054; C takes the next free number (0055+)" at the cited lines; mark W1-R2 (`transaction_per_migration`) resolved in `code-review-report.md` (cite `alembic/env.py:33,45`); in `high-level-design.md` record D deviations (per-kind unique, no width/height, gallery limit 3)
  - [x] 2.6 Ensure migration tests pass
    - Run ONLY `tests/test_organization_media_migration.py`; ruff + mypy on changed files

**Acceptance Criteria:**
- The 4-5 tests pass; `alembic upgrade head` / `downgrade 0053` round-trips cleanly
- Cron column parity with `profile_avatars` verified by test
- R30 doc notes updated in all 5 files

---

### Task Group 3: Media read models, schemas and public/owner reads (R9, R10, R11 reads)
**Dependencies:** 2
**Files to Modify:** `src/backend/app/organizations/media.py` (new), `src/backend/app/organizations/schemas.py`, `src/backend/app/organizations/router.py`, `src/backend/tests/test_organization_media_queries.py` (new), `src/backend/tests/test_public_preview.py` (only if an assertion must be added)
**Estimated Steps:** 6

- [x] 3.0 Complete read side
  - [x] 3.1 Write 5-6 focused tests in `tests/test_organization_media_queries.py` (rows inserted directly via Core/ORM helper `create_and_save_media(...)`, `FakeStorage`)
    - `publicRead_onlyApprovedNewestPerSlot_orderedGallery_cdnUrls`: older+newer APPROVED logo, PENDING cover, REJECTED gallery → newest logo, `cover=null`, approved gallery by `sort_order`, `cdn.test` URLs, no id/status in payload
    - `publicRead_statementCount_isTwo_forZeroAndFullMedia` via `count_queries` (0 media and logo+cover+3 gallery)
    - `publicRead_storageNone_returnsEmptyMedia_oneStatement`
    - `mine_listsPendingAndRejectedWithSignedUrls_excludesSuperseded`: superseded older APPROVED/REJECTED logo rows excluded, newer REJECTED rows included, gallery REJECTED included; APPROVED public URL, rest `origin.test` signed; ordering kind → sort_order → created_at
    - `mine_storageNone_returnsEmptyMedia`
    - `slugPreview_issuesNoMediaQuery` (H1): `/{slug}` HTML preview returns 200 and `count_queries` shows no `organization_media` statement; existing `tests/test_public_preview.py` stays green
  - [x] 3.2 Add schemas in `app/organizations/schemas.py`
    - `PublicMediaResponse { url, thumb_url }`; `OwnerMediaResponse { id, kind, status, url, thumb_url, sort_order }`; `MyOrganizationResponse(OrganizationResponse) { media: list[OwnerMediaResponse] }`; `ReorderOrganizationMediaRequest { media_ids: list[UUID] }`
    - `PublicOrganizationResponse` gains **defaulted** `logo: PublicMediaResponse | None = None`, `cover: ... = None`, `gallery: list[PublicMediaResponse] = []` (H1)
  - [x] 3.3 Create `app/organizations/media.py` read functions
    - `load_public_media(db, storage, organization_id)` → one `select` of APPROVED rows, assembled in Python (newest by (`created_at`, `id`) per LOGO/COVER; gallery by `sort_order`, `created_at`); URLs via `storage.public_url(large_key/thumb_key)`
    - `load_owner_media(db, storage, organization_id)` → one select of all rows, filter superseded per slot in Python per R10; URLs via the `avatar_response`/`photo_view` public-vs-presigned rule
    - `MAX_ORGANIZATION_GALLERY = 3` constant lives here
    - `app.organizations` must not import `app.moderation.service`
  - [x] 3.4 Router: add `Storage` dependency to `GET /public/{slug}`; fill media via `model_validate(org).model_copy(update=...)` (never set attributes on the ORM object); skip the media query when storage is `None`. `GET /mine` returns `MyOrganizationResponse` (+1 query); `POST /mine` and `PATCH /{id}` unchanged
    - Leave `app/system/router.py::public_organization_preview` unchanged (defaults keep it working)
  - [x] 3.5 Run mypy/ruff on `app/organizations`
  - [x] 3.6 Ensure read tests pass
    - Run ONLY `tests/test_organization_media_queries.py` and `tests/test_public_preview.py`, `tests/test_organizations.py` (existing `/mine` contract)

**Acceptance Criteria:**
- The 5-6 tests pass; public endpoint is exactly 2 statements regardless of media count, 1 when storage is `None`
- `/{slug}` preview unaffected (no media query, no 500)
- `/mine` response shape = `OrganizationResponse` + `media`

---

### Task Group 4: Upload with logo/cover slot and gallery semantics (R4, R5, R6, R13 a/e)
**Dependencies:** 1, 3
**Files to Modify:** `src/backend/app/organizations/media.py`, `src/backend/app/organizations/router.py`, `src/backend/tests/test_organization_media.py` (new)
**Estimated Steps:** 7

- [x] 4.0 Complete upload path
  - [x] 4.1 Write 7-8 focused tests in `tests/test_organization_media.py` (pattern `tests/test_product_photos.py`; monkeypatch `settings.moderation_image_enabled`)
    - `uploadGallery_moderationOn_returns201PendingPrivateFilesAppendedSortOrder`
    - `upload_invalidOrTooLarge_returns400_nothingStored`
    - `uploadGallery_sameFileTwice_returns409_butSameFileAsLogoAndGallery_returns201` (per-kind dedup)
    - `uploadGallery_fourthNonRejected_returns409_rejectedDoesNotCount`
    - `upload_storageNone_returns409WithUploadDisabledMessage`
    - `upload_nonOwnerEdit_403_unknownOrg_404_anonymous_401`
    - `uploadLogo_secondUploadReplacesPendingAndStagesKeys_approvedStaysPublic`; `uploadLogo_clearsRejected_reuploadRejectedSha_returns409`
    - `uploadLogo_moderationOff_approvedImmediately_olderApprovedDeletedWithOutbox`; `uploadLogo_supersededApprovedByCron_reuploadReturns201` (L2: simulate cron approval via Core UPDATE, no sweep)
    - (combine assertions to stay ≤ 8 test functions)
  - [x] 4.2 Implement `retire_older_slot_rows(db, organization_id, kind, than=(created_at, id))` in `media.py`
    - One Core `DELETE … WHERE organization_id=:o AND kind=:k AND status IN ('APPROVED','REJECTED') AND (created_at, id) < :than RETURNING storage_key`; never PENDING/NEEDS_REVIEW
    - One `OBJECTS_DELETE` outbox append with both renditions per returned key (pattern `app/product/service.py:223`); no append when nothing returned
  - [x] 4.3 Implement `upload_media(db, storage, principal, organization_id, kind, data)` following R4 order of operations
    - Ownership (`get_organization` + `get_own_organization`, `AccessDeniedException`) → storage `None` → 409 `PHOTO_UPLOAD_DISABLED_MESSAGE` (import the product constant) → `asyncio.to_thread(process_upload)` (`ValueError` → 400) → `storage.put(..., public=approved)` for both keys (`organizations/{org_id}/{media_id}`) before any lock → `SELECT organizations.id … FOR UPDATE` (Core, no ORM `Organization` load) → rules → commit
    - On any exception after put: rollback, `storage.delete` both keys, re-raise
    - Secrets rule: storage credentials come only from existing `get_storage()` config; never log or print them
  - [x] 4.4 Logo/cover rules (R5) under the lock, exact order: (0) retire with `than` = slot's newest APPROVED (if any) → (1) dedup any status → 409 LOGO/COVER Polish message → (2) status-predicated Core `DELETE … status IN ('PENDING','NEEDS_REVIEW','REJECTED') RETURNING storage_key` + outbox → (3) `db.add` + `flush` new row → (4) if APPROVED retire with flushed (`created_at`, `id`)
  - [x] 4.5 Gallery rules (R6): dedup → 409 `"To zdjęcie jest już w galerii."`; non-REJECTED count ≥ 3 → 409 `"Galeria może mieć najwyżej 3 zdjęcia."`; `sort_order` = max+1 or 0; REJECTED rows untouched
  - [x] 4.6 Route `POST /api/organizations/{organization_id}/media?kind=` (multipart `file`, `File()`, `file.read(MAX_UPLOAD_BYTES + 1)`, `Storage` dep) → 201 `OwnerMediaResponse`; pattern `app/product/router.py:130-150`
  - [x] 4.7 Ensure upload tests pass
    - Run ONLY `tests/test_organization_media.py`; ruff + mypy

**Acceptance Criteria:**
- The 7-8 tests pass
- No S3 I/O while the organization row lock is held; files cleaned up on failure
- Replace delete is a single status-predicated Core statement (never read-ids-then-delete)

---

### Task Group 5: Delete, reorder and authorization (R7, R8, R14, BE-9)
**Dependencies:** 4
**Files to Modify:** `src/backend/app/organizations/media.py`, `src/backend/app/organizations/router.py`, `src/backend/tests/test_organization_media.py`, `src/backend/tests/test_authorization_matrix.py`
**Estimated Steps:** 6

- [x] 5.0 Complete delete and reorder
  - [x] 5.1 Write 6-7 focused tests (append to `tests/test_organization_media.py`; matrix test in `tests/test_authorization_matrix.py`)
    - `deleteGallery_middle_renumbersDenselyAndStagesOutbox`
    - `deleteLogo_approvedWithOlderApproved_publicLogoNull_olderRowDeleted`
    - `delete_otherOrganizationsMedia_returns404`
    - `reorder_permutation_returns200InNewOrder`; `reorder_staleDuplicateOrRejectedId_returns409PolishMessage`
    - `raceH2_ownerDeletesPendingFlippedToApproved_retiresOlder_publicLogoNull` and `raceH2_replaceUpload_doesNotDeleteJustApprovedRow` (flip P to APPROVED with a Core UPDATE before the service call / via monkeypatched hook)
    - `authorizationMatrix_mediaPostPatchDelete_requireEdit_publicSlugStaysPublic`
  - [x] 5.2 Implement shared `_delete_media(db, organization_id, media_id)` in `media.py`
    - Core `DELETE … WHERE id=:id AND organization_id=:o RETURNING id, kind, status, created_at, storage_key`; none → `EntityNotFoundException` 404
    - Stage both keys via `OBJECTS_DELETE`
    - GALLERY: dense renumber of non-REJECTED rows (Core `UPDATE … SET sort_order, updated_at` by id, ordered by `sort_order`, `created_at`)
    - LOGO/COVER with **returned** status APPROVED → `retire_older_slot_rows` with returned (`created_at`, `id`)
  - [x] 5.3 `delete_media` (owner: ownership check + org lock + `_delete_media` + commit) and `delete_media_as_admin(db, media_id)` (Core scalar org-id lookup, org lock, `_delete_media`, commit; used by Group 7)
  - [x] 5.4 `reorder_gallery(db, storage, principal, organization_id, media_ids)`: org lock; set must equal non-REJECTED GALLERY ids exactly (length, duplicates, unknown, REJECTED) else 409 `"Kolejność się zmieniła. Odśwież i spróbuj ponownie."`; Core UPDATE `sort_order` = index, `updated_at`; return ordered `list[OwnerMediaResponse]`
  - [x] 5.5 Routes: `DELETE /{organization_id}/media/{media_id}` → 204; `PATCH /{organization_id}/media/order` → 200. Declare the `order` route so it does not collide with `{media_id}` routes. No matrix change (row 50 covers POST/PATCH/DELETE)
  - [x] 5.6 Ensure delete/reorder/authz tests pass
    - Run ONLY `tests/test_organization_media.py` and `tests/test_authorization_matrix.py`; ruff + mypy

**Acceptance Criteria:**
- The 6-7 tests pass including both H2 race simulations
- No delete decides on a status read in an earlier statement
- ORM rows never held across awaits; non-INSERT writes are Core

---

### Task Group 6: Superseded-media sweep job (R12)
**Dependencies:** 5
**Files to Modify:** `src/backend/app/organizations/media.py`, `src/backend/app/main.py`, `src/backend/tests/test_organization_media_sweep.py` (new)
**Estimated Steps:** 5

- [x] 6.0 Complete sweep
  - [x] 6.1 Write 3-4 focused tests in `tests/test_organization_media_sweep.py` (pattern `tests/test_term_end_scan.py`)
    - `sweep_deletesOlderApprovedAndRejectedLogoRows_stagesFiles_keepsPendingAndGalleryAndNewest`
    - `sweep_secondRun_isNoOp_noOutboxRow`
    - `sweep_coverAndLogoSlotsIndependent_perOrganization` (two orgs, two kinds)
    - `scheduler_registersMediaSweepJob` (interval 15 min, if `tests/test_term_end_scan.py` has an analogous registration test; else skip)
  - [x] 6.2 Implement `sweep_superseded_media(db)` in `media.py`: one Core `DELETE … WHERE id IN (SELECT id … WHERE kind IN (LOGO,COVER) AND status IN (APPROVED,REJECTED) AND EXISTS newer APPROVED in same (org, kind) ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED) RETURNING storage_key`; one outbox append (w1600 + w400 per key) when non-empty; commit; log count when > 0
  - [x] 6.3 `app/main.py`: `_MEDIA_SWEEP_INTERVAL_MINUTES = 15`, `_run_media_sweep()` opening `async_session_factory()`, second `add_job` on the existing `AsyncIOScheduler` (same misfire/coalesce defaults as the term-end job)
    - Secrets rule: no configuration dumps while verifying the scheduler; presence checks only
  - [x] 6.4 Run mypy/ruff
  - [x] 6.5 Ensure sweep tests pass
    - Run ONLY `tests/test_organization_media_sweep.py` and `tests/test_term_end_scan.py`

**Acceptance Criteria:**
- The 3-4 tests pass; sweep is idempotent, never touches GALLERY, PENDING/NEEDS_REVIEW or the newest APPROVED row
- Job registered every 15 minutes on the existing scheduler

---

### Task Group 7: Moderation subject map and org-media decide hook (R15, R16, R13 c/d)
**Dependencies:** 6
**Files to Modify:** `src/backend/app/moderation/service.py`, `src/backend/app/moderation/schemas.py`, `src/backend/app/moderation/models.py` (only if `ModerationSubjectType` lives there), `src/backend/app/moderation/router.py` (only if response mapping needs `media_kind`), `src/backend/app/organizations/media.py`, `src/backend/tests/test_organization_media_moderation.py` (new)
**Estimated Steps:** 7

- [x] 7.0 Complete moderation integration
  - [x] 7.1 Write 6-7 focused tests in `tests/test_organization_media_moderation.py`
    - `listPhotos_includesOrgMedia_withOrgNameMediaKind_totalIncludesIt`
    - `decideApproved_orgMediaLogo_flipsAclRecordsDecision_retiresOlderApproved`
    - `decideRejected_currentApprovedLogo_takedown_publicLogoNull_olderGone_stillNullAfterSweep`
    - `decide_afterCronStyleCoreUpdateBumpedUpdatedAt_succeedsNo409_usesLockedStatus` (M1)
    - `decideApproved_galleryRow_noRetire`
    - `deleteUpload_orgMediaId_routesToOrgMediaDelete`; unknown id → 404
  - [x] 7.2 Add `ModerationSubjectType.ORGANIZATION_MEDIA`; `ModerationDecisionRequest.subject_type` Literal gains it (`PRODUCT_TEXT` still rejected); `QueueEntry` gains `media_kind: MediaKind | None = None` as the **last** field; `ModerationQueueEntryResponse` gains `media_kind`
  - [x] 7.3 Introduce a module-level frozen descriptor map in `moderation/service.py` (PHOTO, AVATAR, ORGANIZATION_MEDIA) with exactly: `model`, `admin_delete`, `list_branch`, `count`, optional `lock_parent`, optional `after_decide`; PHOTO/AVATAR leave the optionals `None`
  - [x] 7.4 Rewire `_set_photo_files_public` (type widened), `list_photos` (third `union_all` branch joined to `organizations`, title = org name, `product_id` NULL, `media_kind` column NULL for others, third count), `decide` (model by subject type; `lock_parent` before `db.get(..., with_for_update=True)`; `previous_status` from locked row; `after_decide` before commit), `delete_upload` (probe three tables in map order)
  - [x] 7.5 In `app/organizations/media.py`: `lock_media_parent(db, media_id)` (Core scalar `select(OrganizationMedia.organization_id)` then org `FOR UPDATE`; no ORM entity load; none → 404) and `after_media_decide(db, row, previous_status, outcome)` (LOGO/COVER: retire on APPROVED, or on REJECTED with previous APPROVED; GALLERY no-op). No import of `app.moderation.service` from `app.organizations`
  - [x] 7.6 Run mypy/ruff
  - [x] 7.7 Ensure moderation tests pass
    - Run ONLY `tests/test_organization_media_moderation.py` plus the regression files `tests/test_moderation.py`, `tests/test_photo_moderation_queries.py`, `tests/test_photo_moderation_hardening.py` (PHOTO/AVATAR behaviour unchanged)

**Acceptance Criteria:**
- The 6-7 tests pass; existing PHOTO/AVATAR moderation tests remain green
- `/api/moderation/photos` query count: one page query + one count per subject (3) + decisions query
- Takedown guarantee holds after sweep

---

### Task Group 8: group-thing-ai cron third subject, grants and docs (R17, R18, R19)
**Dependencies:** None (column contract fixed by spec R3; deploy only after Group 2 is deployed, see R-Deploy)
**Files to Modify:** `../group-thing-ai/app/photo_store.py`, `../group-thing-ai/app/moderation_cron.py`, `../group-thing-ai/scripts/moderation_db_role.sql`, `../group-thing-ai/README.md`, `../group-thing-ai/tests/test_photo_store.py`, `../group-thing-ai/tests/test_deploy_artifacts.py`, `../group-thing-ai/tests/test_moderation_cron.py`
**Estimated Steps:** 6

- [x] 8.0 Complete cron contract
  - [x] 8.1 Write 4-5 focused tests (extend existing files)
    - `test_photo_store.py`: `SUBJECTS` has 3 entries in order photo, avatar, org media with table `organization_media`, type `ORGANIZATION_MEDIA`, label `organization photo`; column parity across all 3 tables
    - `test_photo_store.py`: `REQUIRED_PRIVILEGES` includes `organization_media` SELECT (8 cols) and UPDATE (4 cols)
    - `test_deploy_artifacts.py`: grants parsed from `moderation_db_role.sql` equal `REQUIRED_PRIVILEGES`
    - `test_moderation_cron.py`: `run_tick` alternates photo, avatar, org media within a batch (parametrize the existing 2-way case)
  - [x] 8.2 `app/photo_store.py`: add `ORGANIZATION_MEDIA = Subject(_moderated_table("organization_media"), "ORGANIZATION_MEDIA", "organization photo")`, export in `__all__`, append to `SUBJECTS`; verify `REQUIRED_PRIVILEGES` extends automatically; fix stale "two subjects" docstrings (module l.10-15, `ClaimedPhoto` ~l.182)
  - [x] 8.3 `app/moderation_cron.py` l.7-8 docstring: three subjects
  - [x] 8.4 `scripts/moderation_db_role.sql`: 8-column `GRANT SELECT` and `GRANT UPDATE (status, moderation_attempts, moderation_retry_at, updated_at)` on `public.organization_media`; header "run after app migration 0054"; decision comment lists `'ORGANIZATION_MEDIA'`
    - Secrets rule: keep the `:'cron_password'` psql variable; never write a real password into the script, README or tests; never `cat .env.cron`
  - [x] 8.5 README "Photo moderation cron" section (l.~20, 304-312, 321-322, 359, 405-418, 434, 457-459, 510-523): three subjects, 3-table round-robin, `MODERATION_CRON_BATCH` counts all three, log kinds gain "organization photo", deploy-order warning (R-Deploy), password warning (M3: pass the current password when re-running for grants; on rotation update `.env.cron` and restart immediately), smoke-test org-media step
  - [x] 8.6 Ensure cron tests pass
    - Run ONLY `tests/test_photo_store.py`, `tests/test_deploy_artifacts.py`, `tests/test_moderation_cron.py` in `../group-thing-ai`; run its ruff/mypy if configured

**Acceptance Criteria:**
- The 4-5 tests pass; grants SQL and `REQUIRED_PRIVILEGES` agree
- No secret values anywhere in the diff
- README documents deploy order and password warning

---

### Task Group 9: Frontend API types and hooks (R20, R21)
**Dependencies:** 3 (response shapes; Groups 4-5 only add endpoints already defined by spec R4/R7/R8)
**Files to Modify:** `src/frontend/src/api/organizations.ts`, `src/frontend/src/hooks/useMyOrganization.ts`, `src/frontend/src/hooks/useOrganizationMedia.ts` (new), `src/frontend/src/test/useOrganizationHooks.test.tsx`
**Estimated Steps:** 5

- [x] 9.0 Complete API and hooks
  - [x] 9.1 Write 5-6 focused tests in `src/test/useOrganizationHooks.test.tsx` (`createQueryWrapper()`, `vi.mock("../api/organizations")`, `vi.resetAllMocks()` in `beforeEach`)
    - `upload/remove/reorder` invalidate `[PUBLIC_ORGANIZATION_KEY]` and `[MY_ORGANIZATION_KEY]` on success **and** failure
    - server problem message rethrown verbatim; Polish fallback when none
    - `useMyOrganization({ pollPendingMedia: true })` polls (10 s, fake timers) while PENDING/NEEDS_REVIEW and stops when all approved
    - `useMyOrganization()` without the option never polls (L7)
    - M4: a poll that changes a status (PENDING → APPROVED, or a row disappearing) invalidates `[PUBLIC_ORGANIZATION_KEY]`; an unchanged poll does not
  - [x] 9.2 `api/organizations.ts`: `MediaKind`, `PublicMedia`, `OwnerMedia`, `MyOrganizationResponse`; `PublicOrganizationResponse` gains `logo`, `cover`, `gallery`; `getMyOrganization()` → `MyOrganizationResponse`; `uploadOrganizationMedia(orgId, kind, file)` (`api.upload` FormData `file`, query `kind`), `deleteOrganizationMedia(orgId, mediaId)`, `reorderOrganizationGallery(orgId, mediaIds)` (PATCH `{ media_ids }`)
  - [x] 9.3 `hooks/useMyOrganization.ts`: optional `{ pollPendingMedia?: boolean }`, `refetchInterval` function (pattern `useItemDetail.ts:24-53`); effect comparing previous/new `id → status` maps that invalidates the public key; keep `useMyOrganizationSlug` unaffected
  - [x] 9.4 New `hooks/useOrganizationMedia.ts`: `upload(kind, file)`, `remove(mediaId)`, `reorder(mediaIds)` following `useUpdateOrganization` (awaited invalidation on success and failure, `serverMessageOr` with the R21 fallbacks)
  - [x] 9.5 Ensure hook tests pass
    - Run ONLY `src/test/useOrganizationHooks.test.tsx` and `src/test/usePublicOrganization.test.tsx`; run `tsc --noEmit` (fix fixture types that now require `logo/cover/gallery`/`media`)

**Acceptance Criteria:**
- The 5-6 tests pass; type-check clean
- Polling runs only with the option on, invalidates the public query on status change
- Hooks follow `standards/frontend/data-fetching.md`

---

### Task Group 10: Public page blocks — hero media, gallery block, ghost (R22, R23, R24)
**Dependencies:** 9
**Files to Modify:** `src/frontend/src/pages/organizer/blocks/HeroBlock.tsx`, `src/frontend/src/pages/organizer/blocks/GalleryBlock.tsx` (new), `src/frontend/src/pages/organizer/blocks/GhostBlock.tsx`, `src/frontend/src/pages/organizer/layouts/types.ts`, `src/frontend/src/pages/organizer/layouts/registry.ts`, `src/frontend/src/pages/organizer/LayoutRenderer.tsx`, `src/frontend/src/index.css`, `src/frontend/src/test/organizerMediaBlocks.test.tsx` (new), `src/frontend/src/test/layoutPositions.test.ts`, `src/frontend/src/test/LayoutRenderer.test.tsx` (fixtures only if needed), `src/frontend/src/test/organizerKeyParity.test.ts` (only if it enumerates `BlockId`)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:hero-media
  locator: "Mockup 0: Hero with logo and cover", lines ~97-135
  acceptance: logo `thumb_url` replaces initials in cover (h-16), compact (h-14), centered (h-20), `rounded-full object-cover`, `alt=""`, initials on image error; cover `url` as absolute `object-cover` img only in `cover` variant; with a cover image name/address use `text-on-ink` and a ≥0.7-alpha scrim token stop (`--color-scrim-strong` or `from-ink/75`); without/after error keep `bg-primary` + `text-on-primary`; geometry unchanged; no hex in component
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:gallery-block
  locator: "Mockup 1: Gallery block", lines ~136-162
  acceptance: `<section aria-label="Galeria" class="px-6 pt-6">`, serif heading "Galeria", `<ul>` of `SafeImage`; 3 → grid-cols-3 square thumb, 2 → grid-cols-2 square thumb, 1 → full-width 4:3 `url`; alt "{name} — zdjęcie N z M"; tiles not interactive; hidden for visitors when empty
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-classic-media
  locator: "Mockup 2: CLASSIC", lines ~163-189
  acceptance: cover hero with logo; gallery directly after `about`, above upcoming terms
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-circles-media
  locator: "Mockup 3: CIRCLES", lines ~190-215
  acceptance: cover hero with logo; gallery after `about` (2-photo grid)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-schedule-media
  locator: "Mockup 4: SCHEDULE", lines ~216-240
  acceptance: compact hero with 56px logo, no cover image; gallery after `about`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-exchange-media
  locator: "Mockup 5: EXCHANGE", lines ~241-262
  acceptance: compact hero with logo; gallery after `about` (1-photo 4:3)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:layout-links-media
  locator: "Mockup 6: LINKS", lines ~263-284
  acceptance: centered hero with 80px logo; gallery after `about`, left-aligned heading
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:owner-media-empty
  locator: "Mockup 7: Empty media", lines ~285-325
  acceptance: visitor sees initials and no gallery section; owner sees the gallery ghost in the gallery position
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:ghost-gallery
  locator: "Mockup 7: Empty media", owner column, lines ~285-325
  acceptance: title "Galeria", body "Dodaj do 3 zdjęć — odwiedzający zobaczą je po sprawdzeniu. Widzisz to tylko Ty.", CTA "Dodaj zdjęcia →" to `?edit=1&tab=zdjecia` navigating with `replace`
**Estimated Steps:** 7

- [x] 10.0 Complete public blocks
  - [x] 10.1 Write 7-8 focused tests in `src/test/organizerMediaBlocks.test.tsx` (+ extend `layoutPositions.test.ts`)
    - Hero renders logo `img` in all 3 variants; initials after `fireEvent.error`
    - Cover img only in `cover` variant
    - M2: `cover` with image + SUN-like palette → name/address carry `text-on-ink` not `text-on-primary`; after cover error → `text-on-primary`
    - GalleryBlock 1/2/3 layouts and alt text "{name} — zdjęcie N z M"
    - LayoutRenderer: empty gallery hidden for visitor; owner sees ghost with CTA href `?edit=1&tab=zdjecia` without waiting for `directoryStatus === "ready"`
    - `layoutPositions.test.ts`: `gallery` directly after `about` in all 5 layouts
  - [x] 10.2 `index.css`: add a darker scrim role token (`--color-scrim-strong: rgb(20 28 24 / 0.75)`) and its Tailwind mapping if tokens are mapped there
  - [x] 10.3 `HeroBlock.tsx`: inner `HeroLogo` (thumb, error → initials) in all 3 variants; cover image layer in `cover` variant with error state; `text-on-ink` + strong scrim gradient when image shown; remove "cover has no image yet" comment
  - [x] 10.4 `layouts/types.ts` add `"gallery"` to `BlockId`; `layouts/registry.ts` insert `{ block: "gallery", variant: "grid" }` after `about` in CLASSIC, CIRCLES, SCHEDULE, EXCHANGE, LINKS
  - [x] 10.5 New `blocks/GalleryBlock.tsx` with `isGalleryEmpty(data)`; reuse `SafeImage` from `pages/product/ItemGallery.tsx`
  - [x] 10.6 `LayoutRenderer.tsx`: register `gallery: { Component: GalleryBlock, isEmpty: isGalleryEmpty }`; evaluate `isEmpty` for non-directory blocks regardless of `directoryStatus` (directory blocks unchanged). `GhostBlock.tsx`: `GHOST_COPY.gallery` + optional `replace` flag on the CTA used by the gallery CTA
  - [x] 10.7 Ensure block tests pass
    - Run ONLY `organizerMediaBlocks.test.tsx`, `layoutPositions.test.ts`, `LayoutRenderer.test.tsx`, `organizerBlocks.test.tsx`; `tsc --noEmit`

**Acceptance Criteria:**
- The 7-8 tests pass; existing block/renderer tests green
- Implementation matches every `acceptance` criterion in Visual References above
- Role tokens only, no hex in components

---

### Task Group 11: Shared photo UI props and the PhotosTab (R26, R27, R28)
**Dependencies:** 9
**Files to Modify:** `src/frontend/src/pages/product/ItemGalleryEditor.tsx`, `src/frontend/src/pages/organizer/editor/ColorsTab.tsx`, `src/frontend/src/pages/organizer/editor/PhotosTab.tsx` (new), `src/frontend/src/test/OrganizerPhotosTab.test.tsx` (new)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:photos-tab
  locator: "Mockup 8: Editor Zdjęcia tab, overview", lines ~326-388 (tab body)
  acceptance: intro "Zdjęcia zapisują się od razu."; sections Logo / Okładka / Galeria with `SECTION_LABEL` headings; per-section `aria-busy` and all section buttons disabled during call + refetch; per-section `role="alert"` line; Okładka note "Widoczna w układach Klasyczny i Grupy." plus "W wybranym układzie ({label}) okładka nie jest widoczna." when draft layout hero is not `cover`; calls `useMyOrganization({ pollPendingMedia: true })` while mounted
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:photo-slot
  locator: "Mockup 9: Logo / Okładka slot, all states", lines ~389-450
  acceptance: S1-S7 copy exactly per spec R26 table (logo round 48px thumb, cover 16:9 `w-20` thumb, "okładkę"/"okładka" variants); S2 "Wysyłanie…" without percentage; S5 approved row above divider then pending row; S6 every REJECTED row newest first with own "Usuń", single "+ Dodaj logo"; focus moves to add/change button after delete; buttons ≥44px with visible labels; no delete confirmation
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:gallery-editor
  locator: "Mockup 10: Galeria section, all states", lines ~451-501
  acceptance: G1-G6; counter `N/3` counting non-REJECTED; ordered rows "Zdjęcie N" + "W weryfikacji" badge for PENDING/NEEDS_REVIEW; ˄/˅/trash `h-11 w-11`, ˄ disabled first, ˅ disabled last; REJECTED rows after divider with note + trash only; "+ Dodaj zdjęcie" single picker disabled at 3/3 with "Osiągnięto limit 3 zdjęć."; hint "JPG, PNG lub WebP, do 15 MB." and "Odwiedzający zobaczą zdjęcia po sprawdzeniu."; SR labels "Przesuń zdjęcie N w górę/w dół", "Usuń zdjęcie N", "Usuń odrzucone zdjęcie"; focus returns to moved photo's button; server errors verbatim
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:media-status-badge
  locator: "Mockup 11: Status badge copy", lines ~502-517
  acceptance: `ModerationBadge` optional `labels` prop; org map PENDING/NEEDS_REVIEW → "W weryfikacji", REJECTED → "Odrzucone"; APPROVED no badge; default product labels unchanged
**Estimated Steps:** 7

- [x] 11.0 Complete PhotosTab
  - [x] 11.1 Write 7-8 focused tests in `src/test/OrganizerPhotosTab.test.tsx` (mock `../api/organizations`, `createQueryWrapper()`)
    - S3 copy (pending first upload: badge, note, "Zmień logo", "Anuluj")
    - S5 copy (approved + pending rows with divider)
    - S6 two REJECTED rows listed newest first, each "Usuń", one "+ Dodaj logo"
    - Upload calls `uploadOrganizationMedia` with kind; invalid file shows `photoFileError` text and no API call
    - Gallery 3/3 disables add with limit hint; a REJECTED row is not counted and has no move buttons
    - Move down sends the full non-REJECTED id list; focus lands on the moved row's button
    - Server 409 message shown verbatim in the section's `role="alert"`
    - Cover layout note appears for a non-`cover` hero layout key
  - [x] 11.2 `ItemGalleryEditor.tsx`: `ModerationBadge` optional `labels` (default = current product map); `PhotoFileField` optional `label` (default "+ Dodaj zdjęcia") and `multiple` (default `true`); export what PhotosTab needs. `ColorsTab.tsx`: export `SECTION_LABEL`
  - [x] 11.3 `PhotosTab.tsx` shell: props `organizationId`, `media`, draft layout key; intro; three sections each with own busy + alert state; `useOrganizationMedia` actions; layout-label lookup from `layouts/registry.ts`
  - [x] 11.4 Inner `PhotoSlot` (LOGO, COVER) implementing S1-S7; derive rows from `media` per R10 (approved, pending, rejected newest first); focus management after delete
  - [x] 11.5 Inner `GallerySection` implementing G1-G6; copy row markup (~40 lines) from `ItemGalleryEditor` rather than parametrizing it; `MAX_ORGANIZATION_GALLERY = 3`; client checks via `itemPageShared.ts` (`ACCEPTED_PHOTO_TYPES`, `MAX_PHOTO_BYTES`, `photoFileError`)
  - [x] 11.6 Confirm product editor unchanged: run `src/test` product gallery editor tests (those importing `ItemGalleryEditor`)
  - [x] 11.7 Ensure PhotosTab tests pass
    - Run ONLY `OrganizerPhotosTab.test.tsx` and the product gallery editor tests from 11.6; `tsc --noEmit`

**Acceptance Criteria:**
- The 7-8 tests pass; product photo editor tests unchanged and green
- Implementation matches every `acceptance` criterion in Visual References above
- All buttons ≥44px, visible labels, `role="alert"` and `aria-busy` per section

---

### Task Group 12: EditorSheet third tab and PublicOrganizationPage wiring (R25, R25a)
**Dependencies:** 10, 11
**Files to Modify:** `src/frontend/src/pages/organizer/editor/EditorSheet.tsx`, `src/frontend/src/pages/organizer/PublicOrganizationPage.tsx`, `src/frontend/src/test/OrganizerEditor.test.tsx`, `src/frontend/src/test/PublicOrganizationPage.test.tsx` (fixtures only if needed)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:editor-photos-tab
  locator: "Mockup 8: Editor Zdjęcia tab, overview", lines ~326-388 (sheet chrome, pills, footer)
  acceptance: third pill "Zdjęcia" after Układ/Kolory with roving focus over 3 pills; tab follows `?tab=` (zdjecia/kolory/uklad, unknown → uklad) at mount and on change; pill click writes `tab` with `replace`; PhotosTab rendered outside `<fieldset disabled={saving}>`; photo actions never set `dirty`, never trigger `useBlocker`/`UnsavedChangesDialog`; Zapisz/Anuluj footer unchanged; closing removes both `edit` and `tab`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:ghost-gallery
  locator: "Mockup 7: Empty media", owner column, lines ~285-325 (CTA behaviour with sheet open)
  acceptance: clicking the ghost CTA while the sheet is open on another tab switches it to Zdjęcia
**Estimated Steps:** 5

- [x] 12.0 Complete editor wiring
  - [x] 12.1 Write 4-5 focused tests (extend `src/test/OrganizerEditor.test.tsx`)
    - `?edit=1&tab=zdjecia` opens on the Zdjęcia tab; unknown tab → Układ
    - M5: sheet open on Układ, clicking the gallery ghost CTA switches to Zdjęcia
    - Closing the editor removes both `edit` and `tab` params
    - Upload from the Zdjęcia tab calls the API and leaves Zapisz disabled (draft not dirty, no unsaved-changes dialog on close)
    - Arrow-key roving focus covers 3 pills
  - [x] 12.2 `EditorSheet.tsx`: `Tab` union + `TABS` entry + `tabRefs` key; sync with `useSearchParams` (`tab` param effect; pill click writes param with `replace`); new props `organizationId`, `media`; render `PhotosTab` outside the draft fieldset, passing the draft layout key
  - [x] 12.3 `PublicOrganizationPage.tsx`: `closeEditor` deletes `tab` with `edit`; pass `organizationId={owner.id}` and `media={owner.media}` (superseded in verification I7c: only `organizationId`; PhotosTab reads media from the hook)
  - [x] 12.4 Run `tsc --noEmit` and lint
  - [x] 12.5 Ensure editor tests pass
    - Run ONLY `OrganizerEditor.test.tsx`, `PublicOrganizationPage.test.tsx`, `OrganizationPage.test.tsx`

**Acceptance Criteria:**
- The 4-5 tests pass; existing editor tests green
- Implementation matches every `acceptance` criterion in Visual References above

---

### Task Group 13: Admin moderation card for organization media (R29)
**Dependencies:** None (contract fixed by spec R15/R29; backend Group 7 implements it)
**Files to Modify:** `src/frontend/src/api/moderation.ts`, `src/frontend/src/components/moderation/PhotoModerationCard.tsx`, `src/frontend/src/test/PhotoModerationPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:admin-moderation-org-media
  locator: "Mockup 12: Admin moderation card", lines ~518-543 (page/queue context)
  acceptance: org media entries appear in the existing photo moderation page with the same card layout and approve/reject/delete actions; English admin copy
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:moderation-card-org
  locator: "Mockup 12: Admin moderation card", lines ~518-543 (card title)
  acceptance: title map PHOTO → `{product_name}`, AVATAR → `Avatar · {product_name}`, ORGANIZATION_MEDIA → `Organization · {product_name} · {Logo|Cover|Gallery}`
**Estimated Steps:** 4

- [x] 13.0 Complete admin card
  - [x] 13.1 Write 2-3 focused tests (extend `src/test/PhotoModerationPage.test.tsx`)
    - Org media card title "Organization · X · Logo" (and Gallery variant)
    - Decide posts `subject_type: "ORGANIZATION_MEDIA"`
    - Existing PHOTO/AVATAR titles unchanged
  - [x] 13.2 `api/moderation.ts`: `ModerationSubjectType` adds `"ORGANIZATION_MEDIA"`; `ModerationQueueEntry` adds `media_kind: "LOGO" | "COVER" | "GALLERY" | null`
  - [x] 13.3 `PhotoModerationCard.tsx`: replace the title ternary with a subject → title map
  - [x] 13.4 Ensure admin tests pass
    - Run ONLY `PhotoModerationPage.test.tsx`; `tsc --noEmit` (update fixtures with `media_kind: null`)

**Acceptance Criteria:**
- The 2-3 tests pass
- Implementation matches every `acceptance` criterion in Visual References above

---

### Task Group 14: Backend quality gates (mypy/ruff regression sweep and full backend feature run)
**Dependencies:** 7
**Files to Modify:** `src/backend/app/organizations/*.py`, `src/backend/app/moderation/*.py`, `src/backend/app/main.py` (fix-ups only)
**Estimated Steps:** 4

- [x] 14.0 Close backend gates
  - [x] 14.1 Write 2 focused tests: `organizationsModule_doesNotImportModerationService` (import-graph check via `importlib`/AST on `app/organizations/media.py`) and `publicOrganizationResponse_modelValidateOrm_defaultsMedia` (H1 schema default unit check)
  - [x] 14.2 Run `uv run python -m mypy app` and compare to baseline (~32); fix any new errors in files touched by Groups 1-7
  - [x] 14.3 Run `uv run ruff check app tests` and `ruff format --check`; fix
  - [x] 14.4 Ensure feature backend tests pass together
    - Run ONLY the new/affected files: `test_organization_media_migration.py`, `test_organization_media_queries.py`, `test_organization_media.py`, `test_organization_media_sweep.py`, `test_organization_media_moderation.py`, `test_authorization_matrix.py`, `test_public_preview.py`, `test_moderation.py`, `test_product_photos.py`, `test_my_profile.py`, plus the 2 tests from 14.1

**Acceptance Criteria:**
- mypy count ≤ baseline; ruff clean
- All backend feature tests pass in one run

---

### Task Group 15: Test Review & Gap Analysis
**Dependencies:** All previous groups (1-14)
**Files to Modify:** `src/backend/tests/test_organization_media*.py`, `src/frontend/src/test/organizerMediaBlocks.test.tsx`, `src/frontend/src/test/OrganizerPhotosTab.test.tsx`, `src/frontend/src/test/OrganizerEditor.test.tsx`, `../group-thing-ai/tests/test_photo_store.py`

- [x] 15.0 Review and fill critical gaps
  - [x] 15.1 Review tests from Groups 1-14 (~70 tests) against spec Success Criteria 1-10 and Audit Resolutions H1-L11
  - [x] 15.2 Analyze gaps for THIS feature only — likely candidates: `NEEDS_REVIEW` treated like PENDING in slot replace and polling; upload `IntegrityError` race backstop → 409; reorder when storage is `None`; delete with storage `None` still stages outbox; cover-only S1-S6 copy ("okładkę"/"okładka"); hero `centered` logo error fallback; admin delete of APPROVED logo retires older rows
  - [x] 15.3 Write up to 10 additional strategic tests for the highest-risk gaps
  - [x] 15.4 Run feature-specific tests only (backend files from 14.4, frontend files from Groups 9-13, group-thing-ai files from Group 8); frontend `tsc --noEmit` and lint

**Acceptance Criteria:**
- All feature tests pass (~80-90 total across both repos)
- No more than 10 additional tests added
- Every spec Success Criterion maps to at least one passing test

## Execution Order

Dependency graph:
```
G1 ─────────────┐
G2 ── G3 ──┬── G4 ── G5 ── G6 ── G7 ── G14 ──┐
           │   (G4 also needs G1)            │
           └── G9 ──┬── G10 ──┐              │
                    └── G11 ──┴── G12 ───────┤
G8 (group-thing-ai) ─────────────────────────┤
G13 (admin FE) ──────────────────────────────┴── G15
```

Parallel waves:
1. Wave 1: G1 Image move (5), G2 Model + migration + docs (6), G8 group-thing-ai (6), G13 Admin card (4)
2. Wave 2: G3 Read models (6, depends on 2)
3. Wave 3: G4 Upload (7, depends on 1, 3), G9 FE API + hooks (5, depends on 3)
4. Wave 4: G5 Delete/reorder/authz (6, depends on 4), G10 Public blocks (7, depends on 9), G11 PhotosTab (7, depends on 9)
5. Wave 5: G6 Sweep (5, depends on 5), G12 EditorSheet wiring (5, depends on 10, 11)
6. Wave 6: G7 Moderation subject map (7, depends on 6)
7. Wave 7: G14 Backend quality gates (4, depends on 7)
8. Wave 8: G15 Test review (4, depends on all)

Serialization notes: G3→G4→G5→G6→G7 all touch `app/organizations/media.py` (and G3-G5 `router.py`), so the backend chain is strictly sequential. G10 and G11 touch disjoint files. G9 and G12/G11 share no files. G13 touches only admin files.

Suggested commits (spec): 1) G1; 2) G2-G7 + G14 (backend + R30 docs); 3) G9-G13 (frontend); 4) G8 (group-thing-ai — merge/deploy only after backend is deployed and the grants SQL re-run with the current cron password, R-Deploy).

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- global/ — minimal-implementation (no mixin, no generic media service, no width/height, constant sweep interval, copied row markup), error-handling and validation (typed exceptions, Polish messages, server-side checks), conventions, coding-style, commenting
- backend/ — models.md (BaseEntity UUID PK per 0051, string enums, business-key equality, no `relationship()`), migrations.md (one reversible migration, explicit names, operator docstring), queries.md + jooq.md (bound params, constant statement counts, Core DELETE … RETURNING, enforced LIMIT in sweep), security.md (matrix row 50 EDIT + service ownership check), api.md (nested plural `media`, 201/204/200)
- frontend/ — data-fetching.md (hooks in `src/hooks`, awaited prefix invalidation, verbatim messages, `refetchInterval`), components.md, css.md (role tokens only), accessibility.md (44px targets, `role="alert"`, `aria-busy`, alt rules, roving tabs), responsive.md (mobile-first 430px column)
- testing/ — backend-testing.md (integration-first, TestContainers Postgres, `test_action_condition_expectedResult`), frontend-testing.md (`src/test/`, `vi.mock`, `vi.resetAllMocks`, `createQueryWrapper()`)
- Project rule: Secrets — never print env/.env/.env.cron values; presence checks only (repeated in Groups 4, 6, 8)

## Notes

- Test-Driven: Each group starts with 2-8 tests (Group 1 is a pure move and relies on existing regression tests per spec BE-1)
- Run Incrementally: Only the new and directly affected tests after each group
- Mark Progress: Check off steps as completed
- Reuse First: `process_upload`, `FakeStorage`, `count_queries`, outbox `OBJECTS_DELETE`, `ProfileAvatar`/0051 template, product photo service patterns, `SafeImage`, `ModerationBadge`, `PhotoFileField`, `photoFileError`, `useItemDetail` polling, `useUpdateOrganization`
- Concurrency invariants to preserve: org row lock first; no S3 I/O under the lock; status-predicated or RETURNING-based deletes only; Core scalar lookup before admin decide lock
- Standards evolution to suggest to the user: `models.md`/`migrations.md` still describe explicit-sequence PKs although every table since 0041 uses UUID PKs
