# Codebase Analysis Report

**Date**: 2026-10-10
**Task**: Organizer photos (task D): organization_media (LOGO / COVER / GALLERY)
**Description**: organization_media table (LOGO/COVER/GALLERY), upload/delete/reorder routes, authorization, moderation pipeline integration including the sibling repo `C:/Users/karas/Desktop/swaptime/group-thing-ai` cron, hero logo/cover and a gallery block on the public organizer page, owner editor UI ("Zdjęcia" tab).
**Analyzer**: codebase-analyzer skill (4 Explore agents: File Discovery, Code Analysis, Context Discovery, Pattern Mining)
**Research reference**: `analysis/research-context/research-report.md` §10.3 (l.587), task table l.857-858

---

## Summary

None of task D exists on disk yet, and neither does task C. Every building block it needs is already there. Two templates fit: avatars (`ProfileAvatar`, migration 0051) for single-slot replace semantics and the cron column contract, and product photos (`ProductPhoto`) for an ordered, limited gallery with dedup, renumbering, full-permutation reorder and owner-vs-visitor visibility. The authorization matrix already covers `POST|PATCH|DELETE /api/organizations(/.*)?` for EDIT (research P3 already fixed). `PUT` is not covered, so reorder must be `PATCH` or the matrix needs a new row.

The hardest parts are cross-cutting:
- a third moderation subject, both in the app (hard-coded PHOTO/AVATAR dispatch) and in the sibling cron repo (SUBJECTS, DB-role grants, deploy-artifact tests);
- the "last approved logo/cover stays public until a new one is approved" rule, which needs several rows per slot and a read-time selection;
- keeping the public organizer page within its statement budget and away from the organizations optimistic lock.

---

## Files Identified

Paths are relative to `src/backend/` (backend), `src/frontend/src/` (frontend) or the sibling repo `group-thing-ai/`. Line counts are given where verified.

### Primary Files (to modify or create)

**app/organizations/models.py** (141 lines)
- Organization model with an `updated_at` version_id_col (optimistic locking).
- New `OrganizationMedia` model plus a `MediaKind` StrEnum go here. Keep media in a separate table so uploads never bump `organizations.updated_at`.

**app/organizations/service.py** (200 lines)
- Ownership checks: `get_own_organization`, `update_organization` l.152-173 (AccessDeniedException).
- New functions: add/delete/reorder media and the public/owner media views.

**app/organizations/router.py** (72 lines)
- Already uses EditPrincipal/ReadPrincipal. `get_public_organization` l.31-39 does a plain `model_validate` and needs a Storage dependency to build URLs.

**app/organizations/schemas.py** (91 lines)
- `PublicOrganizationResponse` l.31-50 should embed `logo`, `cover` and `gallery[]`. The owner response adds status, id and sort_order.

**alembic/versions/0054_organization_media.py** (new)
- Latest revision is 0053. The number collides with task C (see open questions).
- Template: `0051_profile_avatars.py` (cron column contract, status index, partial claim index `(created_at,id) WHERE status='PENDING'`, operator notes in the docstring).

**app/moderation/models.py / service.py** (297 lines) **/ schemas.py / router.py**
- Add `ModerationSubjectType.ORGANIZATION_MEDIA`. The column is non-native `String(20)`, so no migration is needed.
- service.py has hard-coded subject dispatch that must be extended or turned into a map:
  - `_set_photo_files_public` union (l.73)
  - `list_photos` union_all plus counts (l.151-187)
  - `decide` model ternary (l.267)
  - `delete_upload` if/else (l.291-297)
- `schemas.py:37` has `Literal[PHOTO, AVATAR]`.

**app/core/authorization_matrix.py** (263 lines)
- Row 50 (l.191-195) covers `POST, PATCH, DELETE ^/api/organizations(/.*)?$` → EDIT, mcp:edit. Row 48 makes only `^/api/organizations/public/[^/]+$` PUBLIC. Row 49 maps GET → READ.
- No change is needed if reorder uses PATCH and public media is embedded in the existing public response.

**group-thing-ai/app/photo_store.py**
- `_moderated_table` l.79-93 (8 columns), `Subjects` l.112-115, `SUBJECTS`, and the derived `REQUIRED_PRIVILEGES`.
- Add an `organization_media` subject. Keys are hard-coded to `/w1600.webp` and `/w400.webp` in ClaimedPhoto, so the new table must use the same suffix convention.

**group-thing-ai/scripts/moderation_db_role.sql**
- Column-level SELECT (8 columns) plus UPDATE (`status`, `moderation_attempts`, `moderation_retry_at`, `updated_at`) grants on the new table for `gt_moderation_cron`.

**Frontend: api/organizations.ts, hooks (useMyOrganization / usePublicOrganization / useUpdateOrganization), layouts/types.ts (BlockId + "gallery"), LayoutRenderer, registry.ts, HeroBlock.tsx, new GalleryBlock.tsx, EditorSheet.tsx (Tab union / TABS / tabRefs, l.11-13, 48, 132-180)**
- Media API functions, embedded media fields, logo/cover rendering in the hero, a new gallery block, and a new "Zdjęcia" tab.

**Admin frontend: api/moderation.ts:5, components/moderation/PhotoModerationCard.tsx:37, pages/PhotoModerationPage.tsx:65**
- The subject type union, and a title ternary that currently infers "avatar" from `product_id == null`. It needs a real discriminator.

### Related Files (templates and supporting)

**app/users/models.py:71-111** (ProfileAvatar)
- large_key/thumb_key derivation, `__eq__` on storage_key.

**app/users/service.py** (361 lines)
- `avatar_response` l.139 (public_url when APPROVED, otherwise presigned)
- `_stage_avatar_files_delete` l.146 (outbox OBJECTS_DELETE)
- `set_my_avatar` l.152-195: deletes the previous row (l.183-188). This is a first-upload race anti-pattern.
- `delete_avatar_as_admin` l.198, `remove_my_avatar` l.207

**app/users/router.py:84-101**
- Upload route pattern: Storage dep, `File()`, `read(MAX+1)`.

**app/product/models.py:62-110** (ProductPhoto)
- width, height, uploaded_by_user_id, sort_order, `UNIQUE(product_id, content_sha256)`.

**app/product/service.py** (546 lines)
- `MAX_PRODUCT_PHOTOS=10` (l.86)
- `add_product_photo` ~l.412-470: storage None → 409, duplicate → 409, limit → 409, `_lock_product` FOR UPDATE
- `PhotoView` / `visible_photo_views` l.355-393, `_renumber` l.395, `_delete_photo` l.489-500
- reorder ~l.503 (stale → 409)

**app/product/router.py:125-185**
- Photo routes. Products use `PUT /photos/order`; organizations must use PATCH (see matrix above).

**app/product/images.py** (70 lines)
- `process_upload` → ProcessedImage(large, thumb, width, height, sha256)
- Limits: 15 MB, 50 Mpx, JPEG/PNG/WEBP, outputs 1600/400 webp at q80, EXIF stripped
- Polish ValueError messages, returned as 400
- Already imported by `app/users`. Candidate to move to `app/storage/images.py`.

**app/storage/service.py**
- ObjectStorage protocol (put(public=), get, delete, set_public, public_url, presigned_url). `get_storage()` returns None when unconfigured.

**app/storage/outbox_listener.py** (registered at main.py:98)
- OBJECTS_DELETE, used for deferred file deletion.

**app/moderation/status.py**
- PENDING | APPROVED | NEEDS_REVIEW | REJECTED. An admin can approve or reject from any status (takedown).

**app/system/public_preview.py, app/system/router.py:110-125**
- Organizer OG preview: title/description, `twitter:card summary`. An `og:image` from the cover/logo is optional scope.

**app/groups/infrastructure/organizations_acl.py**
- The only way the groups bounded context reaches organizations. No impact expected.

**group-thing-ai/app/moderation_cron.py**
- `run_tick` round-robins N subjects (l.140-165).
- Claims with `SELECT … FOR UPDATE SKIP LOCKED` ordered by created_at, id. Finalize is guarded by status/attempts. Every write sets `updated_at`.

**Frontend templates**
- `pages/product/ItemGallery.tsx`: SafeImage, no-referrer, lazy loading.
- `pages/product/ItemGalleryEditor.tsx`: ModerationBadge with hard-coded "W moderacji", ItemPhotoStrip, PhotoFileField, up/down move buttons.
- `useItemDetail.ts` l.24-53: polls every 10 s while PENDING.
- `itemPageShared.ts`: ACCEPTED_PHOTO_TYPES, MAX_PHOTO_BYTES, photoFileError.
- `api/client.ts:101`: `api.upload(FormData)`.
- `api/people.ts:46-55`, `api/products.ts` ~l.111.
- Panel avatar UX: `PanelDataContext.tsx:1374`, `ProfilView.tsx` AVATAR_STATUS_NOTE.
- `PublicOrganizationPage.tsx`; GhostBlock GHOST_COPY.

**Config and infra (no change expected)**
- Settings: `spaces_*`, `photo_storage_configured`, `moderation_image_enabled` (default false in compose), `moderation_text_enabled`.
- pyproject already includes python-multipart, boto3 and pillow.
- nginx sets `client_max_body_size 16m` on /api/.
- Compose has `moderation-cron` in the shield profile. Alembic env.py already sets `transaction_per_migration=True`.

---

## Current Functionality

- **Organizations** have no images today. HeroBlock (cover/centered/compact variants) renders initials on the primary color, with a code note that the cover has no image yet. `get_public_organization` returns a plain model with no storage access.
- **Avatars** are single-slot. A new upload deletes the previous row and stages file deletion through the outbox. They are served only on the owner endpoint `/api/people/me`, so no public avatar read path exists.
- **Product photos** are an ordered gallery of up to 10:
  - owners see non-rejected photos with their status (presigned URLs);
  - visitors see only APPROVED photos (public CDN URLs);
  - reorder takes a full id permutation, and a stale list returns 409;
  - delete renumbers the rest.
- **Moderation cron** (sibling repo) claims PENDING rows per subject, classifies the images, then flips `status` and the object ACL (`set_public`) on that row only. It has **no hook to retire a previously approved image**. It reads only the 8 granted columns and refuses to start (`check_requirements()`) if grants are missing, so rows stay PENDING and the pipeline fails closed.

### Key Components/Functions

- **process_upload** (product/images.py): normalizes uploads into 1600/400 webp.
- **ObjectStorage / get_storage**: S3 (Spaces) abstraction. `None` means "uploads temporarily unavailable" (409).
- **visible_photo_views**: the owner-vs-visitor visibility rule to mirror.
- **_renumber / reorder**: gallery ordering semantics.
- **OBJECTS_DELETE outbox**: transactional deferred file deletion.
- **photo_store.Subjects / SUBJECTS / REQUIRED_PRIVILEGES**: cron subject registry plus the grant contract that the deploy tests check.

### Data Flow

Proposed flow for task D:

1. The owner sends a multipart upload to `POST /api/organizations/me/media?kind=…`. The authorization matrix (row 50) requires EDIT.
2. The service checks ownership, locks the parent with `SELECT organizations … FOR UPDATE` (no version bump), runs `process_upload`, applies dedup and limit checks, and does `storage.put(public=False)` for both renditions.
3. It inserts an `organization_media` row with status PENDING, or APPROVED when moderation is disabled (as for avatars and products), and commits.
4. The cron claims the row, classifies it, and sets APPROVED (plus `set_public`), NEEDS_REVIEW or REJECTED.
5. Admins see the row in the PhotoModerationPage queue and can approve, reject or delete it.
6. The public read (`GET /api/organizations/public/{slug}`) embeds:
   - the newest APPROVED LOGO and COVER (public URLs);
   - APPROVED GALLERY items ordered by sort_order.
7. The owner read embeds the same plus the newest non-approved item per slot, with status and presigned URLs.

---

## Dependencies

### Imports (What the New Code Depends On)

- `app.storage.service` (ObjectStorage, get_storage): file I/O and URLs
- `app.product.images` (or a relocated `app.storage.images`): image processing
- `app.moderation.status` / `models`: status enum and subject type
- `app.storage.outbox_listener` / outbox: OBJECTS_DELETE staging
- `app.core.config` settings: `moderation_image_enabled`, `photo_storage_configured`
- `app.organizations.service.get_own_organization`: ownership
- Users FK (`uploaded_by_user_id`)

### Consumers (What Will Depend On This)

- **app/organizations/router.py**: media routes and the public/owner responses
- **app/moderation/service.py, schemas.py**: admin queue, decide, delete, ACL flips
- **group-thing-ai photo_store / moderation_cron**: claim and finalize
- **group-thing-ai/scripts/moderation_db_role.sql + tests/test_deploy_artifacts.py**: grants contract
- **Frontend**: HeroBlock, GalleryBlock, LayoutRenderer, EditorSheet "Zdjęcia" tab, organizations API and hooks
- **Admin frontend**: PhotoModerationCard, PhotoModerationPage, api/moderation.ts
- **Optional**: system/public_preview.py (og:image)

**Consumer Count**: about 12-15 files across 2 repos
**Impact Scope**: High. It is cross-repo and touches a shared moderation pipeline whose dispatch is hard-coded for two subjects, and the public organizer page, which has a statement-count budget.

---

## Test Coverage

### Test Files (to mirror or extend)

**Backend (`src/backend/tests/`)**
- **test_my_profile.py** (~l.95-211): `_png` helper; monkeypatches `moderation_image_enabled`; pending is private and owner-only; replace stages a delete; non-image → 400; admin list/decide/delete of an avatar.
- **test_product_photos.py**: upload webp with sort_order; invalid or too large → 400; 11th photo or duplicate → 409; 404; delete renumbers and writes the outbox; reorder permutation, stale → 409; non-owner → 403; moderation on and off.
- **test_moderation.py, test_photo_moderation_{hardening,withdraw,repoint}.py**: subject dispatch, admin decisions.
- **test_organizations.py**: ownership and public read.
- **test_organizer_page_queries** (with conftest `count_queries`): statement budget for the public page. Media must be loaded in one query.
- **test_authorization_matrix.py** (~l.56): add cases for media routes, e.g. that PATCH reorder is EDIT.
- **Migration tests** (e.g. `test_photo_moderation_attempts_migration.py`): pattern for the 0054 upgrade/downgrade.
- **test_public_preview.py**: only if og:image is in scope.
- **tests/fake_storage.py**: public URLs on `cdn.test`, signed URLs on `origin.test`.

**Sibling repo (`group-thing-ai/tests/`)**
- **test_photo_store.py**: pins the exact SUBJECTS and privilege map, so it must be updated.
- **test_deploy_artifacts.py:52**: parses the SQL grants against REQUIRED_PRIVILEGES.
- **test_moderation_cron.py**: alternation across 2 subjects. Extend it to 3.
- **test_photo_moderation.py, fakes.py**

**Frontend (`src/frontend/src/test/`)**
- **useOrganizationHooks.test.tsx, layoutPositions.test.ts, LayoutRenderer tests**: gallery block and slots.
- **PhotoModerationPage.test.tsx**: third subject title and discriminator.
- **PanelPage.test.tsx:3713** (avatar), **ItemDetailPage / useItemDetail tests**: patterns for the editor tab.

### Coverage Assessment

- **Existing coverage of the templates**: good. Products and avatars have thorough integration tests, and the cron repo pins its contracts.
- **Gaps for D**: everything is new. Areas needing new tests:
  - per-slot "newest approved wins" selection;
  - an approved logo staying visible while a new one is pending;
  - lazy cleanup of superseded rows;
  - a third subject in admin list/decide/delete and in cron alternation;
  - the public page statement budget with media;
  - the EditorSheet photo tab mutating immediately, outside the draft.

---

## Coding Patterns

### Naming Conventions

- **Backend modules**: flat bounded-context packages (`app/organizations/{models,schemas,service,router}.py`); snake_case functions; StrEnum stored as `String(20)` (never ordinal).
- **Entities**: UUID ids since 0041. The `migrations.md` standard is outdated about explicit sequences; follow 0051.
- **Storage keys**: `{prefix}/{owner_id}/{media_id}/w1600.webp` and `/w400.webp` (proposed prefix `organizations/{org_id}/{media_id}`).
- **Frontend**: PascalCase components (`GalleryBlock.tsx`); hooks in `src/hooks/`; API in `src/api/*.ts`; query-key prefix constants (`PUBLIC_ORGANIZATION_KEY`, `MY_ORGANIZATION_KEY`).
- **Copy**: Polish for users ("W weryfikacji", "Dodawanie zdjęć jest chwilowo niedostępne"), English for admin (Chakra UI).

### Architecture Patterns

- **Style**: service functions with an AsyncSession; FastAPI dependencies for auth (`EditPrincipal`) and storage; centralized authorization matrix.
- **Concurrency**: lock the parent with FOR UPDATE; optimistic `updated_at` version col → StaleDataError → 409, which the frontend maps to CONFLICT_MESSAGE.
- **Files**: put before commit; deletes deferred through the outbox.
- **State management (FE)**: TanStack Query v5; mutations await invalidation of the whole prefix; EditorSheet uses a draft plus `diffDraft` on "Zapisz".
- **UI**: up/down reorder buttons (no drag-and-drop anywhere in the app); SafeImage fallback; 10 s polling while PENDING.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File count | about 25-30 files (BE about 10, FE about 12, AI repo 3-4 plus tests) across 2 repos | High |
| Dependencies | storage, images, moderation, outbox, config, ownership, users FK (7-9) | Medium-High |
| Consumers | about 12-15 (routers, moderation, cron, admin UI, public page, editor) | High |
| Test coverage of templates | Good (products, avatars, cron contracts pinned) | Low risk / good base |

### Overall: Complex

The individual pieces copy known templates. The complexity comes from:
- breadth across 2 repos and both stacks;
- a third moderation subject in hard-coded dispatch;
- per-slot selection semantics the cron cannot help with;
- coordinated deploy order (migration → re-run grants SQL → deploy cron);
- the statement budget and optimistic-lock interplay on the public page.

---

## Key Findings

### Strengths

- The authorization matrix already covers organization mutations (row 50). No security change is needed if reorder uses PATCH.
- Mature, tested templates exist for both shapes: single slot (avatar) and ordered gallery (product).
- No new dependencies or infra. multipart, boto3, pillow, nginx 16m and the compose cron are all present.
- `ModerationSubjectType` is non-native `String(20)`, so adding the subject needs no enum migration.
- The cron fails closed when grants are missing, so a mis-ordered deploy leaves rows PENDING rather than leaking anything.

### Concerns

- **Approved-image retention**: the cron never retires a previously approved row. "Keep the last approved logo/cover public until a new one is approved" (research variant B) therefore requires several rows per kind (no `UNIQUE(org, kind)`) and a read-time "newest APPROVED per kind" rule, plus lazy cleanup of superseded rows on the next upload or owner read.
- **Hard-coded moderation dispatch**: a third subject could silently take the ProductPhoto path in `decide` / `delete_upload`, and the admin frontend infers avatar from `product_id == null`. Both need an explicit discriminator or map.
- **Optimistic lock vs cron writes**: the cron sets `updated_at` (the version column) on every write. Reorder or delete while the cron finalizes can raise StaleDataError → 409. Lock the parent, accept 409 and retry, and don't hold ORM rows across awaits.
- **Anti-patterns in the templates (do not copy)**:
  - a row lock held during the S3 put;
  - the avatar first-upload race (IntegrityError → 500);
  - orphaned files (put before commit with no sweep, and REJECTED files are never deleted);
  - an immutable 1-year CDN cache with no purge, which matters for logo/cover takedown;
  - a 600 s presigned TTL, so owner views left open longer show broken images, and NEEDS_REVIEW does not poll;
  - inconsistent sha dedup (products count REJECTED rows as duplicates, avatars never check).
- **Cross-module import**: `app/users` imports `app.product.images`. A third consumer argues for moving it to `app/storage/images.py`.
- **Migration number collision** with task C (both may claim 0054).
- **Public page performance**: `test_organizer_page_queries` enforces a statement budget, so media must load in a single query.

### Opportunities

- Introduce a subject → model map in `moderation/service.py` (fixes anti-pattern 6) instead of adding a third branch.
- Optionally add a `ModeratedImageMixin` for the shared columns (status, moderation_attempts, moderation_retry_at, storage_key, sha, dims). It would be the first such abstraction; weigh it against the minimal-implementation standard.
- Parametrize ModerationBadge copy ("W moderacji" vs "W weryfikacji").
- Use the cover image as `og:image` in `public_preview.py` and switch to `twitter:card summary_large_image`.

---

## Impact Assessment

- **Primary changes**:
  - backend: `app/organizations/{models,schemas,service,router}.py`, new migration `0054_organization_media.py`, `app/moderation/{models,service,schemas}.py`;
  - sibling repo: `group-thing-ai/app/photo_store.py`, `scripts/moderation_db_role.sql`;
  - frontend: `api/organizations.ts`, organization hooks, `layouts/types.ts`, `LayoutRenderer`, `registry.ts`, `HeroBlock.tsx`, new `GalleryBlock.tsx`, `EditorSheet.tsx`, admin moderation card, page and API.
- **Related changes**: optional move of `app/product/images.py` to `app/storage/images.py` (update imports in users and product); `system/public_preview.py` (og:image); GhostBlock copy; `PublicOrganizationPage.tsx`.
- **Test updates**:
  - new `test_organization_media.py` (mirroring test_product_photos plus test_my_profile);
  - extend test_moderation*, test_authorization_matrix, test_organizer_page_queries and add a migration test;
  - AI repo: test_photo_store, test_deploy_artifacts, test_moderation_cron;
  - frontend: hooks, layout, LayoutRenderer, EditorSheet, PhotoModerationPage tests.

### Risk Level: Medium-High

Reasons:
- a cross-repo contract (cron SUBJECTS, column grants, deploy order);
- a shared moderation pipeline with hard-coded two-subject dispatch;
- a public-facing page with a performance budget and optimistic locking;
- takedown latency from immutable CDN caching on highly visible images (logo/cover).

Mitigations: strong existing test templates, fail-closed cron behaviour, the authorization matrix already in place, and no new dependencies.

---

## Recommendations

Task type: new capability built from existing patterns, plus modification of the moderation pipeline.

### Backend

1. **Table `organization_media`** (UUID PK as in 0051):
   - columns: `id`, `organization_id` FK, `kind` String(20) StrEnum (LOGO / COVER / GALLERY), `storage_key`, `width`, `height`, `size_bytes`, `content_sha256`, `status`, `uploaded_by_user_id` FK users, `sort_order`, `moderation_attempts`, `moderation_retry_at`, `created_at`, `updated_at`;
   - indexes: `ix(status)`; partial claim `ix(created_at, id) WHERE status='PENDING'`; `ix(organization_id, kind)`;
   - consider HLD l.748: a partial unique `(organization_id, kind) WHERE status IN ('PENDING','NEEDS_REVIEW') AND kind <> 'GALLERY'` (one pending per slot) and `UNIQUE(organization_id, content_sha256)`.
   - The 8 cron columns must match `_moderated_table` exactly. Copy the operator notes from 0051's docstring.
2. **Slot semantics**:
   - public view: newest APPROVED per LOGO / COVER, plus APPROVED GALLERY by sort_order;
   - owner view additionally: newest non-approved per slot with status (PENDING / NEEDS_REVIEW → "W weryfikacji", REJECTED → note) via presigned URLs;
   - on a new LOGO/COVER upload, replace any existing pending row for that slot (stage its files for delete);
   - clean up superseded APPROVED rows lazily (outbox delete) once a newer one is approved, on the next upload or owner read. No cron change is needed.
3. **Routes** under `/api/organizations/me/media`, all covered by matrix row 50:
   - `POST` (multipart, `kind`);
   - `DELETE /{id}`;
   - `PATCH /order` (full permutation for GALLERY; stale list → 409 "Lista zdjęć jest nieaktualna — odśwież stronę").
   - Do not use PUT unless you add a matrix row and test.
4. **Concurrency**:
   - serialize with `SELECT organizations … FOR UPDATE` without bumping its version;
   - do the S3 put outside any lock that is held long, or accept the product pattern knowingly;
   - never hold ORM rows across awaits;
   - map StaleDataError to 409.
5. **Limits and errors**: reuse `process_upload` limits and messages. Storage None → 409 "Dodawanie zdjęć jest chwilowo niedostępne"; duplicate → 409 "To zdjęcie jest już w galerii"; gallery limit (suggest 10, mirroring products) → 409.
6. **Public read**: embed logo, cover and gallery in `PublicOrganizationResponse` (add a Storage dependency to `get_public_organization`), loaded in one query. Do not add a public sub-path; it would need a new matrix row. Keep media out of the organizer directory response.
7. **Moderation integration**:
   - add `ORGANIZATION_MEDIA`;
   - refactor `_set_photo_files_public`, `list_photos`, `decide` and `delete_upload` into a subject → model map;
   - extend the schemas Literal;
   - expose a `subject_type` discriminator to the admin frontend.
8. **Images module**: move `app/product/images.py` to `app/storage/images.py` before adding the third consumer (recommended, low risk).

### Sibling repo (group-thing-ai)

9. Add the subject to `photo_store.py` (`_moderated_table`, `Subjects`, `SUBJECTS`) and grants to `moderation_db_role.sql`; update `test_photo_store`, `test_deploy_artifacts` and `test_moderation_cron` (3-way alternation).
10. Document the deploy order: app migration → re-run `moderation_db_role.sql` → deploy cron. A missing grant fails closed.

### Frontend

11. **Hero**: HeroBlock renders the cover image and logo when present, with the initials fallback otherwise, using SafeImage (no-referrer, lazy).
12. **Gallery block**: add `"gallery"` to BlockId, the registry slots and BLOCKS. GalleryBlock returns null for visitors when empty, the ghost renders for owners, and GHOST_COPY gets a gallery entry. Note that `isEmpty` currently applies only to directory blocks.
13. **"Zdjęcia" tab in EditorSheet**:
    - mutations apply immediately and stay outside the dirty/draft diff;
    - invalidate `PUBLIC_ORGANIZATION_KEY` and `MY_ORGANIZATION_KEY` even on failure;
    - reuse the ItemGalleryEditor pieces (PhotoFileField, ItemPhotoStrip, up/down move);
    - parametrize the badge copy;
    - poll while PENDING or NEEDS_REVIEW;
    - refetch before the 600 s presigned TTL expires.
14. **Admin**: PhotoModerationCard and PhotoModerationPage use `subject_type` instead of `product_id == null`, in English copy.

### Testing strategy

Integration-first, per the standards:
- mirror test_product_photos (upload, limits, dedup, reorder, delete, 403/404, moderation on/off);
- mirror test_my_profile (slot replace, pending private);
- add slot-retention tests (old approved logo stays public while the new one is pending; after approval the old one is superseded and cleaned up);
- statement-budget test for the public page;
- authorization-matrix cases;
- 0054 migration test;
- cron contract tests in the AI repo;
- frontend tests for hooks, layout, GalleryBlock, the EditorSheet tab and the admin card.

---

## Open Questions / Decisions for the User

1. **Scope**: deliver the gallery block (D2) in this task, or only the hero logo/cover (D1) now and the gallery later?
2. **Migration number**: 0054 (HLD l.748) collides with task C, which the B spec reserves as 0054+. Is D 0054 or 0055? Does C land first?
3. **Per-slot pending model**: allow one pending per LOGO/COVER slot (partial unique; a new upload replaces the pending one), or allow several pending? Confirm variant B, where the last approved image stays public until a new one is approved.
4. **Limits**: maximum gallery size (suggest 10, as for products). Allow the same file in different kinds (sha dedup across the org vs per kind)? Should REJECTED rows count as duplicates?
5. **OG image**: in scope (cover → `og:image`, `summary_large_image`) or deferred?
6. **Where the owner manages photos**: the EditorSheet "Zdjęcia" tab (recommended; immediate mutations, outside the draft) or the panel, which is where avatars live?
7. **Refactor**: move `images.py` to `app/storage/images.py` and introduce a moderation subject → model map now? Both recommended. An optional `ModeratedImageMixin` is probably not needed under minimal implementation.
8. **Takedown and caching**: is the immutable 1-year CDN cache acceptable for logo/cover? The alternative is per-media keys, which we already have, so a takedown only needs to stop referencing the key, but the CDN object stays cached unless purged. Should REJECTED files be deleted?

---

## Next Steps

1. Get the user's answers to the open questions, especially scope (D1/D2), the migration number and the slot model.
2. Invoke the gap-analyzer with this report and research §10.3, covering the user journeys: owner uploads logo, cover and gallery; visitor views the page; admin takes an image down; the cron approves.
3. Then specification, then an implementation plan with task groups: DB/migration; backend service and routes; moderation refactor; AI repo; frontend public; frontend editor; admin frontend; tests. Include the deploy-order note.
