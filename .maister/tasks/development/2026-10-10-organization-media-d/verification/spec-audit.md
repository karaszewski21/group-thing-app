# Spec Audit — D: Zdjęcia organizacji (logo, okładka, galeria)

- Spec: `implementation/spec.md` (543 lines)
- Audited against: `analysis/requirements.md` (authoritative), `clarifications.md`, `scope-clarifications.md`, `gap-analysis.md`, `design-context/` mockups, and the code in `group-thing-app` (HEAD 136ae23) and `group-thing-ai`.
- Date: 2026-10-10

## Verdict: **pass_with_concerns**

The spec covers every user decision (C-1, C-2, I-1…I-10, gallery max 3, migration 0054, Phase 4/5 decisions). It mostly matches the real code: the dispatch points, the cron contract, the matrix rows, APScheduler and the outbox. Two High issues need a spec edit before planning:
1. A caller of `PublicOrganizationResponse` that the spec does not list would break.
2. A cron race breaks the "older image never resurfaces" guarantee the user explicitly asked for.

The rest are Medium/Low clarifications.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 11 |

---

## High

### H1 — `PublicOrganizationResponse` has a second caller that will 500 (SPA meta preview)
- **Spec location:** R9 (l.116-126), "Reusable Components", Commit split 2.
- **Evidence:** `src/backend/app/system/router.py:110-125` server-renders `/{organization_slug}` with `PublicOrganizationResponse.model_validate(organization)`, where `organization` is the ORM `Organization`. The schema is `from_attributes=True` (`app/organizations/schemas.py:244-263`). If `logo`, `cover` and `gallery` are added without defaults, validation fails because the ORM object has no such attributes. Every HTML load of `/:slug` would then 500. `tests/test_public_preview.py` exercises this route.
- **Fix:** In R9, declare the new fields with defaults: `logo: PublicMediaResponse | None = None`, `cover: ... = None`, `gallery: list[PublicMediaResponse] = []`. Have the router fill them explicitly, e.g. `model_validate(org).model_copy(update=...)` or the constructor. Add `app/system/router.py` to the touched/verified files. Add a check to BE-6: `test_public_preview` stays green, and the preview does no media query.

### H2 — Delete decisions based on a pre-read status race with the cron and break the takedown guarantee
- **Spec location:** R5.2 (l.93), R7 (l.103-106), R13 "Guarantee" (l.157), R14 (l.159-162), Concurrency (l.436-438).
- **Evidence:** The cron is not serialized by the organization lock. It claims and finalizes in its own short transactions (`group-thing-ai/app/photo_store.py:17-22, 272-280, 366-401`) and can flip PENDING → APPROVED at any moment. R14 asks for Core `DELETE … RETURNING storage_key` **by id**.
  - The app reads rows (PENDING P), and the cron commits P = APPROVED.
  - (a) R5.2 replace then deletes P by id. A just-approved, already public image is removed. The slot's older APPROVED row A becomes the newest again, so **A resurfaces**. This contradicts the R13 guarantee and C-2 ("older never resurfaces"), and it also drops an image the owner never asked to delete.
  - (b) R7 owner "Anuluj" on P: the pre-read status says PENDING, so no retire runs. Same resurfacing of A.
- **Fix:**
  - R5.2: delete with a status predicate, either a predicate-based `DELETE … WHERE organization_id=:o AND kind=:k AND status IN ('PENDING','NEEDS_REVIEW','REJECTED')` or by id plus the same status filter. Postgres re-checks the predicate after waiting on the cron's row lock.
  - R7/R15 `_delete_media`: use `DELETE … WHERE id=:id RETURNING status, kind, created_at, id, storage_key`, and decide "deleted row was APPROVED → retire" from the **returned** status, not the pre-read one.
  - State this in R14.
  - Add a BE-5 test: flip the row to APPROVED with a Core UPDATE after the service's read (monkeypatch hook) or before calling `_delete_media`, then assert the older approved row is retired.

---

## Medium

### M1 — Admin `decide` for org media: lock order, identity map and descriptor shape are underspecified
- **Spec location:** R15 descriptor (l.168), R16 (l.181), Concurrency (l.436).
- **Evidence:**
  - Today `decide` does `db.get(model, subject_id, with_for_update=True)` (`app/moderation/service.py:267-270`). The spec says to fetch `organization_id` first, lock the organization, then `db.get(... with_for_update=True)`.
  - If that pre-fetch loads the ORM entity, a later `get(..., with_for_update=True)` runs SQLAlchemy's version check. The cron bumps `updated_at` (`photo_store.py:268, 280`), so the check raises `StaleDataError` and the admin gets a 409 "Dane zostały w międzyczasie zmienione".
  - R16 says the takedown branch uses "the status read before the change". That status must be read **after** the row lock.
  - The R15 descriptor lists only model, admin delete and list branch. R16 says the hook is called "through the subject descriptor", and the concurrency section needs a pre-lock step.
  - Product already uses the safe pattern: `delete_photo_as_admin` uses a scalar select first (`app/product/service.py:461-471`).
- **Fix:**
  - List the descriptor fields explicitly: `model`, `admin_delete`, `list_branch`/`count`, optional `lock_parent(db, subject_id)` (called before the row lock), and optional `after_decide(db, row, previous_status, outcome)`.
  - Mandate `select(OrganizationMedia.organization_id).where(id==…)` (Core scalar) for the pre-lock lookup.
  - Mandate that `previous_status` is taken from the locked row.

### M2 — Cover scrim cannot guarantee 4.5:1, and `text-on-primary` can be dark
- **Spec location:** R22 cover (l.230); mockup l.114, l.596.
- **Evidence:**
  - `text-on-primary` is palette-dependent. One preset uses `#1e2e27` (`src/frontend/src/theme/palettePresets.ts:78`). Custom colors can resolve to INK (`theme/orgPalette.ts:146-155`). Dark text over a dark `from-scrim` gradient on a photo is illegible.
  - Even with white text, `--color-scrim` is `rgb(20 28 24 / 0.55)` (`src/index.css:48`). Over a white photo that gives about 4.0:1. That fails 4.5:1 for the `text-sm` address line.
- **Fix:** When a cover image is shown, render the name and address in a fixed light token (e.g. `text-on-ink`/paper) regardless of palette. Use a stronger overlay: a solid bottom stop, or a dedicated darker scrim of at least 0.7 alpha behind the text block. Add an FE-1 assertion that the cover variant with an image uses the fixed light text class.

### M3 — Deploy step 2 rotates the cron's DB password, which can stop all moderation
- **Spec location:** Deploy order step 2 (l.442), Success criterion 7 (l.535), R19.
- **Evidence:** `group-thing-ai/scripts/moderation_db_role.sql:33` always runs `ALTER ROLE … PASSWORD :'cron_password'`. The README says "each run also rotates the password … update `.env.cron`" (README l.408-418, 457-459). If step 2 runs with a new secret while the two-subject cron is still running, the cron's new connections fail authentication. Product and avatar moderation stop until step 3. That contradicts "following the deploy order never stops product photo or avatar moderation".
- **Fix:** Step 2 must re-run the script **with the current cron password**. If it rotates, `.env.cron` must be updated and the cron restarted immediately (or step 3 must follow at once). Put the same warning in R19's README update.

### M4 — Owner preview goes stale after an approval: the tab says "Na stronie" but the hero does not change
- **Spec location:** R21 (l.219-225), R26 S4/S5, data flow step 4 (l.419).
- **Evidence:** The page renders the public query (`PublicOrganizationPage.tsx:30, 90-94`). Polling refreshes only `[MY_ORGANIZATION_KEY]`. When the cron approves a pending logo, the Zdjęcia tab flips to "Na stronie", but the hero and gallery behind the non-modal sheet keep showing the old state until the public query refetches (window focus or remount).
- **Fix:** In `useMyOrganization` (or PhotosTab), invalidate `[PUBLIC_ORGANIZATION_KEY]` when a poll result changes any media status (e.g. compare id→status maps). Add an FE-3 test.

### M5 — Ghost CTA does nothing while the sheet is open; `PublicOrganizationPage` changes are not specified
- **Spec location:** R24 (l.250-251), R25 (l.257), mockup l.319.
- **Evidence:**
  - `EditorSheet` keeps the tab in `useState("uklad")` (`editor/EditorSheet.tsx:38`). Reading `?tab=` only at mount means that clicking the gallery ghost CTA (`?edit=1&tab=zdjecia`) while the sheet is already open (it is non-modal and the ghost stays visible) changes the URL but not the tab.
  - Closing is implemented in `PublicOrganizationPage.closeEditor` (`PublicOrganizationPage.tsx:72-80`), which deletes only `edit`, not in EditorSheet as R25 implies.
  - EditorSheet receives no organization id and no media today (`EditorSheet.tsx:20-30`), yet PhotosTab needs both.
- **Fix:**
  - Specify that EditorSheet syncs its tab when the `tab` search param changes.
  - Specify that `closeEditor` deletes `tab` together with `edit`.
  - Specify that `PublicOrganizationPage` passes `owner.id` and `owner.media` to EditorSheet.
  - Add an FE-2 case: with the sheet open on Układ, clicking the ghost CTA switches to Zdjęcia.

---

## Low

| # | Spec location | Evidence | Fix |
|---|---|---|---|
| L1 | R12 sweep, Concurrency l.438 | The sweep deletes many rows across organizations without the org lock. An owner transaction that holds the org lock and deletes the same superseded rows in a different order can deadlock (Postgres aborts one side). | Use `SELECT id … ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED` in the sweep subquery. |
| L2 | R5.1, Known limitation "Superseded duplicate window" | Dedup matches superseded rows that `/mine` hides, so the owner sees a 409 "już dodane jako logo" for a photo they cannot see. | Under the org lock, before dedup, call `retire_older_slot_rows(than=newest APPROVED)` for the slot (a per-slot sweep). The limitation then disappears at no extra query cost worth noting. Alternatively, give a specific message when the matching row is REJECTED. |
| L3 | R15 `QueueEntry` | `_queue_entries` builds `QueueEntry` without the new field (`app/moderation/service.py:91-102, 233-246`); `list_queue` stays unchanged. | Declare `media_kind: MediaKind \| None = None`, last in the frozen dataclass. |
| L4 | R14 vs R16 | R14 says every non-INSERT write is Core, but `decide` sets `photo.status` through the ORM (`service.py:277`). That write is safe because the row is locked. | Note the exception in R14. |
| L5 | R19 | Stale "two subjects" text outside README: `photo_store.py:10-15` docstring, `ClaimedPhoto` docstring (l.182), `moderation_cron.py:7-8`. README also: l.304-312, 321-322, 405-418, 434 (log kinds), and smoke steps 510-523 (no org-media smoke). | Extend R19 to these docstrings and add an org-media smoke step. |
| L6 | R10 l.133, R26 S6 | A slot can hold 2 REJECTED rows: after a takedown of A (REJECTED) the cron can also reject the pending P. S6 renders one. | Specify: list every REJECTED row (newest first), each with "Usuń". |
| L7 | R21 | `useMyOrganization` also backs `useMyOrganizationSlug` (panel/nav). A NEEDS_REVIEW row can wait days for an admin, so polling runs every 10 s app-wide. | Enable polling only while PhotosTab is mounted (a hook option), or cap it. |
| L8 | Rollback l.449-452 | `docker-compose.yml:43` runs `alembic upgrade head` at start. The old image has no 0054 file, so it fails to start if the DB is still at 0054. The downgrade also destroys all org-media rows. | State that the downgrade runs with the **new** image before the old one is redeployed, and that it deletes data. |
| L9 | R30 | `code-review-report.md` l.58/114 (W1-R2, `transaction_per_migration`) is already done (`alembic/env.py:33,45`). | Mark it resolved instead of only renumbering. |
| L10 | R4.2 copy | The product constant `PHOTO_UPLOAD_DISABLED_MESSAGE` has no trailing period (`app/product/service.py:409`); the spec adds one. | Align the copy (reuse the constant or add the period consistently). |
| L11 | R5.3/R5.4, R14 | `created_at` is a Python default set at flush (`app/core/base_model.py:58-60`), and retire needs `than=(created_at,id)`. If the new row is added before the R5.2 Core DELETE runs, autoflush can trip `uq_organization_media_one_pending_per_slot`. | Guidance: run the R5.2 DELETE, then `db.add` + `flush`, then retire using the flushed values. |

---

## Verified as correct (evidence)
- **Dispatch points** are exactly the 4 named: `_set_photo_files_public` (service.py:73-85), `list_photos` union and 2 counts (l.151-187), `decide` model ternary (l.267), `delete_upload` fallback (l.291-297). `Literal[PHOTO, AVATAR]` is at schemas.py:334. `ORGANIZATION_MEDIA` (18 characters) fits `String(20)` (models.py:461-463).
- **Rollback audit claim holds:** decisions are loaded only by subject ids (service.py:105-121); no other loader exists.
- **Cron contract:**
  - `_moderated_table` has exactly the 8 columns (photo_store.py:79-93).
  - `REQUIRED_PRIVILEGES` is derived from `SUBJECTS` (l.149-157).
  - `ClaimedPhoto` keys are `{storage_key}/w1600.webp` / `w400.webp` (l.192-198), so no change is needed.
  - The guarded finalize is `status='PENDING' AND moderation_attempts=` (l.272-280).
  - The claim is `FOR UPDATE SKIP LOCKED` and commits before scoring.
- **Cron tests to update:**
  - `tests/test_photo_store.py:41-46` (SUBJECTS list, column parity), `:99-118` (privilege map), `:134` (subject_type parametrize);
  - `tests/test_deploy_artifacts.py:59`;
  - `tests/test_moderation_cron.py:23,77`.
- **Grants SQL** structure is as the spec describes (moderation_db_role.sql:41-60). The header (l.3-5) and the decision comment (l.55) need the R18 edits.
- **Matrix:** row 48 is `GET /api/organizations/public/[^/]+` PUBLIC; row 50 is `POST, PATCH, DELETE /api/organizations(/.*)?` EDIT; there is no PUT (authorization_matrix.py:189-195). No route clashes with `PATCH /api/organizations/{id}`.
- **APScheduler:** one `AsyncIOScheduler` with misfire/coalesce defaults and `_TERM_END_SCAN_INTERVAL_MINUTES` constant (main.py:59-63, 101-117). A second `add_job` fits; the variable name `_term_end_scheduler` could be renamed.
- **Outbox `OBJECTS_DELETE`** exists (storage/outbox_listener.py:16-29).
- **R1 importers** are exactly product/service.py:42, product/router.py:25, users/service.py:26, users/router.py:17. No test imports the module.
- **Query budget:** today's public read is 1 statement (organizations/service.py:373-378), so 2 is feasible. The organizer directory (`/api/groups/public/organizers/{slug}`, `test_organizer_page_queries.py`) does not use the organization response and is unaffected.
- **Frontend:**
  - The `LayoutRenderer` `isEmpty` gating on `directoryStatus === "ready"` is confirmed (LayoutRenderer.tsx:90). A non-primary gallery slot returns `null` for visitors, which is correct.
  - EditorSheet tabs, `tabRefs`, fieldset and `useBlocker` are confirmed (EditorSheet.tsx:11-16, 48-52, 166).
  - HeroBlock geometry for the 3 variants is confirmed (h-14 / h-20 / h-16).
  - `about` appears in all 5 layouts (registry.ts:39, 55, 72, 89, 103).
  - Query keys `MY_ORGANIZATION_KEY` (with token) and `PUBLIC_ORGANIZATION_KEY` are confirmed.
  - The admin FE union is at api/moderation.ts:5 and the title ternary at PhotoModerationCard.tsx:37.
  - `ModerationBadge` and `PhotoFileField` (`multiple` hard-coded) are in ItemGalleryEditor.tsx:15, 196-208. `SECTION_LABEL` is not exported (ColorsTab.tsx:23).
- **Migration template:** 0051 matches; `transaction_per_migration=True` is already set.
- **Partial unique and replace:** delete-then-insert in one transaction is valid under a non-deferred partial unique index (see L11 for ordering).

## Over-engineering check
No significant over-engineering. Eager retire and the sweep are both justified: the cron approval path cannot be hooked, and the user chose the sweep. The subject map replaces a real misroute hazard. Width/height and the cross-kind unique were dropped. Copying the gallery row markup is fine.

## Test plan adequacy
Adequate overall (2-8 per group, query budget, regression on PHOTO/AVATAR, cron parity). Add:
- the H1 preview regression;
- the H2 race simulation;
- the M1 decide-after-cron-bump case (no 409);
- the M4 public invalidation case;
- the M5 CTA-while-open case.
