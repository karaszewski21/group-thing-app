# Gap Analysis: D — Zdjęcia organizacji (logo, okładka, galeria)

## Summary
- **Risk Level**: Medium-High
- **Estimated Effort**: High (about 25-30 files, 2 repos, both stacks; each piece copies an existing template)
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy
- **Change type**: additive for organizations; modificative for the shared moderation pipeline (2-subject dispatch becomes 3-subject). **Compatibility**: strict for the moderation pipeline and the cron column/grant contract; moderate for the public organizer response (additive fields only).

Inputs: `analysis/codebase-analysis.md`, `analysis/clarifications.md`, research §10.3 / HLD l.748-770, plus direct verification in both repos (findings below cite files).

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (moderation service/schemas/admin UI, organizations router/schemas, HeroBlock, LayoutRenderer, registry, EditorSheet, cron SUBJECTS + grants)
- Creates new entities: yes (`organization_media` table/model, `MediaKind`, `ModerationSubjectType.ORGANIZATION_MEDIA`, GalleryBlock, "Zdjęcia" tab, cron Subject)
- Involves data operations: yes (CREATE upload, READ public/owner, UPDATE reorder + moderation status, DELETE owner/admin)
- UI heavy: yes (hero in 3 variants, new block in up to 5 layouts, editor tab, admin card)

## Corrections to the codebase analysis (verified)
1. **Admin FE already uses `subject_type`**: `PhotoModerationCard.tsx:37` derives the title from `entry.subject_type === "AVATAR"`, and `PhotoModerationPage.tsx:65` passes `entry.subject_type` to decide. The real FE gap is only the union `"PHOTO" | "AVATAR"` in `api/moderation.ts:5` and the title branch for the third subject.
2. **The real silent-misroute hazard is backend `delete_upload`** (`moderation/service.py:291-297`): admin `DELETE /api/moderation/photos/{id}` carries no subject type; anything not a ProductPhoto falls into `users_service.delete_avatar_as_admin`, which would raise 404 for an organization media id. `decide` (l.267) misroutes anything non-AVATAR to `ProductPhoto` (404). Both must become a subject map; `delete_upload` must probe three tables (or the route must take a subject type).
3. **Statement-budget test does not cover the endpoint we change**: `test_organizer_page_queries.py` measures `/api/groups/public/organizers/{slug}` and group-access endpoints, not `/api/organizations/public/{slug}`. Embedding media in `PublicOrganizationResponse` therefore needs its own new constant-statement test (0 vs 3 gallery items), not an edit to the existing one.
4. **Owner route prefix**: the existing owner read is `GET /api/organizations/mine` and the existing mutation is `PATCH /api/organizations/{organization_id}` (router.py l.42, l.64). Research proposed `/{id}/media`, the codebase analysis `/me/media`. Either is covered by matrix row 50; see decision I-7.
5. **The owner's page renders the public response**: `PublicOrganizationPage.tsx:30` renders from `usePublicOrganization(slug)`; ownership comes from `useMyOrganization()` (l.38-45). So the owner's hero shows only APPROVED media (same as visitors). Pending/rejected state must come from the owner response (`OrganizationResponse` from `/mine`) and be shown inside the "Zdjęcia" tab, not in the hero.
6. **Gallery limit is 3** (clarification #4), superseding research's ≤12 and the codebase analysis's suggested 10.

## Current vs Desired State

| Area | Current | Desired |
|---|---|---|
| DB | No media for organizations; latest revision 0053 | `0054_organization_media.py`: UUID PK, 8 cron columns identical to `_moderated_table` (`group-thing-ai/app/photo_store.py:79-93`), plus organization_id, kind, width/height/size_bytes, sort_order, uploaded_by_user_id; status index, partial claim index `(created_at,id) WHERE status='PENDING'`, `(organization_id, kind, status)` index, partial unique one-pending-per-slot |
| Backend organizations | `get_public_organization` = plain `model_validate`, no storage | Embedded `logo`, `cover`, `gallery[]` in `PublicOrganizationResponse` (APPROVED only, public URLs, one query); owner media with status/id/sort_order in `/mine` response; POST/DELETE/PATCH-order routes |
| Moderation (app) | `ModerationSubjectType` PHOTO/AVATAR/PRODUCT_TEXT; 4 hard-coded 2-way dispatch points; `Literal[PHOTO, AVATAR]` in `schemas.py:37` | `ORGANIZATION_MEDIA` (18 chars, fits `String(20)` in `moderation_decisions.subject_type`, migration 0046 l.81); subject → model map for `_set_photo_files_public`, `list_photos` (3rd union branch + count), `decide`, `delete_upload` |
| Cron (group-thing-ai) | `SUBJECTS = (PRODUCT_PHOTO, PROFILE_AVATAR)` | Third `Subject(_moderated_table("organization_media"), "ORGANIZATION_MEDIA", "organization photo")`; grants in `moderation_db_role.sql`; tests pinning SUBJECTS / REQUIRED_PRIVILEGES / 3-way alternation |
| Public page FE | HeroBlock renders initials only (comment: "cover has no image yet"); no gallery block | Hero renders cover/logo with initials fallback; `gallery` BlockId + GalleryBlock + ghost copy; slots in chosen layouts |
| Editor FE | Tabs "Układ" / "Kolory" (draft + Zapisz) | Third tab "Zdjęcia", mutations immediate, outside draft/dirty diff and outside the `useBlocker` unsaved-changes guard |
| Admin FE | Union `PHOTO | AVATAR`; title branch for AVATAR | Third subject label (English, e.g. `Organization · {name}`), kind visible (logo/cover/gallery) |

## Gaps Identified

### Missing Features
- `organization_media` table, model, `MediaKind` StrEnum (LOGO/COVER/GALLERY) — nothing exists.
- Upload/delete/reorder routes and service functions (with ownership check via `get_own_organization`, storage-None → 409, `process_upload` limits, sha dedup, gallery limit 3, parent lock without version bump).
- Public and owner media read models.
- Third moderation subject in app and cron.
- GalleryBlock, "Zdjęcia" tab, hero image rendering.
- Cleanup of superseded APPROVED logo/cover rows (the cron cannot retire them; verified: cron only flips `status` + ACL on the claimed row).

### Incomplete Features
- Moderation pipeline: generic in concept, hard-coded to 2 subjects in 4 places (app) + SUBJECTS tuple (cron).
- HeroBlock: `cover` variant is a primary-color band placeholder awaiting an image.

### Behavioral Changes Needed
- `PublicOrganizationResponse` grows additive fields (`logo`, `cover`, `gallery`); `get_public_organization` gains a Storage dependency (must tolerate `get_storage() is None` → media null/empty, page still renders).
- `delete_upload` / `decide` change from if/else to a map (behavior for PHOTO/AVATAR must stay identical — strict compatibility; existing `test_moderation*` / `test_photo_moderation_*` act as the regression net).

## User Journeys

### J1. Owner uploads a logo (first time)
1. Owner opens own page → "Edytuj wygląd" → tab "Zdjęcia" → slot "Logo" → picks file (client check: type/size via `itemPageShared.ts` helpers).
2. `POST …/media?kind=LOGO` (multipart). Server: ownership, `process_upload`, storage put (private when moderation on), insert PENDING row.
3. Tab shows the thumbnail (presigned URL) with badge "W weryfikacji"; tab polls (10 s pattern from `useItemDetail.ts`) while PENDING/NEEDS_REVIEW.
4. Public hero still shows initials (no approved logo). Cron approves → row APPROVED + ACL public → next public fetch shows logo.
- With `moderation_image_enabled=false`: row is APPROVED immediately and public (avatar/product parity).

### J2. Owner replaces a logo/cover (variant B)
- Old APPROVED stays public; new row PENDING. A second upload while one is pending replaces the pending row (files staged for outbox delete). After approval, the newest APPROVED wins at read time; the older APPROVED row becomes superseded and must be cleaned (see decision C-2).

### J3. Owner deletes logo/cover
- Ambiguity: which row does "Usuń" act on when an APPROVED and a PENDING row coexist? Proposed: each displayed row has its own "Usuń" (approved one = "Usuń z strony", pending one = "Anuluj"). Deleting the approved logo reverts the hero to initials (or to an older approved one if lazy cleanup has not run — must not happen; cleanup must be eager enough or the read rule must ignore rows older than a deleted one). See C-2.

### J4. Owner manages gallery (max 3)
- Upload → PENDING item at end of order; visitors see only APPROVED items in sort_order; duplicate sha → 409 "To zdjęcie jest już w galerii"; 4th non-rejected item → 409; up/down reorder via `PATCH …/media/order` with full id permutation (stale → 409); delete renumbers.

### J5. Rejected / needs-review states (owner)
- NEEDS_REVIEW: shown like PENDING ("W weryfikacji"), keeps polling (template's gap: NEEDS_REVIEW does not poll — fix here).
- REJECTED: currently products hide REJECTED from owners entirely (`product/service.py:391`); avatars show status. Owner experience must be decided (I-3).

### J6. Visitor views the page, per layout
| Layout | Hero variant | Logo | Cover | Gallery (proposed) |
|---|---|---|---|---|
| CLASSIC | `cover` | yes (replaces initials circle) | yes (background band, overlay for text contrast) | yes, after `about` |
| CIRCLES | `cover` | yes | yes | yes, after `about` |
| SCHEDULE | `compact` | yes (56px circle) | no (no room in a top bar) | decision C-1 |
| EXCHANGE | `compact` | yes | no | decision C-1 |
| LINKS | `centered` | yes (80px circle) | no / optional banner | decision C-1 |

Rules: visitors never see ghosts; empty gallery returns nothing for visitors and a ghost ("Galeria" + body "Widzisz to tylko Ty", CTA opens the "Zdjęcia" tab, not a panel route) for the owner. `GhostBlock` CTAs today are router `Link`s to `/panel/...`; a CTA that opens the editor tab is new (`?edit=1` + tab param, or omit the CTA). Gallery is not a `directory` block (data comes from the organization response), so no skeleton/unavailable handling. Layout-switch implication: an owner who uploads a cover and uses SCHEDULE sees no effect — the tab should say where cover is shown.

### J7. Admin moderation
- Organization media appear in `GET /api/moderation/photos` (3rd union branch; `product_name` carries the organization name, `product_id` null). Admin approve/reject (incl. takedown of an APPROVED logo) via `decide`; delete via `delete_upload`. Takedown of the current logo → public read falls back to the previous APPROVED row if it still exists (possibly undesirable — reinstating an older image the owner replaced) or to initials. Tied to C-2.

### J8. Cron processing
- Claims PENDING `organization_media` rows `FOR UPDATE SKIP LOCKED`, classifies `{storage_key}/w1600.webp` (+w400), finalizes status + ACL, writes `moderation_decisions` with `subject_type='ORGANIZATION_MEDIA'`. Never touches other rows → slot retirement is app-side.

## Data Lifecycle Analysis

### Entity: organization_media

| Operation | Backend | UI | Access | Status |
|---|---|---|---|---|
| CREATE | Missing (new POST route; matrix row 50 covers POST) | Missing ("Zdjęcia" tab, reuse `PhotoFileField`) | Missing (tab in EditorSheet, opened from owner settings button) | Planned (all 3 layers in scope) |
| READ (visitor) | Missing (embed in `PublicOrganizationResponse`, row 48 PUBLIC) | Missing (HeroBlock image, GalleryBlock) | Existing route/page `PublicOrganizationPage` | Planned |
| READ (owner, incl. pending/rejected) | Missing (`/mine` response or media list) | Missing (tab) | Tab | Planned |
| READ (admin) | Partial (queue union lacks 3rd branch) | Existing card (needs label) | Existing PhotoModerationPage | Planned |
| UPDATE (reorder) | Missing (PATCH order; row 50) | Missing (up/down buttons) | Tab | Planned |
| UPDATE (status) | Cron + admin `decide` (needs map) | Admin card | Admin page | Planned |
| DELETE (owner) | Missing | Missing ("Usuń" per item) | Tab | Planned |
| DELETE (admin) | Partial (`delete_upload` misroutes) | Existing button | Admin page | Planned |

**Completeness (planned scope)**: 100% if all planned rows ship — no orphaned operation is designed in. **Risk of orphaning**: if FE gallery block slots are omitted from some layouts while upload is allowed, gallery photos are CREATE-without-READ for visitors of those layouts (C-1). Same for cover in compact/centered heroes.

### Storage object lifecycle
| Event | Files | Current template behaviour | Gap |
|---|---|---|---|
| Upload | put w1600 + w400 (private if moderated) before commit; on DB failure delete | avatar: delete on exception | Crash between put and commit leaves orphans (no sweep) — accepted parity unless sweep added |
| Replace pending | old pending files → OBJECTS_DELETE outbox | avatar pattern | OK |
| Approve | `set_public` both renditions; immutable 1y CDN cache | same | — |
| Superseded approved | not handled anywhere | n/a | Needs cleanup policy (C-2) |
| Reject (cron/admin) | ACL private, files kept forever | same for products/avatars | Policy (I-2) |
| Owner/admin delete | row delete + OBJECTS_DELETE | same | OK; CDN copy persists up to 1y (I-4) |

## Integration Points
1. `src/backend/alembic/versions/0054_organization_media.py` (new; template 0051 incl. operator docstring).
2. `src/backend/app/organizations/{models,schemas,service,router}.py` (model, media schemas, service, routes; Storage dep on public read).
3. `src/backend/app/moderation/{models,service,schemas}.py` (subject enum, subject map, Literal).
4. `src/backend/app/product/images.py` (reuse; optional relocation to `app/storage/images.py`, imports in `app/users`, `app/product`).
5. `src/backend/app/storage/service.py` + outbox `OBJECTS_DELETE` (no change; consumers).
6. `src/backend/app/core/authorization_matrix.py` (no change if PATCH and embedded public read; add test cases in `test_authorization_matrix.py`).
7. Optional: APScheduler in `app/main.py` (if a periodic sweep is chosen for C-2/I-2).
8. `group-thing-ai/app/photo_store.py` (Subject, SUBJECTS, derived REQUIRED_PRIVILEGES), `scripts/moderation_db_role.sql`, tests `test_photo_store.py`, `test_deploy_artifacts.py`, `test_moderation_cron.py`.
9. FE: `src/frontend/src/api/organizations.ts`, `hooks/usePublicOrganization`, `hooks/useMyOrganization`, new media mutation hooks (invalidate `PUBLIC_ORGANIZATION_KEY` + `MY_ORGANIZATION_KEY`).
10. FE: `pages/organizer/layouts/types.ts` (BlockId `gallery`), `layouts/registry.ts` (slots), `LayoutRenderer.tsx` (BLOCKS entry, owner ghost when empty), `blocks/HeroBlock.tsx`, new `blocks/GalleryBlock.tsx`, `blocks/GhostBlock.tsx` (copy), `editor/EditorSheet.tsx` (Tab union, TABS, tabRefs), new `editor/PhotosTab.tsx` reusing `pages/product/ItemGalleryEditor.tsx` pieces.
11. Admin FE: `api/moderation.ts:5`, `components/moderation/PhotoModerationCard.tsx:37`.
12. Docs: B task `implementation-plan.md:748`, `spec.md`, `workflow-summary.md`, HLD copies (l.218, 748, 751, 770) — C now takes 0055+.
13. Tests (backend new `test_organization_media.py`, migration test, public-read statement test; FE hooks/layout/GalleryBlock/EditorSheet/admin card).

## Deploy Order
1. **App release** with migration 0054 **and** code that knows `ORGANIZATION_MEDIA` (the app must parse `moderation_decisions.subject_type='ORGANIZATION_MEDIA'` before the cron writes any). Uploads already work; with `MODERATION_IMAGE_ENABLED=true` they wait PENDING (fail closed). Admin can approve manually from the queue meanwhile.
2. **Re-run `moderation_db_role.sql`** on prod DB (grants on the new table).
3. **Deploy the cron** on VPS B. Warning: if step 3 precedes step 2, `check_requirements()` refuses to start and **product photo and avatar moderation also stop** (blast radius beyond D). The deploy note must say so.
- Downgrade: stop cron (or redeploy previous cron) before `alembic downgrade` of 0054.

## Issues Requiring Decisions

### Critical (Must Decide Before Proceeding)
1. **C-1 Gallery and cover placement per layout**: which layouts get a `gallery` slot (and where), and is the cover shown outside the `cover` hero variant?
   - Options: (A) gallery in all 5 layouts right after `about`; cover only in CLASSIC/CIRCLES; tab notes "Okładka widoczna w układach Klasyczny i Grupy". (B) gallery only in CLASSIC, CIRCLES, LINKS. (C) gallery only in CLASSIC/CIRCLES.
   - Recommendation: A — with max 3 photos a 3-up strip fits every layout, and it avoids CREATE-without-READ (owner uploads, layout hides it).
2. **C-2 Superseded/old logo-cover cleanup and fallback**: the cron cannot retire the previous approved row.
   - Options: (A) eager cleanup in the app at every point that can make a row the newest APPROVED for its slot — owner upload with moderation off, admin `decide` APPROVED — plus cleanup on next owner upload/delete for cron approvals; read rule = newest APPROVED by created_at. (B) A periodic app sweep (existing APScheduler) deleting APPROVED LOGO/COVER rows older than the slot's newest APPROVED. (C) Lazy cleanup only on next upload/owner read (writes in a GET).
   - Recommendation: B + read rule (cleanup off the request path, no GET writes, catches cron approvals within one interval). Also decide takedown fallback: when the current logo is rejected by an admin, should an older approved logo resurface? Recommend: no — sweep deletes superseded rows promptly, and a takedown leaves the slot empty (initials).

### Important (Should Decide)
1. **I-1 Moderation subject naming and refactor**: `ORGANIZATION_MEDIA` (18 chars, fits String(20)) + a subject → model map in `moderation/service.py`, vs adding third branches.
   - Default: `ORGANIZATION_MEDIA` + map; admin label "Organization · {name} · {kind}". Rationale: removes the misroute hazard in `decide` / `delete_upload`.
2. **I-2 REJECTED file policy**: keep REJECTED files private forever (parity with products/avatars), delete on owner dismiss / next upload, or sweep after N days.
   - Default: delete REJECTED row+files when the owner removes it or uploads to the same slot; keep the row otherwise so sha dedup blocks re-upload of the same rejected image. Rationale: bounded storage without losing audit (decisions remain in `moderation_decisions`).
3. **I-3 What the owner sees for REJECTED**: hidden (product parity), or visible with "Odrzucone przez moderację — dodaj inne zdjęcie" + "Usuń".
   - Default: visible with note + Usuń; does not count toward the gallery limit of 3. Rationale: silent disappearance of a logo is confusing.
4. **I-4 Takedown vs 1-year immutable CDN cache**: accept parity (per-media keys stop being referenced; CDN copy may stay reachable by direct URL), or add CDN purge / shorter cache for organization media.
   - Default: accept parity, document. Rationale: same accepted risk as products/avatars; purge is new infra.
5. **I-5 `images.py` relocation**: move `app/product/images.py` → `app/storage/images.py` now (third consumer) or import cross-module.
   - Default: move (small mechanical change, update users/product imports). Note minimal-implementation standard; it is a move, not a new abstraction.
6. **I-6 Behaviour with `moderation_image_enabled=false` (local/compose default)**: auto-APPROVED + public immediately (parity) vs always PENDING.
   - Default: parity (auto-APPROVED). Consequence: every logo replacement immediately supersedes the old one → cleanup path (C-2) is exercised locally. Also: without Spaces configured, upload → 409 "Dodawanie zdjęć jest chwilowo niedostępne" and public read must return empty media, not fail.
7. **I-7 Route shape**: `/api/organizations/{organization_id}/media…` (matches existing `PATCH /api/organizations/{organization_id}`) vs `/api/organizations/mine/media…`.
   - Default: `{organization_id}` with ownership check, reorder `PATCH …/media/order`. Both covered by matrix row 50; no PUT.
8. **I-8 Sha dedup scope**: `UNIQUE(organization_id, content_sha256)` across kinds (HLD) blocks using the same image as logo and gallery and blocks re-uploading a still-present superseded logo; alternative `UNIQUE(organization_id, kind, content_sha256)`.
   - Default: per kind. Rationale: logo reused in gallery is legitimate; cross-kind 409 would be confusing.
9. **I-9 Owner pending visibility location**: pending/rejected shown only in the "Zdjęcia" tab (hero always shows approved, as visitors see) vs hero preview of pending.
   - Default: tab only. Rationale: page renders the public response; matches "what visitors see".
10. **I-10 Ghost CTA for gallery**: CTA that opens the editor on the "Zdjęcia" tab (new mechanism) vs ghost without CTA.
    - Default: CTA opening the tab (owner already on the page). Small new prop on GhostBlock.

## Recommendations
- Implement in task groups: DB/migration → backend media service/routes → moderation map refactor → AI repo → FE public (hero, gallery) → FE editor tab → admin FE → docs/migration-number notes.
- Keep media in its own table; lock `organizations` row `FOR UPDATE` without touching `updated_at`; do the S3 put before taking the lock (process + put, then lock, check limits/dedup, insert; on conflict delete the files).
- Avoid template anti-patterns: avatar first-upload race (partial unique index + IntegrityError → 409), NEEDS_REVIEW not polling, presigned URLs expiring in open tabs (refetch < 600 s).
- Owner-only tab mutations must not set `dirty` and must not trigger the unsaved-changes blocker.

## Risk Assessment
- **Complexity Risk**: Medium-High — slot semantics (multiple rows per slot, newest-approved rule, cleanup) are new; gallery is a straight copy.
- **Integration Risk**: High — cross-repo contract (columns, grants, subject string), deploy order with cron-wide failure mode.
- **Regression Risk**: Medium — moderation dispatch refactor touches product photo/avatar paths; well covered by existing tests. Public organizer response gains a storage dependency (must not break when storage is None).
