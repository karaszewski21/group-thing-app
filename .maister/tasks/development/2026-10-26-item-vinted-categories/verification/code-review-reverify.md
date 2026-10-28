# Code Review Report: Re-verification After Cycle-1 Fixes

**Date**: 2026-10-28
**Path**: fix diffs listed in work-log entries 2026-10-27T21:03Z, 2026-10-28T06:55Z and 06:59Z
**Scope**: all
**Status**: ✅ Clean. No critical issues or warnings. 3 new informational notes.

## TL;DR
- The cycle-1 fixes are correct. Resolved: W1, W3 and Info 1, 4, 5, 6, 7, 9. W2, W4 and W5 stay accepted as designed. Info 2, 3 and 8 needed no action.
- The 0069 outbox payload has the same shape as `_stage_photo_files_delete`: `{"keys": [<storage_key>/w1600.webp, <storage_key>/w400.webp]}`. `outbox_listener._handle_objects_delete` reads it correctly.
- `release_reservation` has been removed completely. Its only caller was the withdraw flow, which FR-15 removed. No references remain in `app/`, `tests/` or the frontend.
- The fixes introduce no new critical issues or warnings. There are 3 new informational notes: an unqualified `DROP TABLE IF EXISTS`, a BREACH note on GZip, and a filter-before-data edge in CategoryListPage.

## Key Decisions
- W1 is marked resolved, not residual. The migration now writes one PENDING `storage.objects_delete` row per wiped photo, in the same transaction as the row deletes. The seed-migration test asserts it (`tests/test_vinted_category_seed_migration.py:289`).
- One event per photo, instead of one batched event, is accepted. Each event has 2 keys, well under the 1000-key DeleteObjects cap. Many small rows is fine for a one-time migration.
- GZip with `minimum_size=1000` is accepted. No streaming or SSE endpoints exist (checked `app/` for StreamingResponse and text/event-stream). `GZipMiddleware` skips websockets.

## Open Questions / Risks
- `../group-thing-ai/README.md` (other repo) still needs the edits listed in the work-log. These are docs only, outside this review.

## Cycle-1 Findings: Status

| ID | Status | Evidence |
|----|--------|----------|
| W1 orphaned photo files | **resolved** | `alembic/versions/0069_vinted_categories.py:91-99` `_STAGE_PHOTO_FILES_DELETE` builds `jsonb_build_object('keys', jsonb_build_array(storage_key||'/w1600.webp', storage_key||'/w400.webp'))`. This matches `ProductPhoto.large_key`/`thumb_key` (`app/product/models.py:107-112`) and `_stage_photo_files_delete` (`app/product/service.py:232-240`). `outbox_listener.py:25` reads `payload["keys"]`. All non-null `outbox_entries` columns are set (id, event_type, payload, status, attempts, created_at, updated_at). The statement runs at `:227`, after the wipe sets are captured and before `_WIPE_DELETES`. |
| W2 gift limit race | accepted | Not touched. It stays a soft limit by design. |
| W3 needed-item description unmoderated | **resolved** | `app/groups/application/terms.py:188` (create) and `:268-270` (update, only when changed, passing `current`) call `_check_needed_item_description` (`:203-209`). That function runs `ensure_no_contact_info` + `check_text(PRODUCT_DESCRIPTION, ...)`. `None` and blank values are skipped by both helpers. Tests: `tests/test_groups.py:225`, `:244`. |
| W4 leaf rule race | accepted | Not touched. |
| W5 orphan product after failed register | accepted | Not touched (work-log: "Not changed"). |
| Info 1 temp-table re-entrancy | **resolved** | `0069:218` runs `DROP TABLE IF EXISTS {table}` before each `CREATE TEMP TABLE`. Row counts are logged at `:220-221`. See new N1. |
| Info 2 wipe completeness | n/a | No change needed. |
| Info 3 destructive downgrades | accepted | The rollback runbook was added to `architecture.md`, per the work-log. |
| Info 4 search folds every keystroke | **resolved** | `utils/categoryTree.ts:29-32` precomputes `foldedNames`, and `:79` does a plain `includes`. |
| Info 5 indexOf / double filter | **resolved** | `CategoryListPage.tsx:66` filters once (in the `useMemo`). `:132-133` compares `siblings[0]`/`siblings[last]` instead of `indexOf`. Branch expansion is a guarded render-time state adjustment (`:69-73`), which React documents as valid. |
| Info 6 `let term` untyped | **resolved** | `AppDataContext.tsx:551` `let term: TermResponse;`. |
| Info 7 disabled buttons unexplained | **resolved** | `ItemCreatePage.tsx:62-66` shows a visible hint `#item-create-missing-fields`, which the three action buttons reference through `aria-describedby` (`:71,80,89`). |
| Info 8 rename blocked on inner-node product | accepted | Edge case of W4. Unchanged. |
| Info 9 CategoryFormPage bypasses hook | **resolved** | `hooks/useCategories.ts:61-77` adds `create`/`update` that `await invalidateQueries(CATEGORIES_KEY)`. `CategoryFormPage.tsx:39,68,70` uses them. Errors still go through `extractProblemMessage` (`:74`). |

## Other Fixes Checked
- **release_reservation removal**: removed from `reservation_transitions.py` (the docstring now says "the public wrappers commit"), from `circulation/service.py` imports and `__all__`, and from `circulation_bridge.py`. At HEAD its only caller was `_withdraw_items` in `term_item_listings.py:801`, which is also gone (no `_withdraw_items`/`_WITHDRAWN_*`/`list_pending_swap_proposals_involving_items` left). `_cancel` is still used by `cancel_reservation` and at `:192`. No dangling references.
- **GZipMiddleware** (`app/main.py:145`): it is added after CORS, so it is the outermost layer and compresses CORS-decorated responses. The comment states why (~580 KB tree).
- **Category schemas** (`app/category/schemas.py:54,62`): `str_strip_whitespace=True` on Create/Update. A blank name now fails `min_length=1` with 422, and padded duplicates hit sibling uniqueness. Test in `tests/test_category_tree.py`.
- **useProducts** (`hooks/useProducts.ts:70-77`): invalidates `PRODUCTS_KEY` and `CATEGORIES_KEY` in parallel. **ProductFormPage**: invalidates categories after create/update (`:92`). The category `<select>` is replaced by `CategoryTreePicker` with `aria-labelledby`, `aria-invalid` and a `role="alert"` error. This matches the accessibility standard.

## Critical Issues
None.

## Warnings
None.

## Informational (new)

### N1. `DROP TABLE IF EXISTS` is not schema-qualified
- **Location**: `src/backend/alembic/versions/0069_vinted_categories.py:218`
- **Description**: when no temp table exists, an unqualified `DROP TABLE IF EXISTS wipe_categories` (and the other names) resolves through `search_path`. It would drop a permanent table with the same name if one ever existed. No such table exists today, so the risk is theoretical.
- **Suggestion**: `DROP TABLE IF EXISTS pg_temp.{table}`.
- **fixable**: true

### N2. GZip on authenticated JSON responses (BREACH hygiene)
- **Location**: `src/backend/app/main.py:145`
- **Description**: compression now applies to every response of 1000 bytes or more, including ones that carry tokens. BREACH needs a secret and attacker-reflected input in the same compressed body. The login/OAuth token endpoints don't reflect input, and their bodies are probably under 1000 bytes. Low risk.
- **Suggestion**: no action. If token responses ever grow or start reflecting input, exclude them (or compress only `/api/categories`).
- **fixable**: false

### N3. Filter typed before the tree loads doesn't auto-expand
- **Location**: `src/frontend/src/pages/admin/CategoryListPage.tsx:69-73`
- **Description**: branch expansion is keyed on filter text only. If the admin types before `categories` arrives, `filtered.branches` is empty at that moment, and the branches are not expanded when the data lands. Matches still show, but their ancestors stay collapsed until the next keystroke. A cache invalidation after delete/move doesn't re-expand either, which is arguably desirable.
- **Suggestion**: optional. Also track `index` in the guard (e.g. `expandedFor !== `${filter}` || indexChanged` only on first load).
- **fixable**: true

### N4. Missing-fields hint is attached to disabled buttons
- **Location**: `src/frontend/src/pages/product/ItemCreatePage.tsx:70-89`
- **Description**: native `disabled` buttons are skipped in Tab order, so keyboard and screen-reader users hear the description only in browse mode. The hint is visible text, which satisfies the cycle-1 recommendation.
- **Suggestion**: optional. Use `aria-disabled` and keep the `if (!canSubmit) return` guard, which already exists at `:34`.
- **fixable**: true

## Metrics
- Max function length (fix diffs): `upgrade()` in 0069, about 20 lines. The `CategoryListPage` body is unchanged in size.
- Max nesting depth: 3
- Potential vulnerabilities: 0 open (W1 and W3 resolved). N2 is hygiene only.
- N+1 query risks: 0. `check_text` now runs one more classifier call per needed-item create that has a description. This is bounded and expected.

## Prioritized Recommendations
1. Optional: N1 `pg_temp.` qualification (one-line change).
2. Optional: N3 and N4 frontend polish.
3. Update `../group-thing-ai/README.md` as noted in the work-log.
