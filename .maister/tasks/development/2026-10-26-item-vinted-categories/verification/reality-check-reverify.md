# Reality Check (re-verify, cycle 2): Vinted category tree + Oddam / Zamienię / Wersja robocza

## TL;DR
- Verdict: **⚠️ Issues Found (works; deploy with known caveats)**. Every cycle-1 fix holds up in the code and on a scratch copy of the real dev DB. No regressions and no new critical gaps.
- Confirmed on the copy: 0069 stages 16 `storage.objects_delete` outbox entries (one per wiped photo, 2 keys each), and the 0063↔head round trip is clean. gzip cuts `/api/categories` from 583 KB to 122 KB, padded or blank category names are stripped or rejected, contact info in needed-item descriptions is rejected, and the whole cycle-1 smoke test still passes.
- Still open: G1 (browser check, moved to Phase 12 E2E) and G2 (dev DB at 0063; a backup exists and has been checked). G3 now has a runbook, G4 is planned as a follow-up, G6/G7/G10 are unchanged info items.
- New: N1 (warning). Once 0069 runs, the outbox deletes the wiped photos' files from Spaces, so restoring the dump brings back photo rows whose files are gone. The runbook does not say this.

## Key Decisions
- I did not run the test suites (`skip_test_execution: true`). I used `verification/test-suite-results-reverify.md`: backend 881/881, frontend 1161/1166 (the 5 known HEAD failures), tsc clean, lint 16 (same as the baseline).
- I re-ran the smoke test on a throw-away copy (`reality_check_tmp`, `pg_dump | psql` inside the dev Postgres container). Steps: `alembic upgrade head`, then `downgrade 0063` + `upgrade head`, then `smoke.py` plus a new `smoke_fixes.py`, then I dropped the copy. The dev DB itself was not touched: still `0063`, 71 products. The DB URL was built in shell variables and no secrets were printed. `MODERATION_TEXT_ENABLED=false`, the same as in cycle 1.
- I checked the needed-item description guard by calling the helper directly. Setting up an organizer and a term just for the HTTP path wasn't worth it: the HTTP 400 path is covered by `tests/test_groups.py::test_createNeededItem_descriptionWithContactInfo_returns400` and `test_patchNeededItem_rejectedDescriptionChange_returns400AndKeepsDescription`.

## Open Questions / Risks
- **Do the dev and prod environments share a Spaces bucket?** When the dev backend first starts on 0069 with `SPACES_*` set, the outbox listener deletes the 16 legacy photos' w1600/w400 files. That is fine for a dev-only bucket. If the bucket or prefix is shared with a real environment, those deletes hit real files.
- Production: is there any non-dev DB with real items? 0069 is still irreversible (cycle-1 risk, now documented in the runbook).

---

## Cycle-1 gap status

| # | Cycle-1 gap | Status | Evidence |
|---|---|---|---|
| G1 | No runtime browser verification of the UI | **Deferred** to Phase 12 E2E | Still no `verification/visual-fidelity.md`. The frontend fixes (missing-fields hint with `aria-describedby`, categories cache invalidation) are backed by jsdom tests only |
| G2 | Dev DB at 0063, so new code breaks until the migrations run | **Deferred** (runs before E2E); backup checked | `alembic_version` = 0063. Backup at `C:\Users\karas\Desktop\swaptime\db-backups\group-thing-app-dev-20261027T210313Z-rev0063.dump` (238 KB): `pg_restore --list` reads it and finds 45 TABLE DATA entries |
| G3 | Destructive, irreversible 0069 | **Resolved (documented)** | `.maister/docs/project/architecture.md` §"Cutover / rollback for the category-tree release (migrations 0064–0069)" covers: dump and verify it, stop the cron, deploy together, check 2286/9 rows, smoke test, and restoring the dump as the only rollback. 0069 now logs row counts for each wipe table (seen on the copy: 5 categories, 71 products, 49 items, 23 reservations, 6 proposals, 3 conversations, 69 transactions, 16 photos). See N1 for the photo-file caveat |
| G4 | Incomplete tree makes the follow-up turn leaves with products into inner nodes | **Deferred** to the follow-up task | Unchanged by design. `create_category` still returns 409 when the parent has products |
| G5 | 583 KB uncompressed `/api/categories` | **Resolved** (size: residual info) | `app/main.py:145` `GZipMiddleware(minimum_size=1000)`. On the copy: `Content-Encoding: gzip`, 122 KB on the wire vs 583 KB decoded, and identity still 583 KB. Test `tests/test_category_tree.py:180`. That is about 4.8× smaller, not the ~10× estimated in cycle 1, and it misses the "<100 KB" criterion, but it is acceptable (see N2) |
| G6 | Empty product left behind after an 11th-Oddam failure | **Residual** (info, accepted) | `useCreateItem` still resolves before it registers. get-or-create reuses the product on retry |
| G7 | Changing the category re-points the product, so photos stay behind | **Deferred** (separate task) | Unchanged |
| G8 | Category names not stripped | **Resolved** | `ConfigDict(str_strip_whitespace=True)` on `CreateCategoryRequest`/`UpdateCategoryRequest` (`app/category/schemas.py:54,62`). Smoke: `"  Sukienki "` → `'Sukienki'`, `"\tKurtki\n"` → `'Kurtki'`; `"   "` and `""` → ValidationError. There is a padded-duplicate test in the suite |
| G9 | `release_reservation` unused | **Resolved** | `grep release_reservation app tests` → no matches |
| G10 | 5 frontend failures from the HEAD baseline | **Deferred** (separate task) | Same 5 tests in the reverify results |

## Other fixes confirmed (from other cycle-1 reviewers)
- **0069 photo-file cleanup staged in the outbox.** On the copy after the upgrade: 16 PENDING `storage.objects_delete` entries, one per wiped photo. The payload is `{"keys": ["products/<pid>/<photo>/w1600.webp", ".../w400.webp"]}`, which matches `ProductPhoto.large_key/thumb_key` (`app/product/models.py:108,112`) and the payload shape that `app/storage/outbox_listener.py` handles. Max 2 keys per entry, well under the DeleteObjects cap. The columns inserted match `OutboxEntry` (event_type, payload, status, attempts, created_at, updated_at). No leftover `wipe_*` tables. A second upgrade after a downgrade staged nothing extra (0 photos).
- **Needed-item description moderation.** `_check_needed_item_description` (`app/groups/application/terms.py:203-209`) runs `ensure_no_contact_info` + `check_text(PRODUCT_DESCRIPTION)` on create and on change. Smoke: "Zadzwoń 600 700 800" and "pisz: jan.kowalski@gmail.com" → rejected with the Polish contact-info message; "Kurtka zimowa, rozmiar M" → ok. `ValueError` → 400 via `app/core/errors.py:153`.
- **Cycle-1 functional smoke re-run on the post-fix code:** register 201; categories 2286; resolve on an inner node → 409 "Wybierz najbardziej szczegółową kategorię…"; unknown category → 404; 10 GIFT items ACTIVE, the 11th → 409 and not saved; null mode → DRAFT; LEND → 400; PUT GIFT at the limit → 409, SWAP 200, clear 200, GIFT after a slot is freed 200; `mine` 11 items with 0 status/mode violations; details 200; edit to an inner node → 409, re-point to a leaf 200 with ACTIVE kept; non-admin category create → 403.

## New gaps

| # | Severity | Gap | Evidence | Fixable |
|---|---|---|---|---|
| N1 | warning | The rollback runbook leaves out photo files. Once the backend runs on 0069, the outbox deletes the wiped photos' files from Spaces. A later `pg_restore` of the pre-0069 dump brings back `product_photos` rows (and APPROVED listings) whose files no longer exist, so the images are broken. "Restore the dump" is therefore not a full rollback for photos. The same applies to the dev cutover before E2E | 16 PENDING `storage.objects_delete` entries staged by 0069 on the copy; architecture.md:236 says only "restoring the dump is the only rollback" | true. Add one line to the runbook (for example "photo files of wiped products are deleted by the outbox; a restore brings back rows without files, so copy the bucket prefix `products/` first if photos must survive a rollback"), and confirm the dev bucket is not shared |
| N2 | info | gzip brings `/api/categories` down to 122 KB, still the biggest payload on add/edit (5-minute staleTime). That is acceptable on mobile, but cycle-1's <100 KB target is missed | smoke: wire 122 KB / decoded 583 KB | true (optional: drop `created_at`/`updated_at`/`description` from the list schema if needed; not required) |

## Integration Points
No change from cycle 1. GZip is added as an app-level middleware with a 1000 B minimum (a small 404 body stayed uncompressed). The outbox staging in 0069 reuses the existing listener and payload contract, so no new handler is needed. Category stripping is schema-level, so both the admin create and rename paths get it.

## Functional Completeness
About 95%, as in cycle 1. All the requested behaviour works against real data. What remains is operational: run the migration on the dev DB (G2), the browser E2E (G1), and one runbook line (N1).

## Pragmatic Action Plan

| # | Priority | Task | Success criteria | Effort |
|---|---|---|---|---|
| 1 | High | Before the dev upgrade, confirm that the dev `SPACES_*` bucket/prefix is dev-only (presence and name check only, no secret values) | Confirmed dev-only, or the `products/` prefix copied first | 5 min |
| 2 | High | Phase 12: upgrade the dev DB to head (backup already checked), then run the E2E click-through from the cycle-1 plan item 2 | `alembic_version` = 0069; flows match the mockups at phone width | 30–45 min |
| 3 | Medium | Add the N1 photo-file caveat to the architecture.md rollback section | Runbook says files are deleted by the outbox and how to keep them | 5 min |
| 4 | Low | Optional: trim the `/api/categories` list payload | Under 100 KB gzipped | 20 min |

## Completion Verdict
**⚠️ Complete with gaps.** All cycle-1 code fixes (G5, G8, G9, plus outbox photo staging and description moderation) are in place and hold up on a scratch copy of real data. Nothing regressed. The task is not "done" until the dev DB is migrated and the UI has been checked once in a real browser (Phase 12). Add the photo-file rollback caveat (N1) before any non-dev cutover.
