# Completeness Re-verification (after verification-cycle-1 fixes)

## TL;DR
- Status: **passed_with_issues**. 0 critical, 1 warning, 3 info. The warning is outside this repo.
- Of the 7 cycle-1 completeness issues, 6 are resolved. #3 (standards candidates) is still pending by design, to be offered at finalization, and is not counted as a regression.
- The plan still holds at 115/115: 132 `[x]` checkboxes and 0 `[ ]`. The fixes did not touch the plan.
- Standards: now fully compliant (19/19 applicable standards). The `release_reservation` chain is gone and the change-log comment was rewritten.
- New issues from the fixes are minor and documentation-only. `architecture.md:125` still has a stale "Withdrawn listings are not restored." line, and the deletion of `scripts/__init__.py` is unstaged while the other deletion is staged.

## Key Decisions
- The `../group-thing-ai/README.md` passages are a residual **warning**. That file is in a different repository, which is why the fix agent did not edit it. The work-log records the exact lines (L467–470, L474–475, L497–498).
- The `.pyc` files still on disk belong to modules that still exist (`0029_term_attendance_withdrawn_at`, `test_attendance_withdrawal`). No `.pyc` of a deleted module is left, so issue #7 is resolved.
- The fixes from other reviewers were checked against the standards because they changed code: the 0069 outbox, needed-item description moderation, GZip, name stripping and the frontend cache invalidation.

## Open Questions / Risks
- The 0069 photo-delete outbox rows are processed by the API's outbox listener after the deploy. The runbook (`architecture.md:226–236`) does not tell the operator to expect, or check, the Spaces purge. This is optional (info).

---

## 1. Cycle-1 issue resolution

| # | Cycle-1 issue | Status | Evidence |
|---|---|---|---|
| 1 | `release_reservation` dead chain (warning) | **Resolved** | `grep -rn release_reservation src/backend` finds nothing in `app/`, `tests/` or the bridge. `test_photo_moderation_queries.py` was modified to drop its test. |
| 2 | Spec Audit row L12 contradicts FR-3 (warning) | **Resolved** | `spec.md:356` now says the downgrade "fails if any product exists, deletes every category leaves first (… never clearing `parent_id`), then re-inserts the 5 legacy rows". This matches FR-3 and the summary at `spec.md:34`. |
| 3 | Standards-update candidates not offered (warning) | **Pending (by design)** | They are to be offered at finalization; see section 4. Not counted as a regression. |
| 4 | Change-log-style comment `MyItemsView.tsx:316` (info) | **Resolved** | It now reads "Informational only: pending photos dash the card border; the mode stays selectable." This describes current behaviour, as commenting.md asks. |
| 5 | architecture.md does not say needed items are plain names (info) | **Resolved** | New bullet at `architecture.md:95`: "Needed items are plain names (`needed_items.name` plus an optional `description`); since `0068` they no longer point at a product." |
| 6 | Fixture crawl incomplete (HTTP 429) (info) | **Residual (accepted)** | The user accepted it; it stays a follow-up task. |
| 7 | Stale `.pyc` files of deleted modules (info) | **Resolved** | `src/backend/scripts/` is removed entirely. No pyc remains for withdraw, repoint, hardening or the script tests. The two remaining matches belong to live modules. |

Related verification-report items that touch documentation:

| Verif. # | Issue | Status | Evidence |
|---|---|---|---|
| 2 | No rollback runbook | **Resolved (docs)** | `architecture.md:226–236`, "Cutover / rollback for the category-tree release (migrations 0064–0069)": verified `pg_dump -Fc`, cron off, deploy, verify 9 roots / 2286 categories and `alembic_version` 0069, cron on, smoke test, then rollback by `pg_restore` followed by the previous image. |
| 9 | architecture.md L64/L67 still describe the gate | **Resolved** (in this repo) | L64: "PUT /api/item-listing-preferences/{item_id} (mode ≠ null) → listed whatever the photo status". L67: "although their items can still be listed". L90 records that the gate and the script were removed. Cutover step 4 says the cleanup is "No longer needed". |
| 9 | `../group-thing-ai/README.md` still tells operators to run the deleted script | **Residual (warning)** | Not edited because it is in another repo. The work-log entry of 2026-10-28T06:59:01Z lists the lines. |

## 2. Plan completion — complete

- `implementation-plan.md`: 132 `- [x]` checkboxes and 0 `- [ ]`. That is 115 steps plus 17 group headers, unchanged.
- The fixes were post-plan verification work and are recorded in the work-log (3 entries, 2026-10-27T21:03Z to 2026-10-28T06:59Z), not as new plan steps. That is appropriate.

## 3. Standards compliance of the fixes — compliant

| Standard | Applies? | Reasoning / result |
|---|---|---|
| global/minimal-implementation.md | Yes | The `release_reservation` chain was deleted along with its test, and the empty `scripts/` package was removed. Followed. **The cycle-1 gap is closed.** |
| global/commenting.md | Yes | The `MyItemsView.tsx:316` comment describes current behaviour. New comments in 0069 (L88–91) and `terms.py:203–209` explain non-obvious reasons (the 1000-key DeleteObjects cap, rendering on the public page). Followed. |
| global/error-handling.md, validation.md | Yes | The needed-item description goes through `rules.ensure_no_contact_info` (handles `None`, `rules.py:34`) and then `check_text(PRODUCT_DESCRIPTION, new, current)`. It is checked only when the value changes (`terms.py:268`). Category names are stripped with `ConfigDict(str_strip_whitespace=True)` (`category/schemas.py:54,62`), so a blank name fails `min_length`. Followed. |
| backend/migrations.md | Yes | 0069 now runs `DROP TABLE IF EXISTS` before each temp table (L218) and logs row counts (L221). It is still a single data revision. Followed. |
| backend/models.md / queries.md | Yes | The outbox insert is a single set-based `INSERT … SELECT` over `wipe_photos`. Its payload `{"keys": [<storage_key>/w1600.webp, <storage_key>/w400.webp]}` matches `_stage_photo_files_delete` and `ProductPhoto.large_key`/`thumb_key` (`product/models.py:107–112`), and the event type is `storage.objects_delete` (`storage/outbox_listener.py:16`). Followed. |
| backend/time.md | Yes | 0069 sets audit columns with `timezone('utc', now())`, which is naive UTC. No `datetime.now` was added. Followed. |
| backend/api.md / security.md | Yes | `GZipMiddleware(minimum_size=1000)` (`main.py:23,145`). There are no new routes, and the authorization matrix is unchanged. Followed. |
| frontend/data-fetching.md | Yes | `useCategories` gained `create`/`update` callbacks that `await invalidate()` on the `CATEGORIES_KEY` prefix. `useProducts.ts:74–75` also invalidates `CATEGORIES_KEY`. `CategoryFormPage` takes the host hook's callbacks (L39) instead of calling the API directly. Followed. |
| frontend/accessibility.md | Yes | The new missing-fields hint in `ItemCreatePage` is linked through `aria-describedby={actionHint}` on all three submit buttons (L71/80/89). Followed. |
| testing/backend-testing.md | Yes | The new tests use the convention: `test_createAndUpdateCategory_paddedDuplicateOrBlankName_returns409Or400`, `test_listCategories_acceptsGzip_returnsCompressedBody` (`test_category_tree.py:155,179`), `test_createNeededItem_descriptionWithContactInfo_returns400` (`test_groups.py:225`), and an outbox assertion in the seed test. Followed. |
| testing/frontend-testing.md | Yes | The work-log reports targeted tests passing, tsc at 0 and the full Vitest run at 1159/5 (the known HEAD failures). Followed. |
| backend/jooq.md, plugin-auth.md | No | Not touched. |
| frontend/css.md, responsive.md, components.md | Yes (minor) | Only the hint text and refactors were added; the layout tokens are unchanged. Followed. |

Checked 21, applicable 19, followed 19.

## 4. Documentation completeness — complete (one cross-repo residual)

- The work-log has three dated entries for the fixes: the dev DB backup (path only, no credentials), frontend done, and backend + docs done. They include test numbers and say what was deliberately left unchanged (the `useCreateItem` resolve path does not invalidate categories, and `CategorySearch.total`).
- The spec is now internally consistent on the 0069 downgrade.
- `architecture.md` now has the gate removal, the needed-items bullet and the category-tree cutover/rollback runbook.

### New issues introduced by the fixes
- **architecture.md:125 (info, fixable)**: the 0049 rollback paragraph still says "Withdrawn listings are not restored." Listings are no longer withdrawn, so this sentence is obsolete.
- **Unstaged deletion (info, fixable)**: `src/backend/scripts/__init__.py` shows as ` D` (unstaged), while `withdraw_unmoderated_listings.py` is `D ` (staged). Stage both in the Phase 14 commit, for example with `git add -A src/backend/scripts`.
- **Runbook omits the Spaces purge check (info, optional)**: after the deploy, the operator could confirm that the `storage.objects_delete` outbox rows staged by 0069 reach `PROCESSED`.

### Standards-update candidates (pending, offer at finalization; not a regression)
1. accessibility.md / components.md: a picker sheet inside a form is portaled to `document.body`; every button is `type="button"`; Enter in search calls `preventDefault`; the trigger is labelled with `aria-labelledby`.
2. accessibility.md: an admin tree uses nested lists with `aria-expanded` disclosure buttons instead of `role="tree"`.
3. migrations.md: rows of a self-referential tree that has a partial root-unique index are deleted leaves-first, never by nulling the parents first.
4. backend-testing.md: tests get categories only through `leaf_category_ids(client, headers, n)`, never cached.
5. frontend-testing.md: no `as <ResponseType>` casts on fixture factories.
6. data-fetching.md: the `staleTime: 5 min` exception for the large `categories` list, with invalidation on admin product and category writes.
7. INDEX.md: refresh the models.md and architecture summaries (category tree, `listing_status`).
8. (new) migrations.md: a data migration that deletes rows owning storage objects stages `storage.objects_delete` outbox events, one per photo so each stays under the 1000-key limit, in the same transaction.

## Issues

| # | Source | Severity | Description | Location | Fixable | Suggestion |
|---|---|---|---|---|---|---|
| 1 | documentation | warning | The README in the other repo still describes the deleted cleanup script and the gate | `../group-thing-ai/README.md` L467–470, L474–475, L497–498 | true | Edit it in that repo, or hand it to the user |
| 2 | documentation | info | Stale sentence "Withdrawn listings are not restored." | `.maister/docs/project/architecture.md:125` | true | Delete the sentence |
| 3 | documentation | info | `scripts/__init__.py` deletion is unstaged, while the sibling deletion is staged | `git status` | true | Stage it in the finalization commit |
| 4 | documentation | info | The runbook does not mention checking the Spaces purge outbox rows from 0069 | `architecture.md:226–236` | true | Optionally add a verify line |

Pending, not counted: the standards-update candidates (section 4).

Issue counts: critical 0, warning 1, info 3.
