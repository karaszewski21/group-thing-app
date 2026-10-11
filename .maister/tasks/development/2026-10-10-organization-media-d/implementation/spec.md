# Specification: D — Zdjęcia organizacji (logo, okładka, galeria)

## Goal
Let an organization owner add a logo, a cover photo and up to 3 gallery photos to their public organizer page (`/:slug`). Photos go through the existing image moderation pipeline (app plus the `group-thing-ai` cron), visitors see only approved photos, and the owner manages photos in a new "Zdjęcia" tab of the appearance editor, where every change saves immediately.

## User Stories
- As an **organization owner**, I want to upload a logo and a cover photo so that my page looks like my brand rather than initials on a colored band.
- As an **organization owner**, I want to replace my logo/cover without my page going blank while the new photo is being checked, so that visitors always see an approved image.
- As an **organization owner**, I want to add up to 3 gallery photos, reorder them and delete any of them, so that I control what visitors see.
- As an **organization owner**, I want to see which photos are "W weryfikacji" or "Odrzucone" in the Zdjęcia tab, so that I know why something is not on my page yet.
- As a **visitor/parent**, I want to see the organization's approved logo, cover and gallery, so that I recognise the organizer.
- As an **admin**, I want organization photos in the existing photo moderation page, labelled with the organization and the photo kind, so that I can approve, reject (take down) or delete them.
- As the **moderation cron** (VPS B), I need organization photos as a third subject with the same column contract, so that they are classified automatically.

---

## Core Requirements

Every requirement is numbered. "Owner" means the party with the active OWNER membership of the organization (`organizations.service.get_own_organization`). Messages shown to users are Polish; admin copy is English.

### A. Backend app (`src/backend`)

**R1 — Move the image processing module.** Move `app/product/images.py` to `app/storage/images.py` unchanged (`process_upload`, `ProcessedImage`, `MAX_UPLOAD_BYTES`, `INVALID_IMAGE_MESSAGE`, `TOO_LARGE_MESSAGE`). Update the imports in `app/product/service.py`, `app/product/router.py` (`from .images import MAX_UPLOAD_BYTES`, l.25), `app/users/service.py`, `app/users/router.py` and any tests. Do not leave a re-export shim. This is a move, not a new abstraction (decision I-5).

**R2 — Model.** Add to `app/organizations/models.py`:
- `MediaKind` StrEnum: `LOGO`, `COVER`, `GALLERY`, stored through the module's existing `_enum_column` helper as non-native `String(10)`.
- `OrganizationMedia(BaseEntity)`, table `organization_media`. It has the UUID `id` from `BaseEntity`, which is also the moderation `subject_id`, plus `created_at` and `updated_at` (version column). Columns are listed in R3.
- Business-key `__eq__`/`__hash__` on `storage_key`, plus `large_key` (`{storage_key}/w1600.webp`) and `thumb_key` (`{storage_key}/w400.webp`) properties, all as in `ProfileAvatar`.
- No `relationship()`. `organization_id` and `uploaded_by_user_id` are plain FK columns.
- Declare `UniqueConstraint(organization_id, kind, content_sha256)` in `__table_args__`. Keep the partial indexes migration-only, with a comment, the same way `ProductPhoto` keeps its claim index.
- The docstring states:
  - the cron column contract (migration 0054, subject `ORGANIZATION_MEDIA`);
  - files are private until APPROVED;
  - the gallery limit of 3 is enforced in the application layer;
  - "newest APPROVED per LOGO/COVER slot is the public one".

**R3 — Migration `0054_organization_media.py`** (`revision="0054"`, `down_revision="0053"`). Template: `0051_profile_avatars.py`.

| Column | Type | Null | Default | Note |
|---|---|---|---|---|
| `id` | UUID | no | `gen_random_uuid()` | PK `pk_organization_media` |
| `organization_id` | UUID | no | — | FK `fk_organization_media_organization_id_organizations` → `organizations.id`, no cascade |
| `kind` | String(10) | no | — | LOGO / COVER / GALLERY |
| `storage_key` | String(200) | no | — | `organizations/{organization_id}/{media_id}` |
| `size_bytes` | Integer | no | — | bytes of the w1600 rendition (parity) |
| `content_sha256` | String(64) | no | — | sha256 of the original upload |
| `status` | String(20) | no | — | ModerationStatus |
| `sort_order` | Integer | no | `0` | used by GALLERY; 0 for LOGO/COVER |
| `uploaded_by_user_id` | UUID | no | — | FK `fk_organization_media_uploaded_by_user_id_users` → `users.id` (audit, parity with `product_photos`) |
| `moderation_attempts` | Integer | no | `0` | written by the cron only |
| `moderation_retry_at` | DateTime | yes | — | written by the cron only |
| `created_at` | TIMESTAMP | no | — | |
| `updated_at` | TIMESTAMP | no | — | version column; the cron bumps it on every write |

Constraints and indexes:
- `uq_organization_media_organization_id_kind_content_sha256` UNIQUE (`organization_id`, `kind`, `content_sha256`). This is per-kind dedup (I-8). Its leading columns also serve all `(organization_id[, kind])` lookups, so no separate `(organization_id, kind, status)` index is created.
- `ix_organization_media_status` (`status`), as in 0051. It is used by the admin list filter.
- `ix_organization_media_pending_created_at` (`created_at`, `id`) `WHERE status = 'PENDING'`. This is the cron claim index; it must be identical in shape to 0051.
- `uq_organization_media_one_pending_per_slot` UNIQUE (`organization_id`, `kind`) `WHERE status IN ('PENDING','NEEDS_REVIEW') AND kind IN ('LOGO','COVER')`. This allows at most one unmoderated row per logo/cover slot.

**Cron column parity.** The 8 columns the cron reads and writes are `id`, `storage_key`, `content_sha256`, `status`, `moderation_attempts`, `moderation_retry_at`, `created_at`, `updated_at`. Their names and types must match `profile_avatars` and `group-thing-ai/app/photo_store.py::_moderated_table` exactly.

**Downgrade.** Drop the three indexes (the unique constraint goes with the table), then `drop_table`.

**Docstring operator notes**, as in 0051:
- "After upgrading, re-run group-thing-ai `scripts/moderation_db_role.sql` to grant the cron role its columns on `organization_media`."
- "Before downgrading, stop (or roll back) the moderation cron. Downgrading orphans the files under `organizations/` in object storage."
- The decisions are logged with `subject_type = 'ORGANIZATION_MEDIA'`.

Deviation from HLD l.748 (recorded here so nobody re-adds the columns):
- `width`/`height` are omitted. Nothing reads them: the gallery uses fixed aspect boxes (minimal-implementation standard).
- The cross-kind `UNIQUE(organization_id, content_sha256)` is replaced by the per-kind unique (I-8).

**R4 — Upload.** `POST /api/organizations/{organization_id}/media?kind={LOGO|COVER|GALLERY}`, multipart field `file`, EDIT principal (matrix row 50). Router pattern from `app/product/router.py::add_product_photo`: `Storage` dependency, `file.read(MAX_UPLOAD_BYTES + 1)`.

Service order of operations (new module `app/organizations/media.py`):
1. Resolve the profile, load the organization (404 if unknown) and check ownership (403 `AccessDeniedException`, as `update_organization` does).
2. If storage is `None` → 409 with the product constant `PHOTO_UPLOAD_DISABLED_MESSAGE` (`"Dodawanie zdjęć jest chwilowo niedostępne"`, no trailing period, `app/product/service.py:409`). Reuse the constant rather than a new string (audit L10).
3. Run `process_upload` in `asyncio.to_thread`. A `ValueError` → 400 with its Polish message.
4. Store both renditions: `storage.put(..., public=approved)`, where `approved = not settings.moderation_image_enabled`. This is done before any lock (no lock held during S3 I/O).
5. Lock the organization row: `SELECT organizations.id … FOR UPDATE`. This never loads or mutates the ORM `Organization`, so `organizations.updated_at` is not bumped.
6. Apply the dedup, limit and slot rules (R5/R6), insert the row (`status` APPROVED if `approved`, else PENDING; `uploaded_by_user_id` = caller's user id), and commit.
7. On any exception after step 4: roll back and `storage.delete` both new keys, then re-raise (product/avatar pattern).

Response: `201` with `OwnerMediaResponse` (R10).

**R5 — Logo/cover slot semantics** (`kind` LOGO or COVER), under the organization lock:
0. **Per-slot retire before dedup (audit L2).** First call `retire_older_slot_rows` for the slot with `than` = (`created_at`, `id`) of the slot's newest APPROVED row, when one exists (R13). This removes superseded rows left by a cron approval that the sweep has not reached yet, so dedup never matches a row `/mine` hides.
1. **Dedup.** If any row exists with the same (`organization_id`, `kind`, `content_sha256`), in any status including REJECTED, return 409:
   - LOGO: `"To zdjęcie jest już dodane jako logo."`
   - COVER: `"To zdjęcie jest już dodane jako okładka."`

   Including REJECTED means a rejected image cannot be resubmitted while its row exists.
2. **Replace.** Delete every PENDING, NEEDS_REVIEW and REJECTED row of the slot and stage their files through the `OBJECTS_DELETE` outbox. This implements "new pending replaces older pending/rejected" and I-2. The current APPROVED row stays untouched and public.
   - **Status-predicated (audit H2).** The delete is one Core statement with the status filter in its predicate: `DELETE … WHERE organization_id=:o AND kind=:k AND status IN ('PENDING','NEEDS_REVIEW','REJECTED') RETURNING storage_key`. It is never "read ids, then delete by id". The cron can flip PENDING → APPROVED at any moment; Postgres re-checks the predicate after waiting on the cron's row lock, so a row the cron has just approved is not deleted (it stays public and the older approved row does not resurface).
3. Insert the new row. **Ordering (audit L11):** run the step-2 DELETE first, then `db.add` + `flush` the new row, then retire using the flushed `created_at`/`id`. Adding the row before the DELETE could autoflush it and trip `uq_organization_media_one_pending_per_slot`.
4. If the new row is APPROVED (moderation off), **retire** older rows of the slot (R13) in the same transaction, with `than` = the flushed (`created_at`, `id`) of the new row.

**R6 — Gallery semantics** (`kind` GALLERY), under the organization lock:
1. **Dedup.** A row with the same (`organization_id`, GALLERY, sha), in any status → 409 `"To zdjęcie jest już w galerii."`.
2. **Limit.** If the count of non-REJECTED gallery rows is ≥ `MAX_ORGANIZATION_GALLERY = 3` → 409 `"Galeria może mieć najwyżej 3 zdjęcia."`. REJECTED rows do not count (I-3).
3. **Order.** `sort_order` = 1 + the max `sort_order` among non-REJECTED gallery rows, or 0 when there are none.
4. A gallery upload does **not** remove REJECTED gallery rows. They stay until the owner deletes them (mockup G4).

**R7 — Delete.** `DELETE /api/organizations/{organization_id}/media/{media_id}`, EDIT principal, owner only. A `media_id` that is not in this organization → 404. Any status may be deleted. Under the organization lock, a shared `_delete_media(db, organization_id, media)` (also used by the admin delete, R15):
- deletes the row with one Core `DELETE … WHERE id=:id AND organization_id=:o RETURNING id, kind, status, created_at, storage_key` and stages its two keys via `OBJECTS_DELETE`. No returned row → 404 (already gone);
- GALLERY: renumbers the remaining non-REJECTED gallery rows densely (0..n-1, by `sort_order` then `created_at`);
- LOGO/COVER with the deleted row APPROVED: retires older rows of the slot (R13), `than` = the returned (`created_at`, `id`). Without this, an older approved image could resurface.
- **The retire decision uses the status returned by the DELETE, never a status read earlier (audit H2).** Example: the owner presses "Anuluj" on a PENDING row while the cron commits it as APPROVED. The DELETE waits on the cron's row lock, deletes the now-APPROVED row and returns `status=APPROVED`, so the retire runs and the older approved image does not resurface.

Response: `204`. No confirmation step exists in the UI (mockup decision).

**R8 — Reorder.** `PATCH /api/organizations/{organization_id}/media/order`, EDIT principal, owner only.
- Body `ReorderOrganizationMediaRequest { media_ids: list[UUID] }` is the full list of the organization's non-REJECTED GALLERY ids in the new order.
- Under the organization lock: if the list is not exactly that set (wrong length, duplicates, unknown or REJECTED id) → 409 `"Kolejność się zmieniła. Odśwież i spróbuj ponownie."`. Otherwise set `sort_order` = list index.
- Response: `200` with `list[OwnerMediaResponse]`, the non-REJECTED gallery in the new order.
- No PUT: matrix row 50 covers only POST/PATCH/DELETE.

**R9 — Public read.** `GET /api/organizations/public/{slug}` (`PublicOrganizationResponse`) gains:
- `logo: PublicMediaResponse | null`: the newest APPROVED LOGO row;
- `cover: PublicMediaResponse | null`: the newest APPROVED COVER row;
- `gallery: list[PublicMediaResponse]`: APPROVED GALLERY rows ordered by `sort_order`, then `created_at`.

Details:
- `PublicMediaResponse { url, thumb_url }` holds public CDN URLs (`storage.public_url` of `large_key` / `thumb_key`). It has no id, status or sort order.
- "Newest" means max (`created_at`, `id`).
- Media is loaded with **one** query (all APPROVED rows of the organization) and assembled in Python. The endpoint issues exactly 2 SQL statements regardless of the number of media: the organization by slug, then the media.
- The router gains a `Storage` dependency. If storage is `None`, the media query is skipped and the response carries `logo=null, cover=null, gallery=[]`, so the page still renders.
- Pending and rejected media never appear here, for the owner either (I-9).
- **Defaults are mandatory (audit H1).** The new schema fields are declared with defaults: `logo: PublicMediaResponse | None = None`, `cover: PublicMediaResponse | None = None`, `gallery: list[PublicMediaResponse] = []`. `PublicOrganizationResponse` is `from_attributes=True`, and it has a second caller: `app/system/router.py::public_organization_preview` server-renders `/{organization_slug}` with `PublicOrganizationResponse.model_validate(organization)` on the ORM `Organization`, which has no `logo`/`cover`/`gallery` attributes. With the defaults, that caller keeps working unchanged and does **no** media query (the meta preview needs no media; `og:image` is out of scope). The public API router fills the fields explicitly (e.g. `model_validate(org).model_copy(update={...})` or the constructor), never by adding attributes to the ORM object.

**R10 — Owner read.** `GET /api/organizations/mine` returns a new `MyOrganizationResponse(OrganizationResponse)` with `media: list[OwnerMediaResponse]`. `POST /mine` and `PATCH /{id}` keep returning plain `OrganizationResponse` (no storage needed there).

`OwnerMediaResponse { id, kind, status, url, thumb_url, sort_order }`:
- URLs are public for APPROVED rows and presigned for the rest (the `avatar_response` / `photo_view` rule).
- The list contains every non-superseded row: all GALLERY rows (REJECTED included), and for LOGO/COVER every row except APPROVED/REJECTED rows older than the slot's newest APPROVED row.
- Therefore, per logo/cover slot: at most one APPROVED row, at most one PENDING/NEEDS_REVIEW row, and any number of REJECTED rows newer than the approved one. Two is reachable: after a takedown of A (REJECTED) the cron can also reject the pending P (audit L6).
- Order: kind (LOGO, COVER, GALLERY), then `sort_order`, then `created_at`. The FE renders a slot's REJECTED rows newest first (R26 S6).
- Loaded with one extra query.
- Storage `None` → `media=[]`.

**R11 — Storage unavailable.** With `get_storage() is None`:
- upload → 409 (R4);
- public read and `/mine` → empty media (R9/R10);
- delete and reorder still work on rows. Deleted files are staged in the outbox, which retries as it does today.

**R12 — Superseded-media sweep.** A new job `sweep_superseded_media(db)` in `app/organizations/media.py` is registered on the existing `AsyncIOScheduler` in `app/main.py`. It is a second `add_job` on the same scheduler instance, with constant `_MEDIA_SWEEP_INTERVAL_MINUTES = 15` (a plain constant, as `_TERM_END_SCAN_INTERVAL_MINUTES`), and its own `_run_media_sweep` that opens `async_session_factory()`.
- **What it deletes:** LOGO/COVER rows with status APPROVED or REJECTED for which a newer (`created_at`, `id`) APPROVED row exists in the same (`organization_id`, `kind`). It never touches GALLERY rows, PENDING/NEEDS_REVIEW rows, or the newest APPROVED row of a slot.
- **How:** one `DELETE … WHERE id IN (SELECT id … ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED) RETURNING storage_key` (SQLAlchemy Core). `ORDER BY id … FOR UPDATE SKIP LOCKED` skips rows an owner/admin transaction holds, so the sweep cannot deadlock against it (audit L1); skipped rows are picked up on a later run or retired by that transaction itself, then one `OBJECTS_DELETE` outbox append for the returned keys (w1600 and w400 each), then commit. It logs the number of deleted rows when the number is greater than 0.
- **Idempotent:** a second run with nothing superseded deletes nothing and appends no outbox event. Rows already deleted by a concurrent owner or admin action are simply not returned.
- **Purpose:** it cleans up after **cron** approvals, the only approval path the app cannot hook. App-side approval paths retire eagerly (R13). Correctness of the public read never depends on the sweep having run.

**R13 — Retire rule and takedown guarantee.** `retire_older_slot_rows(db, organization_id, kind, than=(created_at, id))` deletes APPROVED and REJECTED rows of the slot older than `than` and stages their files, inside the caller's transaction. It is called:
- (a) after an upload that is APPROVED immediately (R5.4);
- (b) after an owner or admin delete of an APPROVED LOGO/COVER row (R7, R15);
- (c) after an admin `decide` APPROVED on a LOGO/COVER row (R16);
- (d) after an admin `decide` REJECTED on a LOGO/COVER row whose previous status was APPROVED, i.e. a takedown (R16).

- (e) before dedup on every logo/cover upload, with `than` = the slot's newest APPROVED row (R5.0, audit L2).

It never deletes PENDING/NEEDS_REVIEW rows.

**Guarantee.** Once an image has been the public logo or cover, no older image of that slot can become public again. The public row is the newest APPROVED one, and every app-side path that removes or un-approves it retires the older rows first. The cron only transitions PENDING rows, so it cannot un-approve anything. A takedown therefore leaves the slot empty (initials or `bg-primary` band) until a newer image is approved. The guarantee also holds against the cron racing an app-side delete, because every delete decides on the status the database returns or re-checks, not a pre-read one (R14).

**R14 — Write mechanics.** All app-side `organization_media` writes other than INSERT are SQLAlchemy Core statements: `DELETE … RETURNING …`, and `UPDATE … SET sort_order, updated_at` by id for renumber and reorder. ORM rows are never held across awaits.
- **Status-safe deletes (audit H2).** The cron is not serialized by the organization lock: it claims and finalizes in its own short transactions and can flip PENDING → APPROVED between an app read and an app write. Therefore:
  - a delete meant only for unmoderated/rejected rows (R5.2 replace) carries the status filter in its own `WHERE` (Postgres re-evaluates it after the cron's row lock is released);
  - a delete by id (R7 `_delete_media`, owner and admin) returns `status, kind, created_at, id, storage_key`, and every follow-up decision (retire or not) is based on that **returned** status.
  - No delete decides on a status read in an earlier statement.
- **Exception (audit L4).** Admin `decide` (R16) sets `status` through the ORM on the row it has just locked with `with_for_update=True`. That is safe: the cron's claim uses `SKIP LOCKED` and its guarded finalize waits on the lock, so nothing else changes the row between the locked read and the flush.

Reasons for Core:
- The cron updates PENDING rows (including `updated_at`, the version column) concurrently, so an ORM flush could raise a spurious `StaleDataError`.
- The organization row lock already serializes every app-side writer.
- The cron's guarded finalize (`WHERE status='PENDING' AND moderation_attempts=…`) is unaffected by `sort_order`/`updated_at` writes, and a deleted row makes it a no-op (rowcount 0, existing handling).

### B. Moderation in the app (`app/moderation`)

**R15 — Third subject and subject map.**
- Add `ModerationSubjectType.ORGANIZATION_MEDIA = "ORGANIZATION_MEDIA"` (18 chars, fits `moderation_decisions.subject_type String(20)`; no migration needed).
- Replace the hard-coded two-way dispatch in `service.py` with one module-level mapping from subject type (PHOTO, AVATAR, ORGANIZATION_MEDIA) to a small frozen descriptor (audit M1). Its fields are exactly:
  - `model`: the ORM class (`ProductPhoto`, `ProfileAvatar`, `OrganizationMedia`);
  - `admin_delete(db, subject_id)`: the admin delete entry point;
  - `list_branch(...)` and `count(...)`: the `list_photos` union branch builder and its total-count statement;
  - `lock_parent(db, subject_id) | None`: optional, called by `decide` **before** the row lock. Set only for ORGANIZATION_MEDIA;
  - `after_decide(db, row, previous_status, outcome) | None`: optional, called by `decide` after the status is set and before commit. Set only for ORGANIZATION_MEDIA (R16).

  PHOTO and AVATAR leave both optional fields `None`, so their `decide` path is unchanged. The descriptor is used by:
  - `_set_photo_files_public`: type widened to the three models;
  - `list_photos`:
    - a third `union_all` branch: org media joined to `organizations`, title = organization name, `product_id` NULL;
    - a new `media_kind` column, NULL for PHOTO/AVATAR;
    - a third count in the total;
  - `decide`: model lookup by subject type, so a non-AVATAR subject no longer misroutes to `ProductPhoto`;
  - `delete_upload`: probes the three tables by id in map order and calls the matching delete function (org media: `media._delete_media` via an admin entry point without the ownership check). An id found nowhere → 404, as today.
- `QueueEntry` and `ModerationQueueEntryResponse` gain `media_kind: MediaKind | None = None`. In the frozen `QueueEntry` dataclass the field is declared **last** with the default, so `_queue_entries` (used by `list_queue`) keeps constructing it without the new field (audit L3).
- `ModerationDecisionRequest.subject_type` Literal gains `ORGANIZATION_MEDIA`. `PRODUCT_TEXT` stays rejected.
- `list_queue` (product photos only today) is unchanged.
- PHOTO and AVATAR behaviour must stay identical (strict compatibility).

**R16 — Decide hook for org media.** For ORGANIZATION_MEDIA, `decide` keeps the existing flow: lock the row, `set_public` both files (idempotent), set the status, record the decision, commit. For LOGO/COVER it additionally applies R13 (c)/(d) in the same transaction. Steps (audit M1):
1. `descriptor.lock_parent(db, subject_id)`: look up the organization id with a **Core scalar** `select(OrganizationMedia.organization_id).where(OrganizationMedia.id == subject_id)` (the `delete_photo_as_admin` pattern, `app/product/service.py:461-471`), then `SELECT organizations.id … FOR UPDATE`. It must not load an `OrganizationMedia` ORM entity: a pre-loaded entity in the identity map would make the later `db.get(..., with_for_update=True)` run the version check, and since the cron bumps `updated_at` that raises `StaleDataError` and a spurious 409 "Dane zostały w międzyczasie zmienione". No row found → 404 as today.
2. `db.get(model, subject_id, with_for_update=True)` as today (first load of the entity in this session).
3. `previous_status` = the status of the **locked** row, read before `photo.status = outcome`.
4. `set_public`, set the status, `_record`.
5. `descriptor.after_decide(db, row, previous_status, outcome)`: for LOGO/COVER, retire per R13 (c) on APPROVED, or (d) on REJECTED with `previous_status == APPROVED`; no-op for GALLERY.
6. Commit.

The hook lives in `app/organizations/media.py` and is reached only through the subject descriptor. `app.organizations` must not import `app.moderation.service`.

### C. Moderation cron (`C:/Users/karas/Desktop/swaptime/group-thing-ai`)

**R17 — Subject.** In `app/photo_store.py`:
- add `ORGANIZATION_MEDIA = Subject(_moderated_table("organization_media"), "ORGANIZATION_MEDIA", "organization photo")`;
- export it in `__all__`;
- append it to `SUBJECTS = (PRODUCT_PHOTO, PROFILE_AVATAR, ORGANIZATION_MEDIA)`; the round-robin order is photo, avatar, org media.

`REQUIRED_PRIVILEGES` is derived from `SUBJECTS`, so it extends automatically. Verify it does. Storage keys keep the `/w1600.webp`, `/w400.webp` suffix convention, so `ClaimedPhoto` needs no change.

**R18 — Grants.** In `scripts/moderation_db_role.sql`:
- add the 8-column `GRANT SELECT` and the `GRANT UPDATE (status, moderation_attempts, moderation_retry_at, updated_at)` on `public.organization_media`;
- update the header comment: run after app migration 0054;
- update the decision-row comment: subject_type `'PHOTO'`, `'AVATAR'` or `'ORGANIZATION_MEDIA'`.

**R19 — Docs.** Update the README "Photo moderation cron" section (l.~20, 304-312, 321-322, 359, 405-418, 434, 457-459, 510-523):
- three subjects;
- round-robin over three tables;
- `MODERATION_CRON_BATCH` counts all three;
- the log kinds list gains "organization photo" (l.434);
- the deploy-order warning (R-Deploy);
- **password warning (audit M3):** `moderation_db_role.sql` always runs `ALTER ROLE … PASSWORD :'cron_password'`. When re-running it only to add grants, pass the **current** cron password. If the password is rotated, update `.env.cron` and restart the running cron immediately, otherwise the cron's new connections fail and all moderation (products and avatars too) stops;
- the smoke-test steps (l.510-523) gain an org-media step: upload a logo with moderation on, run one tick, confirm a `moderation_decisions` row with `ORGANIZATION_MEDIA` (audit L5).

Also replace the stale "two subjects" wording outside the README (audit L5): the `app/photo_store.py` module docstring (l.10-15), the `ClaimedPhoto` docstring (l.~182), and `moderation_cron.py` (l.7-8).

### D. Frontend: public organizer page (`src/frontend/src`)

**R20 — API.** In `api/organizations.ts`:
- add the types:
  - `MediaKind`;
  - `PublicMedia { url, thumb_url }`;
  - `OwnerMedia { id, kind, status, url, thumb_url, sort_order }`;
  - `MyOrganizationResponse extends OrganizationResponse { media: OwnerMedia[] }`;
- `PublicOrganizationResponse` gains `logo`, `cover` and `gallery`;
- `getMyOrganization()` returns `MyOrganizationResponse`;
- new functions:
  - `uploadOrganizationMedia(orgId, kind, file)`: `api.upload` with FormData `file` and query `kind`;
  - `deleteOrganizationMedia(orgId, mediaId)`;
  - `reorderOrganizationGallery(orgId, mediaIds)`: PATCH `{ media_ids }`.

**R21 — Hooks.**
- `useMyOrganization` gains an optional option `{ pollPendingMedia?: boolean }` (default `false`). Only `PhotosTab` passes `true` (audit L7): `useMyOrganization` also backs `useMyOrganizationSlug` (panel/nav), and a NEEDS_REVIEW row can wait days for an admin, so polling must not run app-wide. With the option on, `refetchInterval` returns 10 000 ms while any `media` row is PENDING or NEEDS_REVIEW, and `false` otherwise (the `useItemDetail` pattern; NEEDS_REVIEW polls too). This also refreshes presigned URLs. Polling therefore runs only while the Zdjęcia tab is mounted (requirement 6).
- **Public page refresh on status change (audit M4).** While polling, when a refetch changes any media status (compare the previous and new `id → status` maps, including rows that disappeared), the hook invalidates `[PUBLIC_ORGANIZATION_KEY]`, so the hero and gallery behind the non-modal sheet update when the tab flips to "Na stronie". Implemented in the hook (e.g. an effect on the media list), not in components.
- New `hooks/useOrganizationMedia.ts` exposes `upload(kind, file)`, `remove(mediaId)` and `reorder(mediaIds)`, following `useUpdateOrganization`:
  - after success **and** failure it awaits invalidation of `[PUBLIC_ORGANIZATION_KEY]` and `[MY_ORGANIZATION_KEY]`;
  - it rethrows server problem messages verbatim (`serverMessageOr`), with Polish fallbacks:
    - upload: `"Nie udało się wysłać zdjęcia. Spróbuj ponownie."`
    - delete: `"Nie udało się usunąć zdjęcia. Spróbuj ponownie."`
    - reorder: `"Nie udało się zmienić kolejności. Spróbuj ponownie."`
- Follows `standards/frontend/data-fetching.md`.

**R22 — Hero.** `blocks/HeroBlock.tsx`:
- **Logo.** A small inner `HeroLogo` renders the logo `thumb_url` in place of the initials span in all three variants: `cover` h-16, `compact` h-14, `centered` h-20, all `rounded-full object-cover`, `alt=""`. On an image error it falls back to the initials.
- **Cover.** In the `cover` variant only, the cover `url` is rendered as an absolute `object-cover` `<img alt="">` over the `bg-primary` header. On error the image is hidden and the band stays as it is.
- **Cover text contrast (audit M2).** `text-on-primary` is palette-dependent (the SUN preset uses `#1e2e27`, and custom colors can resolve to ink), and `--color-scrim` is only 0.55 alpha, about 4.0:1 under white text over a white photo. Therefore, when a cover image is shown (and has not errored):
  - the name and address use a fixed light token, `text-on-ink` (`--color-on-ink`, not overridden by any palette), regardless of the palette;
  - the overlay behind the text block is darker: a gradient whose bottom stop, covering the whole name/address block, is a solid colour of at least 0.7 alpha (a dedicated darker scrim token, e.g. `--color-scrim-strong: rgb(20 28 24 / 0.75)` in `index.css`, or an equivalent `from-ink/75` stop). It is a role token, not a hex in the component.
  - Without a cover image (or after an error), the band keeps today's `bg-primary` + `text-on-primary`.
- Remove the "cover has no image yet" comment.
- Geometry is unchanged.

**R23 — Gallery block.**
- `layouts/types.ts`: add `"gallery"` to `BlockId`.
- `layouts/registry.ts`: add `{ block: "gallery", variant: "grid" }` directly after `about` in all 5 layouts (CLASSIC, CIRCLES, SCHEDULE, EXCHANGE, LINKS).
- New `blocks/GalleryBlock.tsx`:
  - `<section aria-label="Galeria" class="px-6 pt-6">` with a serif heading "Galeria" and a `<ul>` of `SafeImage` tiles from `data.organization.gallery`;
  - tile layout: 3 photos → `grid-cols-3` square (`thumb_url`); 2 → `grid-cols-2` square (`thumb_url`); 1 → full-width 4:3 (`url`);
  - alt text `"{name} — zdjęcie N z M"`;
  - tiles are not interactive.
- Export `isGalleryEmpty(data)`.
- `LayoutRenderer.tsx`: add `gallery: { Component: GalleryBlock, isEmpty: isGalleryEmpty }`. Change the empty check so that `isEmpty` is evaluated for non-directory blocks without waiting for `directoryStatus === "ready"`. Directory blocks keep their behaviour.
- When the gallery is empty, visitors get nothing and the owner gets the ghost.

**R24 — Gallery ghost.** In `blocks/GhostBlock.tsx`:
- add `GHOST_COPY.gallery`:
  - title `"Galeria"`;
  - body `"Dodaj do 3 zdjęć — odwiedzający zobaczą je po sprawdzeniu. Widzisz to tylko Ty."`;
  - CTA `{ label: "Dodaj zdjęcia →", to: "?edit=1&tab=zdjecia" }`;
- the CTA navigates with `replace` (an optional flag on the CTA), matching the gear button.

### E. Frontend: editor "Zdjęcia" tab

**R25 — EditorSheet.** `editor/EditorSheet.tsx`:
- `Tab = "uklad" | "kolory" | "zdjecia"`; `TABS` gains `{ id: "zdjecia", label: "Zdjęcia" }`; `tabRefs` gains the key; roving focus covers 3 pills.
- The tab follows `?tab=` (`zdjecia`, `kolory`, `uklad`; unknown or missing → `uklad`): at mount **and whenever the `tab` search param changes** (audit M5). Clicking the gallery ghost CTA (`?edit=1&tab=zdjecia`) while the non-modal sheet is already open on another tab switches it to Zdjęcia. A pill click also writes `tab` to the search params (with `replace`; changing only the query string is never blocked by `useBlocker`), so the param always mirrors the visible tab and a later CTA click to `tab=zdjecia` is always a change.
- New props: `organizationId` and `media` (`OwnerMedia[]`), passed on to `PhotosTab`.
- The Zdjęcia panel renders `PhotosTab` outside the `<fieldset disabled={saving}>` draft lock.
- Photo actions never set `dirty`, never enter `diffDraft`, and never trigger `useBlocker` / `UnsavedChangesDialog`.
- The Zapisz/Anuluj footer is unchanged and acts on the draft only.

**R25a — PublicOrganizationPage** (`pages/organizer/PublicOrganizationPage.tsx`, audit M5):
- `closeEditor` deletes `tab` together with `edit` (closing is implemented here, not in EditorSheet).
- It passes `organizationId={owner.id}` and `media={owner.media}` to `EditorSheet` (`owner` is the `/mine` data, now `MyOrganizationResponse`).

**R26 — PhotosTab and logo/cover slots.** New `editor/PhotosTab.tsx` with props: organization id, owner `media` (from `useMyOrganization`, via EditorSheet), and the current draft layout key. While mounted it also calls `useMyOrganization({ pollPendingMedia: true })` (R21), so polling stops when the tab or sheet closes.

Layout:
- intro line `"Zdjęcia zapisują się od razu."`;
- sections Logo / Okładka / Galeria with `SECTION_LABEL` headings;
- every section has its own busy flag (`aria-busy`, all section buttons disabled during the call and its refetch) and its own `role="alert"` error line.

The inner `PhotoSlot` (used for LOGO with a round 48px thumb, and COVER with a 16:9 `w-20` thumb) implements mockup states S1-S7. Copy for the logo slot (the cover uses "okładkę" / "okładka"):

| State | Rendering |
|---|---|
| S1 empty | Dashed initials thumb, "Brak logo — na stronie widać inicjały.", "+ Dodaj logo" |
| S2 uploading | Shimmer thumb and "Wysyłanie…" (no percentage); add button disabled |
| S3 first upload pending | Thumb, badge "W weryfikacji", "Odwiedzający zobaczą je po sprawdzeniu.", buttons "Zmień logo" and "Anuluj" (deletes the pending row) |
| S4 approved | Thumb, "Na stronie", buttons "Zmień logo" and "Usuń" |
| S5 approved + pending | Approved row ("Na stronie teraz", "Usuń ze strony"), a divider, then the pending row ("Nowe", "W weryfikacji", "Zastąpi obecne po sprawdzeniu.", buttons "Zmień" and "Anuluj") |
| S6 rejected | Thumb at `opacity-60`, badge "Odrzucone", "Odrzucone przez moderację — dodaj inne zdjęcie.", buttons "+ Dodaj logo" and "Usuń"; the approved row is shown above it when one exists. When the slot has several REJECTED rows (R10), **every** one is listed, newest first, each with its own "Usuń" (audit L6); "+ Dodaj logo" appears once |
| S7 errors | `role="alert"` lines: client `photoFileError` messages before upload, server messages verbatim, and the fallbacks from R21 |

Behaviour:
- The Okładka section always shows `"Widoczna w układach Klasyczny i Grupy."`. When the draft layout's hero variant is not `cover`, it also shows `"W wybranym układzie ({label}) okładka nie jest widoczna."` (resolved from the registry, so it follows the Układ tab live).
- After a delete, focus moves to the slot's add/change button.
- Every button is at least 44px tall and has a visible label.

**R27 — Galeria section.** `GallerySection` inside `PhotosTab.tsx` implements mockup states G1-G6.

Rows and controls:
- The counter is `N/3`, where N is the number of non-REJECTED rows (`MAX_ORGANIZATION_GALLERY = 3` constant).
- Ordered rows (non-REJECTED, by `sort_order`) show "Zdjęcie N", plus a "W weryfikacji" badge for PENDING/NEEDS_REVIEW, and ˄ / ˅ / trash buttons sized `h-11 w-11`. ˄ is disabled on the first row and ˅ on the last.
- REJECTED rows are listed after a divider with the note and a trash button only. They have no move buttons and are not counted.

Upload:
- "+ Dodaj zdjęcie" is a single file picker, disabled at 3/3, with the hint "Osiągnięto limit 3 zdjęć.".
- The hint below the picker reads `"JPG, PNG lub WebP, do 15 MB."` and `"Odwiedzający zobaczą zdjęcia po sprawdzeniu."`.

Reorder and focus:
- A move sends the full non-REJECTED id list (R8). Focus returns to the moved photo's button (the existing `focusAfterMove` idea).
- Screen-reader labels: "Przesuń zdjęcie N w górę", "Przesuń zdjęcie N w dół", "Usuń zdjęcie N", "Usuń odrzucone zdjęcie".

Errors are shown verbatim from the server (409 duplicate, limit, stale order, storage).

The row markup is copied from `ItemGalleryEditor` (about 40 lines) rather than parametrizing `ItemGalleryEditor`, so the product editor stays untouched.

**R28 — Shared photo UI props.**
- `pages/product/ItemGalleryEditor.tsx`:
  - `ModerationBadge` gains an optional `labels` prop. The default keeps the current product map, so product pages are unchanged. The organization map is PENDING/NEEDS_REVIEW → "W weryfikacji" and REJECTED → "Odrzucone".
  - `PhotoFileField` gains optional `label` (default "+ Dodaj zdjęcia") and `multiple` (default `true`) props.
- `editor/ColorsTab.tsx`: export `SECTION_LABEL`.

### F. Admin frontend

**R29 — Admin moderation.**
- `api/moderation.ts`:
  - `ModerationSubjectType` adds `"ORGANIZATION_MEDIA"`;
  - `ModerationQueueEntry` adds `media_kind: "LOGO" | "COVER" | "GALLERY" | null`.
- `components/moderation/PhotoModerationCard.tsx`: replace the title ternary with a small subject → title map:
  - PHOTO → `{product_name}`;
  - AVATAR → `Avatar · {product_name}`;
  - ORGANIZATION_MEDIA → `Organization · {product_name} · {Logo|Cover|Gallery}`.
- Approve, reject (takedown) and delete reuse the existing flow. `PhotoModerationPage` already passes `subject_type`.

### G. Documentation

**R30 — Migration-number notes.** Update the references that assume task C takes 0054. D takes **0054**; task C takes the **next free number (0055+)**. Files:
- `.maister/tasks/development/2026-10-08-organizer-directory-layouts-b/implementation/spec.md` (l.590);
- `implementation-plan.md` (l.748);
- `workflow-summary.md` (l.24);
- `verification/code-review-report.md` (l.58, l.114): besides the renumbering, mark W1-R2 (`transaction_per_migration`) as **resolved**, since `alembic/env.py:33,45` already sets it (audit L9);
- `.maister/tasks/research/2026-10-07-organizer-page-layouts-theming/outputs/high-level-design.md` (l.218, 748, 751, 770): also record the D deviations from R3 (per-kind unique, no width/height, gallery limit 3).

---

## Visual Design

Mockups in `analysis/design-context/` are **binding inputs**. The implementation-planner attaches `Visual References` (the IDs below) to every UI task group. Fidelity: **structural / approximate**. Follow the layout, states, copy and existing role tokens (no hex), and match the existing organizer page and editor style. Source: `analysis/design-context/ascii/ui-mockups.md`, mobile-first at 375px with a 430px column cap.

| ID | Mockup anchor | Spec requirement | Key elements |
|---|---|---|---|
| `component:hero-media` | `#hero-media` | R22 | Logo replaces initials in `cover`/`compact`/`centered` (64/56/80px); cover with a strong (≥0.7 alpha) scrim and fixed light text in `cover` only; `bg-primary` fallback; `alt=""` |
| `component:gallery-block` | `#gallery-block` | R23 | `px-6 pt-6`, serif heading; grid of 3/2/1 columns (1 photo = 4:3); `SafeImage`; alt "{name} — zdjęcie N z M" |
| `screen:layout-classic-media` | `#layout-classic` | R22, R23 | Cover + logo; gallery after `about`, above upcoming terms |
| `screen:layout-circles-media` | `#layout-circles` | R22, R23 | Cover + logo; gallery after `about` (2-photo grid) |
| `screen:layout-schedule-media` | `#layout-schedule` | R22, R23 | Compact hero with 56px logo, no cover; gallery after `about` |
| `screen:layout-exchange-media` | `#layout-exchange` | R22, R23 | Compact hero with logo; gallery after `about` (1-photo 4:3) |
| `screen:layout-links-media` | `#layout-links` | R22, R23 | Centered 80px logo; gallery after `about`, left-aligned heading |
| `screen:owner-media-empty` | `#owner-empty` | R23, R24 | Visitor: initials, no gallery. Owner: gallery ghost with CTA |
| `component:ghost-gallery` | `#owner-empty` | R24 | `GHOST_COPY.gallery`; CTA `?edit=1&tab=zdjecia` with `replace` |
| `screen:editor-photos-tab` | `#editor-photos-tab` | R25, R25a, R26 | Third pill "Zdjęcia"; intro line; Logo / Okładka (layout note) / Galeria; footer unchanged |
| `component:photos-tab` | `#editor-photos-tab` | R26 | Per-section busy + `role="alert"`; 10 s polling while pending (R21) |
| `component:photo-slot` | `#photo-slot` | R26 | States S1-S7 and their copy |
| `component:gallery-editor` | `#gallery-editor` | R27 | States G1-G6; counter N/3; rejected rows below a divider; 44px buttons |
| `component:media-status-badge` | `#badge` | R28 | `ModerationBadge` `labels` prop: "W weryfikacji" / "Odrzucone"; APPROVED has no badge |
| `screen:admin-moderation-org-media` | `#admin-card` | R29 | Queue entry for org media in the existing page |
| `component:moderation-card-org` | `#admin-card` | R29 | Title "Organization · {name} · {Kind}" |

Approved mockup decisions (Phase 4):
- the gallery sits after `about` in every layout, including above the terms list in CLASSIC;
- deletes have no confirmation dialog;
- uploads show "Wysyłanie…" without a percentage.

---

## Reusable Components

### Existing Code to Leverage
| Need | Reuse | Path |
|---|---|---|
| Image validation/processing (JPG/PNG/WebP, 15 MB, 50 Mpx, WebP 1600/400, EXIF strip, Polish errors) | `process_upload`, `MAX_UPLOAD_BYTES` (moved by R1) | `src/backend/app/product/images.py` → `app/storage/images.py` |
| Storage abstraction, public/presigned URLs, `None` = unavailable | `ObjectStorage`, `get_storage`, `Storage` dependency alias pattern | `src/backend/app/storage/service.py`; e.g. `app/product/router.py:42` |
| Deferred file deletion | `outbox_service.append(event_type=OBJECTS_DELETE, payload={"keys": [...]})` | `src/backend/app/storage/outbox_listener.py:16`; pattern `app/product/service.py:223` |
| Moderated-table template (cron columns, claim index, docstring) | Migration and model | `src/backend/alembic/versions/0051_profile_avatars.py`; `app/users/models.py:71-111` |
| Gallery semantics (dedup, limit, renumber, permutation reorder, stale → 409, put-then-commit with file cleanup on failure) | `add_product_photo`, `_delete_photo`, `_renumber`, `reorder_product_photos`, `photo_view` | `src/backend/app/product/service.py:355-525` |
| Upload route shape | `add_product_photo` route (`File()`, `read(MAX+1)`) | `src/backend/app/product/router.py:130-150` |
| Ownership check | `get_organization` + `get_own_organization` + `AccessDeniedException` | `src/backend/app/organizations/service.py:62-95,152-173` |
| Status enum and moderation decision recording | `ModerationStatus`, `_record`, `_set_photo_files_public` | `src/backend/app/moderation/status.py`, `service.py` |
| Background job lifecycle | Existing `AsyncIOScheduler` (misfire/coalesce defaults) | `src/backend/app/main.py:101-117` |
| Error envelopes | `BusinessConflictException` (409), `AccessDeniedException` (403), `EntityNotFoundException` (404), `ValueError` handler (400), `IntegrityError` handler | `src/backend/app/core/errors.py` |
| Authorization | Matrix row 50 (POST/PATCH/DELETE `/api/organizations(/.*)?` → EDIT), row 48 public slug | `src/backend/app/core/authorization_matrix.py:189-195` |
| Query-count helper | `count_queries(engine)` | `src/backend/tests/conftest.py:80` |
| SPA meta preview (second `PublicOrganizationResponse` caller; must keep working via defaults, R9) | `public_organization_preview` | `src/backend/app/system/router.py:110-125`; `tests/test_public_preview.py` |
| Pre-lock scalar lookup before a row lock | `delete_photo_as_admin` | `src/backend/app/product/service.py:461-471` |
| Upload-disabled copy | `PHOTO_UPLOAD_DISABLED_MESSAGE` | `src/backend/app/product/service.py:409` |
| Fixed light text token for the cover | `--color-on-ink` (`text-on-ink`), `--color-scrim` | `src/frontend/src/index.css:43,48` |
| Fake storage for tests | `cdn.test` public / `origin.test` signed | `src/backend/tests/fake_storage.py` |
| Cron subject registry and grants contract | `_moderated_table`, `Subject`, `SUBJECTS`, `REQUIRED_PRIVILEGES` | `group-thing-ai/app/photo_store.py:79-115`; `scripts/moderation_db_role.sql` |
| Photo thumbnails with fallback | `SafeImage` | `src/frontend/src/pages/product/ItemGallery.tsx` |
| Status badge, file picker, row markup, focus after move | `ModerationBadge`, `PhotoFileField`, row pattern | `src/frontend/src/pages/product/ItemGalleryEditor.tsx` |
| Client file checks | `ACCEPTED_PHOTO_TYPES`, `MAX_PHOTO_BYTES`, `photoFileError` | `src/frontend/src/pages/product/itemPageShared.ts` |
| Polling while pending | `refetchInterval` pattern | `src/frontend/src/hooks/useItemDetail.ts:24-53` |
| Mutation and invalidation pattern | `useUpdateOrganization` | `src/frontend/src/hooks/useUpdateOrganization.ts` |
| Query keys | `MY_ORGANIZATION_KEY`, `PUBLIC_ORGANIZATION_KEY` | `src/frontend/src/hooks/useMyOrganization.ts`, `usePublicOrganization.ts` |
| Multipart client | `api.upload(FormData)` | `src/frontend/src/api/client.ts:101` |
| Block pipeline | `BLOCKS`, ghost logic, registry, `GhostBlock`/`GHOST_COPY` | `src/frontend/src/pages/organizer/LayoutRenderer.tsx`, `layouts/registry.ts`, `blocks/GhostBlock.tsx` |
| Tabs, roving focus, section label | `EditorSheet`, `rovingIndex.ts`, `SECTION_LABEL` | `src/frontend/src/pages/organizer/editor/` |
| Admin card and page | `PhotoModerationCard`, `PhotoModerationPage` | `src/frontend/src/components/moderation/`, `pages/PhotoModerationPage.tsx` |

### New Components Required
| New | Why existing code cannot be reused |
|---|---|
| `organization_media` table + `OrganizationMedia` / `MediaKind` | A new entity. It is kept out of `organizations` so uploads never bump the organization's optimistic-lock column. It needs several rows per slot (approved + pending), which neither the single-row avatar nor the product table models. |
| `app/organizations/media.py` (upload, delete, reorder, read models, retire, sweep, decide hook) | Product/avatar services are bound to their parents and ownership rules. Slot semantics, retire and the takedown guarantee are new behaviour. Keeping it out of `service.py` keeps that file focused (HLD l.216). |
| Media schemas (`PublicMediaResponse`, `OwnerMediaResponse`, `MyOrganizationResponse`, `ReorderOrganizationMediaRequest`) | New response shapes. `MyOrganizationResponse` stops `POST`/`PATCH` from needing storage. |
| Sweep job | The cron cannot retire superseded rows (it only transitions the claimed PENDING row). Decision C-2. |
| Moderation subject map | Replaces the hard-coded two-way dispatch that would misroute a third subject. It is a refactor, not an extra layer. |
| `GalleryBlock.tsx`, `PhotosTab.tsx` (with `PhotoSlot`, `GallerySection`), `useOrganizationMedia.ts`, `HeroLogo` inner helper | No equivalent UI exists. Each is assembled from the reusable pieces above. |

Not introduced, on purpose:
- a `ModeratedImageMixin`;
- a generic media service shared with products;
- a CDN purge;
- a public media sub-route (it would need a matrix row);
- a lightbox.

---

## Technical Approach

### Data flow
1. The owner opens the Zdjęcia tab (gear icon `?edit=1`, then the tab; or the gallery ghost CTA `?edit=1&tab=zdjecia`). The tab reads `media` from `/mine`.
2. Upload: client check (`photoFileError`), then `POST …/media?kind=`. On the server: ownership → process → put (private when moderated) → org row lock → dedup/limit/replace → insert → (retire if approved) → commit. Then invalidate both organization queries.
3. Cron (VPS B): claims PENDING `organization_media` rows `FOR UPDATE SKIP LOCKED`, classifies `{storage_key}/w1600.webp`, sets APPROVED (+ public ACL), NEEDS_REVIEW or REJECTED, and writes a `moderation_decisions` row with `ORGANIZATION_MEDIA`.
4. The tab polls `/mine` every 10 s while it is mounted and anything is PENDING or NEEDS_REVIEW; when a poll changes a media status, the public organization query is invalidated so the page behind the sheet updates (R21). The public page reads `/public/{slug}`, which picks the newest APPROVED logo/cover and the APPROVED gallery.
5. The sweep (every 15 min) deletes superseded logo/cover rows left behind by cron approvals.
6. Admin: the existing photo moderation page lists org media (title with kind) and can approve, reject (takedown → slot empty) or delete.

### Read rules summary
| Viewer | LOGO / COVER | GALLERY | URLs |
|---|---|---|---|
| Visitor and owner on the page (`/public/{slug}`) | Newest APPROVED or `null` | APPROVED by `sort_order` | Public CDN |
| Owner in the Zdjęcia tab (`/mine`) | Non-superseded rows: ≤1 APPROVED, ≤1 PENDING/NEEDS_REVIEW, newer REJECTED | All rows incl. REJECTED | APPROVED public, the rest presigned (600 s) |
| Admin (`/api/moderation/photos`) | Every row, any status | Every row | APPROVED public, the rest presigned |

### Query-count expectations
- `GET /api/organizations/public/{slug}`: exactly **2** statements (organization, media), identical for 0 and 3 gallery items plus logo and cover. **1** statement when storage is unconfigured.
- `GET /api/organizations/mine`: +1 statement over today (the media list), constant in the number of media.
- `GET /api/moderation/photos`: still one page query, one total query per subject (now three), and one decisions query.

### Concurrency
- Every app-side media mutation (upload after the S3 put, delete, reorder, admin delete/decide on org media) takes `SELECT organizations.id … FOR UPDATE` first, so the limit, dedup, one-pending slot and dense order hold. Lock order: organization, then media rows. For admin `decide` on org media, `descriptor.lock_parent` looks up `organization_id` with a Core scalar select (no ORM load) and locks the organization, then `db.get(…, with_for_update=True)` locks the media row; `previous_status` comes from that locked row (R16).
- **The cron is not covered by the organization lock.** It claims (`FOR UPDATE SKIP LOCKED`) and finalizes (`WHERE status='PENDING' AND moderation_attempts=…`) in its own short transactions and can approve or reject a PENDING row at any time. App-side deletes therefore never decide on a pre-read status: replace deletes carry the status predicate, and delete-by-id decides from `RETURNING status` (R5.2, R7, R14).
- The DB-level `uq_organization_media_one_pending_per_slot` and per-kind unique are a race backstop. An `IntegrityError` maps to 409 through the existing handler.
- The sweep takes no organization lock. Its subquery selects `ORDER BY id … FOR UPDATE SKIP LOCKED`, so it skips rows an owner/admin transaction holds and cannot deadlock with it (R12). A rare overlap with an owner request touching the same superseded row leads to a 404, or a no-op, on the owner side.

### Deploy order (R-Deploy)
1. Deploy the **app** (backend and frontend) and run `alembic upgrade head` (0054). From here on, uploads work. With `MODERATION_IMAGE_ENABLED=true`, org media waits PENDING (fail closed) and admins can approve manually.
2. Re-run `group-thing-ai/scripts/moderation_db_role.sql` as the DB owner (grants on `organization_media`) **with the current cron password** as `cron_password`. The script always runs `ALTER ROLE … PASSWORD`, so passing a new value rotates the password under the still-running two-subject cron and its new connections fail. If a rotation is intended, update `.env.cron` and restart the cron immediately (or do step 3 at once) (audit M3).
3. Deploy the **cron** with the third subject.

**Warnings:**
- Deploying the cron before step 2 makes its `check_requirements()` refuse to start. That stops **all** image moderation, product photos and avatars included.
- Running step 2 with a different password than `.env.cron` stops all moderation until `.env.cron` is updated and the cron restarted (same warning in the README, R19).

### Rollback
- **Cron only:** redeploy the previous (two-subject) cron at any time. Org media then stays PENDING.
- **App:**
  1. First stop the cron or roll it back to the two-subject version.
  2. Run `alembic downgrade 0053` **with the new app image** (the only image that contains `0054_organization_media.py`), before redeploying the old one (audit L8). The old image cannot do it: `docker-compose.yml:43` runs `alembic upgrade head` at start, and with the DB at revision 0054 and no 0054 file the old image fails to start. **The downgrade destroys data:** it drops `organization_media` (every organization's logo, cover and gallery rows) and its grants. Files under `organizations/` in Spaces become orphans; delete them manually with the Spaces console or CLI if needed.
  3. Redeploy the previous app.
- `moderation_decisions` rows with `ORGANIZATION_MEDIA` remain as audit. The previous app never loads them, because it loads decisions only by subject ids of photos and avatars.

---

## Implementation Guidance

### Testing Approach
- Write 2-8 focused tests per implementation step group. Test verification runs only the new and affected tests, not the entire suite.
- Backend testing is integration-first: pytest with TestContainers Postgres (`alembic upgrade head`), `FakeStorage`, monkeypatched `settings.moderation_image_enabled`, and `count_queries`.
- Test names follow `test_action_condition_expectedResult`, as in `tests/test_product_photos.py`.
- Frontend: Vitest with Testing Library in `src/test/`; `vi.mock` API modules; `createQueryWrapper()`.

Proposed groups (each 2-8 tests):

| Group | Location | Tests (examples) |
|---|---|---|
| BE-1 images move | existing tests | Existing product photo and avatar tests pass with the new import path (no new tests) |
| BE-2 migration | `tests/test_organization_media_migration.py` | Upgrade creates the table and 4 indexes/constraints; downgrade removes them; cron columns match `profile_avatars` names and types; partial unique rejects a 2nd PENDING LOGO but allows 2 PENDING GALLERY |
| BE-3 upload + limits | `tests/test_organization_media.py` | Gallery upload with moderation on → 201 PENDING, private files, appended sort_order; invalid/too large → 400, nothing stored; same file twice in GALLERY → 409 but same file as LOGO and GALLERY → 201; 4th non-rejected → 409 while a REJECTED does not count; storage `None` → 409 upload and empty public media; non-owner EDIT → 403, unknown org → 404, anonymous → 401 |
| BE-4 slot semantics | same file | Approved logo stays in public read while a new upload is PENDING; a second upload replaces the pending row and stages its keys; upload clears a REJECTED row and a re-upload of the rejected sha → 409; moderation off → APPROVED immediately and the older approved row is deleted with an outbox entry; **L2:** after a simulated cron approval leaves a superseded APPROVED logo (no sweep run), re-uploading that superseded file → 201 (retired before dedup), not 409 |
| BE-5 delete/reorder | same file | Deleting the middle gallery photo renumbers and writes the outbox; reorder permutation → 200, stale/duplicate/rejected-id list → 409 Polish message; deleting the approved logo while an older approved row exists → public logo `null` and the older row deleted; **race simulation (H2):** with an older APPROVED logo A and a PENDING logo P, flip P to APPROVED with a Core UPDATE after the service's read (monkeypatch hook) or before calling `_delete_media`, then (a) owner delete of P → A is retired and public logo is `null`; (b) a replace upload → P is **not** deleted and stays the public logo |
| BE-6 read models + query budget | same file (or `tests/test_organization_media_queries.py`) | Public response has only approved, newest per slot, ordered gallery, CDN URLs; `/mine` shows pending/rejected with signed URLs and excludes superseded rows; public endpoint statement count is 2 for 0 and 3 gallery items (+logo/cover); **H1:** `tests/test_public_preview.py` stays green and the `/{slug}` HTML preview issues no `organization_media` query (count_queries) |
| BE-7 sweep + takedown | same file | Sweep deletes APPROVED/REJECTED logo rows older than the newest approved, stages files, leaves pending and gallery; a second run is a no-op (no outbox row); admin reject of the newest approved logo → public logo `null` and the older approved row gone, still `null` after a sweep |
| BE-8 moderation | `tests/test_moderation.py` (+ a new `tests/test_organization_media_moderation.py` if clearer) | `/moderation/photos` lists org media with org name, `media_kind` and the total including it; decide APPROVED/REJECTED on org media flips the ACL and records `ORGANIZATION_MEDIA`; **M1:** decide after a cron-style Core UPDATE that bumped the row's `updated_at` (and status/attempts) succeeds with no 409 and uses the locked row's status as `previous_status`; delete by id routes to org media; existing PHOTO/AVATAR tests remain green (regression) |
| BE-9 authorization | `tests/test_authorization_matrix.py` | POST/PATCH/DELETE `…/media…` → EDIT; GET `/public/{slug}` stays PUBLIC |
| AI-1 cron contract | `group-thing-ai/tests/test_photo_store.py`, `test_deploy_artifacts.py`, `test_moderation_cron.py` | SUBJECTS = 3 with the ORGANIZATION_MEDIA table/type/label; column parity across all 3; REQUIRED_PRIVILEGES has `organization_media` SELECT/UPDATE; SQL grants parse equal to REQUIRED_PRIVILEGES; run_tick alternates photo, avatar, org media within a batch (parametrized like the existing 2-way case) |
| FE-1 public blocks | `src/test/organizerMediaBlocks.test.tsx` | Hero shows the logo `img` in all 3 variants and initials on error; cover only in `cover`; **M2:** the `cover` variant with a cover image renders name/address with the fixed light class (`text-on-ink`), not `text-on-primary`, with a SUN-like palette, and falls back to `text-on-primary` after an image error; GalleryBlock 1/2/3 layouts and alt text; LayoutRenderer hides an empty gallery for visitors and shows the ghost with CTA `?edit=1&tab=zdjecia` for the owner without waiting for the directory; registry has `gallery` right after `about` in all 5 layouts (`layoutPositions.test.ts`) |
| FE-2 editor tab | `src/test/OrganizerEditor.test.tsx` (extend) or `OrganizerPhotosTab.test.tsx` | `?tab=zdjecia` opens the Zdjęcia tab; **M5:** with the sheet open on Układ, clicking the gallery ghost CTA switches to Zdjęcia, and closing removes both `edit` and `tab`; upload calls the API and leaves Zapisz disabled (draft not dirty); slot states S3/S5/S6 copy; gallery 3/3 disables add and REJECTED is not counted; move sends the full id list; server 409 shown in `role="alert"`; invalid file shows the client error without calling the API |
| FE-3 hooks | `src/test/useOrganizationHooks.test.tsx` | Media mutations invalidate both keys on success and failure; `useMyOrganization({ pollPendingMedia: true })` polls while PENDING/NEEDS_REVIEW and stops when approved, and without the option it never polls (L7); **M4:** a poll result that changes a media status (PENDING → APPROVED) invalidates `[PUBLIC_ORGANIZATION_KEY]`, an unchanged result does not |
| FE-4 admin | `src/test/PhotoModerationPage.test.tsx` | Org media card title "Organization · X · Logo"; decide posts `subject_type: "ORGANIZATION_MEDIA"` |

### Standards Compliance
- **`standards/global/minimal-implementation.md`:**
  - no mixin and no generic media service;
  - no width/height columns;
  - the sweep interval is a constant;
  - the gallery row markup is copied rather than adding configuration to `ItemGalleryEditor`.
- **`standards/global/error-handling.md`, `validation.md`:** server-side validation (`process_upload`, enum `kind`, permutation check); typed exceptions mapped centrally; specific Polish messages; client checks are only a convenience.
- **`standards/backend/models.md`:**
  - `BaseEntity` with a UUID PK; the doc's explicit-sequence wording is outdated since 0041, so this follows 0051;
  - string-backed non-native enums;
  - business-key equality on `storage_key`;
  - FK columns without `relationship()`.
- **`standards/backend/migrations.md`:** one small reversible migration, explicit constraint/index names, operator notes in the docstring. The PK uses UUID per 0051, not a sequence.
- **`standards/backend/queries.md`, `jooq.md`:** bound parameters only; constant statement counts; explicit ordering; Core DELETE … RETURNING / UPDATE for concurrent-safe writes; enforced LIMIT in the sweep.
- **`standards/backend/security.md`:** coarse EDIT via `AUTHORIZATION_MATRIX` row 50 (no change, PATCH not PUT), and a fine-grained ownership check in the service. The public data is narrow (URLs only).
- **`standards/backend/api.md`:** plural resource `media` nested one level under the organization; 201/204/200 semantics.
- **`standards/frontend/data-fetching.md`:** TanStack hooks in `src/hooks`, prefix invalidation awaited, verbatim problem messages, polling via `refetchInterval`.
- **`standards/frontend/components.md`, `css.md`, `accessibility.md`, `responsive.md`:**
  - role tokens only;
  - 44px targets, `role="alert"`, `aria-busy`, alt rules, roving tabs;
  - mobile-first 430px column.
- **`standards/testing/backend-testing.md`, `frontend-testing.md`:** integration-first, 2-8 tests per group, `src/test/` placement, `vi.resetAllMocks` in `beforeEach`.
- **Standards evolution (suggest to the user):** `models.md`/`migrations.md` still describe explicit-sequence PKs although every table since 0041 uses UUID PKs. Suggest updating them via `/maister:standards-update`.

---

## Out of Scope
- `og:image` / `twitter:card summary_large_image` / `theme-color` from the cover (the rest of D2).
- Lightbox or click-to-enlarge, drag-and-drop reordering, upload progress percentage, crop/focal-point editing.
- CDN purge on takedown. The one-year immutable cache is accepted at parity with products and avatars (I-4).
- Task C content (tagline, bio, location, links) and its "Treść" tab.
- A panel (`/panel`) shortcut to photos; a confirmation dialog on delete.
- Showing pending media in the hero for the owner (I-9).
- Changes to `list_queue` (`/api/moderation/queue`), product photos or avatars beyond the shared refactors (R1, R15, R28).
- Gallery larger than 3, and per-layout gallery variants other than `grid`.

## Known Limitations
- **Orphaned files on crash.** A crash between `storage.put` and commit can orphan files (parity with products and avatars; no sweep of storage objects).
- **Cached URLs after takedown or delete.** Taken-down or deleted files can remain reachable by direct CDN URL until the cache expires (I-4).
- **Stale rejected thumbnails.** Presigned URLs expire after 600 s. REJECTED thumbnails in a Zdjęcia tab left open without polling fall back to the `SafeImage` placeholder until the next refetch.
- **Cron/delete overlap.** If the owner deletes or replaces a PENDING row while the cron is classifying it, the cron's guarded finalize affects 0 rows. Files the cron already made public are removed by the outbox shortly after (parity). If the cron commits APPROVED first: a replace leaves the just-approved row in place (status predicate), and an explicit owner "Anuluj"/"Usuń" deletes it as the owner asked and retires the older rows from the returned status, so the slot never falls back to an older image (R14).
- **Admin re-approval edge case.** An admin re-approving an older taken-down row while a newer approved row exists has no visible effect; the sweep later removes it. This is acceptable: the newest approved image always wins.

## Success Criteria
1. Owner uploads a logo with moderation on: the Zdjęcia tab shows "W weryfikacji" while the public hero keeps the previous approved logo (or initials). After a cron or admin approval, the new logo is public and the old row disappears within one sweep interval, immediately for admin approval.
2. With moderation off, an upload is public immediately and the previous approved image is deleted in the same transaction.
3. An admin takedown of the current logo leaves the hero on initials. No older logo ever reappears (verified by test, including after a sweep).
4. Gallery: max 3 non-rejected photos; duplicates and a 4th upload → 409 with the Polish messages; reorder persists; visitors see only approved photos in order; an empty gallery is hidden for visitors and shown as a ghost with a working CTA for the owner, in all 5 layouts.
5. `GET /api/organizations/public/{slug}` issues exactly 2 SQL statements regardless of the number of media, and returns empty media without error when storage is unconfigured.
6. The admin photo moderation page lists organization media as "Organization · {name} · {Kind}"; approve, reject and delete work; PHOTO and AVATAR behaviour is unchanged (existing tests green).
7. The cron moderates `organization_media` rows (3-way round-robin). Deploy-artifact tests pass with the updated grants. Following the deploy order (step 2 with the current cron password) never stops product photo or avatar moderation.
8. Photo actions in the editor never mark the draft dirty or trigger the unsaved-changes guard.
9. All new tests pass. `uv run python -m mypy app` shows no new errors over the baseline; ruff and the frontend lint/type-check pass.
10. The `/{slug}` HTML meta preview keeps working (no 500, no media query), and an older logo/cover never resurfaces even when the cron approves a row concurrently with an owner delete or replace (race-simulation test).

## Suggested Commit Split
1. **group-thing-app, refactor:** move `app/product/images.py` → `app/storage/images.py` (R1).
2. **group-thing-app, backend:** model, migration 0054, `organizations/media.py`, routes, schemas (with defaulted media fields, R9), sweep job, moderation subject map, backend tests (R2-R16), plus doc notes (R30). Touched/verified: `app/organizations/{models,schemas,router,media}.py`, `app/moderation/{service,schemas}.py`, `app/main.py`, and `app/system/router.py` (second `PublicOrganizationResponse` caller; verified unchanged in behaviour by `tests/test_public_preview.py`, edited only if needed).
3. **group-thing-app, frontend:** API/hooks, HeroBlock (+ scrim token in `index.css`), GalleryBlock, registry/LayoutRenderer/GhostBlock, EditorSheet + PublicOrganizationPage (R25a) + PhotosTab, shared props, admin card, frontend tests (R20-R29).
4. **group-thing-ai:** Subject, grants SQL, README, tests (R17-R19). Merge or deploy only after commit 2 is deployed and the grants SQL is re-run (R-Deploy).

## Audit Resolutions
Findings from `verification/spec-audit.md` (2026-10-10) and where they were applied.

| ID | Resolution | Spec sections changed |
|---|---|---|
| H1 | Media fields on `PublicOrganizationResponse` default to `None`/`[]`; the API router fills them explicitly; `app/system/router.py` preview keeps `model_validate(org)` and does no media query | R9; Reusable Components; Testing BE-6; Success Criteria 10; Commit Split 2 |
| H2 | Replace delete is status-predicated; `_delete_media` uses `DELETE … RETURNING status, kind, created_at, id, storage_key` and retires based on the returned status; rule stated in R14 | R5.2, R7, R13 Guarantee, R14, Concurrency, Known Limitations (Cron/delete overlap), Testing BE-5, Success Criteria 10 |
| M1 | Descriptor fields listed (`model`, `admin_delete`, `list_branch`/`count`, optional `lock_parent`, optional `after_decide`); Core scalar pre-lock lookup; `previous_status` from the locked row | R15, R16, Concurrency, Reusable Components, Testing BE-8 |
| M2 | Cover with image: fixed `text-on-ink` regardless of palette and a ≥0.7-alpha solid scrim stop behind the text | R22, Visual Design (`component:hero-media`), Reusable Components, Testing FE-1, Commit Split 3 |
| M3 | Deploy step 2 uses the current cron password (or rotate + immediate `.env.cron` update and cron restart); README warning | Deploy order, R19, Success Criteria 7 |
| M4 | Poll results that change a media status invalidate `[PUBLIC_ORGANIZATION_KEY]` | R21, Data flow step 4, Testing FE-3 |
| M5 | EditorSheet tab follows the `tab` search param (pills write it); `closeEditor` deletes `tab`; PublicOrganizationPage passes `owner.id`/`owner.media` | R25, new R25a, R26, Visual Design, Testing FE-2, Commit Split 3 |
| L1 | Sweep subquery `ORDER BY id … FOR UPDATE SKIP LOCKED` | R12, Concurrency |
| L2 | Per-slot retire before dedup; "Superseded duplicate window" limitation removed | R5.0, R13 (e), Known Limitations, Testing BE-4 |
| L3 | `media_kind: MediaKind \| None = None`, last field of frozen `QueueEntry` | R15 |
| L4 | ORM status write in `decide` noted as the exception to Core-only writes | R14 |
| L5 | Stale "two subjects" docstrings and README sections listed; org-media smoke step | R19 |
| L6 | Every REJECTED row of a slot listed newest first, each with "Usuń" | R10, R26 (S6) |
| L7 | Polling only via `useMyOrganization({ pollPendingMedia: true })` from the mounted PhotosTab | R21, R26, Data flow step 4, Testing FE-3 |
| L8 | Downgrade runs with the new image before redeploying the old one; data-destroying | Rollback |
| L9 | W1-R2 marked resolved in `code-review-report.md` | R30 |
| L10 | Reuse `PHOTO_UPLOAD_DISABLED_MESSAGE` (no trailing period) | R4 step 2, Reusable Components |
| L11 | Order: R5.2 DELETE → `db.add` + `flush` → retire with flushed values | R5.3, R5.4 |

All findings were applied. None conflicts with `requirements.md`, `scope-clarifications.md` or `clarifications.md`. L7 matches requirement 6 ("Zdjęcia tab polls every 10 s").
