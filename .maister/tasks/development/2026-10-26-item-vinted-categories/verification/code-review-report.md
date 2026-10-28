# Code Review Report

**Date**: 2026-10-27
**Path**: working tree vs HEAD (`src/backend`, `src/frontend`; `.maister/` excluded)
**Scope**: all (quality, security, performance, best practices)
**Status**: ⚠️ Issues Found (no critical)

## TL;DR
- No critical issues. Migrations 0064–0069 are ordered FK-safe, use bound params where values vary, and downgrade guards work; the authorization matrix is unchanged.
- `register_item` + `on_registered` writes item, ledger, preference and status in one commit; a 403 or 409 from the hook persists nothing.
- Main warning: the 0069 wipe deletes `product_photos` rows without queueing `storage.objects_delete`, so approved photos stay public in Spaces. The spec accepts this, but it can be fixed in SQL.
- Other warnings: the gift-limit and leaf-rule races (both accepted soft limits), needed-item `description` reaching the public page without moderation, and an orphan product when registration fails.
- Frontend: CategoryTreePicker meets the a11y/portal requirements (H1). Only info-level perf/UX notes.

## Key Decisions
- The destructive legacy wipe (all categories → all products → all items and their dependents) is by design (spec FR-19, Open Questions). It was reviewed for FK completeness, not for whether it should happen.
- Removing the photo-moderation listing gate is intentional (FR-15). Thumbnails still use only APPROVED photos (`first_approved_photo_by_product`), so pending photos are not exposed by listing.
- The gift-limit race and the leaf race are accepted soft limits (spec §Open Questions). They are reported as warnings for traceability.

## Open Questions / Risks
- Orphaned Spaces objects after 0069 (see W1). Decide whether to queue `storage.objects_delete` outbox rows from the migration, or to clean the bucket by hand before prod.
- Should the needed-item `description` go through `ensure_no_contact_info` / `check_text` like `name` does? It renders on the anonymous public term page (W3).

## Summary
- **Critical**: 0 issues
- **Warnings**: 5 issues
- **Info**: 9 issues

## Critical Issues
None.

## Warnings

### W1. Legacy wipe orphans photo files in object storage (approved ones stay public)
- **Location**: `src/backend/alembic/versions/0069_vinted_categories.py:82` (wipe_photos), `:120` (DELETE product_photos)
- **Category**: security / data hygiene
- **Description**: The photo rows are deleted, but no `storage.objects_delete` outbox event is queued. The normal path does queue one (`app/product/service.py:232` `_stage_photo_files_delete`). Photos uploaded as APPROVED are public objects, so their URLs keep working after the user's item is gone. The spec documents this as accepted ("a migration cannot reach storage").
- **Recommendation**: the migration can't call storage, but it can write the outbox row. Before deleting, `INSERT INTO outbox_entries (id, event_type, payload, status, ...) SELECT gen_random_uuid(), 'storage.objects_delete', jsonb_build_object('keys', jsonb_agg(...large_key, thumb_key)), 'PENDING', ... FROM product_photos WHERE id IN (SELECT id FROM wipe_photos)`, using the same payload shape as `_stage_photo_files_delete`. Otherwise, write down a manual bucket purge step.
- **fixable**: true

### W2. Gift limit (10) is check-then-insert with no per-owner lock
- **Location**: `src/backend/app/groups/application/term_item_listings.py:99` (`_require_gift_capacity`), callers `:136` and `set_item_listing_preference`
- **Category**: quality / concurrency
- **Description**: `FOR UPDATE` locks only the item row, so concurrent GIFT requests on *different* items of one owner both pass the COUNT. The register path takes no lock at all. Documented as a soft limit.
- **Recommendation**: if it ever needs to be hard, take `pg_advisory_xact_lock(hashtext(owner_party_id::text))` (or `FOR UPDATE` on the owner's profile row) before the COUNT, on both paths.
- **fixable**: false (accepted design trade-off)

### W3. Needed-item `description` is not moderated but renders publicly
- **Location**: `src/backend/app/groups/application/terms.py:187-189` (create), `update_needed_item` (description branch)
- **Category**: security (content)
- **Description**: `name` now goes through `rules.ensure_no_contact_info` + `check_text` (FR-17), but `description` (max 500, shown on the anonymous public term page) does not. This gap existed before, but the new name check makes the inconsistency visible.
- **Recommendation**: run `ensure_no_contact_info(name, description)` and `check_text(TextField.PRODUCT_DESCRIPTION, description, current)` when the description is set or changed.
- **fixable**: true

### W4. Category leaf rule / parent-has-products check races
- **Location**: `src/backend/app/category/service.py:155-160` (`create_category`), `src/backend/app/product/service.py:148,192` (`require_leaf_category`)
- **Category**: quality / concurrency
- **Description**: "parent has no products" and "category is a leaf" are separate check-then-write steps, so a concurrent child create and product create can leave a product on an inner node. This is accepted in the spec (admin-only, rare), and `update_product` tolerates it. Sibling-name uniqueness is backed by DB constraints, and a racing duplicate surfaces as 409 through the global `IntegrityError` handler (`app/core/errors.py:107`). That path is fine.
- **Recommendation**: optional: `SELECT ... FOR UPDATE` on the parent category row in both `create_category` and `require_leaf_category`.
- **fixable**: false (accepted)

### W5. Failed registration leaves a resolved product behind
- **Location**: `src/frontend/src/hooks/useCreateItem.ts:43-46`
- **Category**: best practices
- **Description**: `resolveProduct` commits a new Product before `registerInventoryItem`. A gift-limit 409 rolls back the item and preference but not the product. A retry reuses the product by name, so there are no duplicates. Still, "a gift-limit 409 leaves nothing behind" (spec Key Decisions) is not literally true, and an abandoned form leaves an orphan product.
- **Recommendation**: accept and document it, or let the backend create the product inside the register transaction later.
- **fixable**: false

## Informational

1. **`src/backend/alembic/versions/0069_vinted_categories.py:64`**: `CREATE TEMP TABLE ... ON COMMIT DROP` fails with "already exists" if 0069's upgrade runs twice in one transaction (e.g. a test doing upgrade → downgrade → upgrade on a single transactional connection). `DROP TABLE IF EXISTS` or `CREATE TEMP TABLE IF NOT EXISTS` + `TRUNCATE` would make it re-entrant. fixable: true
2. **0069 wipe completeness.** I checked every ORM column that points at items, reservations, products, photos, proposals, conversations, transactions and subject ids (circulation, groups, messaging, moderation, notifications, product models). All are covered, and ordering is dependent-before-referent. Only the term-end outbox events are deleted. The other queued event types (`groups.pledge_*`, `storage.objects_delete`) don't reference wiped rows, apart from the pledges wiped in 0067, whose payloads carry names only. No action. fixable: n/a
3. **0067 downgrade is a no-op, and 0068/0069 downgrades delete data.** These are documented and guarded (0069 raises if any product exists). Fine for dev. Flag before any prod rollback plan. fixable: false
4. **`src/frontend/src/utils/categoryTree.ts:68-75`**: `searchCategories` folds (NFD + regex) every category name on every keystroke, and the tree has about 1000 nodes. Acceptable, but storing the folded name in `buildCategoryIndex` would make search a plain `includes` scan. fixable: true
5. **`src/frontend/src/pages/admin/CategoryListPage.tsx:128`**: `siblings.indexOf(category)` per row is O(n²) per level. Also, `filterTree` runs twice per keystroke (`:76` and the `useMemo`). Negligible at the current size. Use the map index / `sort_order` position. fixable: true
6. **`src/frontend/src/app/AppDataContext.tsx:551-584`**: `let term;` is an implicitly typed evolving `let`. Annotate it as `TermResponse`. Rejected needed-item drafts are dropped (`setNeededDraft([])`) and only named in the toast, which follows spec M5 but means the user retypes them. fixable: true
7. **`src/frontend/src/pages/product/ItemCreatePage.tsx:28`**: the three submit buttons stay disabled until a name and a leaf category are set, but nothing tells screen-reader users why. Consider a hint linked by `aria-describedby`. fixable: true
8. **`src/frontend/src/pages/product/ItemFieldEditors.tsx:105`**: an item whose product sits on an inner node (from the accepted leaf race) can't be renamed through `NameCategoryEditor`. Save goes through `resolveProduct` → `get_or_create_product_by_name`, which calls `require_leaf_category` (`product/service.py:192`) and returns 409 even when the category is unchanged. Edge case. fixable: false
9. **Frontend mutations in `CategoryFormPage`** call `createCategory`/`updateCategory` directly, then `refetchCategories()`, instead of going through the `useCategories` hook mutations with `invalidateQueries` (data-fetching standard). This matches the pre-existing pattern. fixable: true

## Verified OK (focus areas)
- **Migrations 0064–0066/0068**: reversible, explicit `fk_`/`ix_`/`uq_` names, partial unique `uq_categories_root_name`, and downgrade in reverse dependency order. Deleting categories leaves-first avoids root-name collisions. 0069's varying values are bound (`_INSERT_CATEGORY`, the outbox delete). Static SQL only interpolates the constant `scope` string. The fixture is validated before any delete.
- **Category service**: EXISTS checks (`_has_products`, `_has_children`, `require_leaf_category`) in a single query each. Children are checked before products on delete. Sibling-scoped `sort_order` and `move_category`. Polish 409 messages.
- **register_item**: `listing_mode` without a hook raises `ValueError`, the owner check runs before the hook, and the hook enforces the PERSONAL inventory rule (403). One flush and one commit. `listing_mode` accepts only SWAP/GIFT (`schemas.py` validator).
- **listing_status lockstep**: every preference insert/delete (`set_item_listing_preference`, `list_registered_item`, `confirm_transaction`) updates the status in the same transaction. Soft delete is blocked while a preference exists.
- **Authorization**: `app/core/authorization_matrix.py` and `app/core` are unchanged. No new routes.
- **Dead-code removal** (FR-15): withdraw hooks, script, bridges and tests all removed. No stale references found.
- **CategoryTreePicker**: portaled to `document.body` with React events stopped at the wrapper. Every button is `type="button"`. Enter in the search always calls `preventDefault()`. Esc with a query clears only the search (`preventDefault` + `stopPropagation`). `aria-controls`/`aria-activedescendant` are set only while results show. `aria-labelledby` is used, never a wrapping `<label>`. Uses `ModalSheet` (focus trap and return). `sr-only`-style spacing uses `{" "}` outside the spans.
- **Admin pages**: the label is a `<span id>`, the parent comes from `?parent=` (validated as a UUID by the backend), and conflicts show in a `role="alert"`.

## Metrics
- Max function length (changed code): ~110 lines (`CategoryListPage` component body). Backend max is ~45 (`validate_fixture._walk` + wrapper).
- Max nesting depth: 4 (`validate_fixture`)
- Potential vulnerabilities: 2 (W1 public orphaned objects, W3 unmoderated public text)
- N+1 query risks: 0 new. Category list stays a single aggregated query. `confirm_transaction`'s per-reservation preference loop was already there and is bounded to 1–2 rows.

## Prioritized Recommendations
1. W1: queue `storage.objects_delete` for wiped photos in 0069, or document a manual bucket purge before running on any shared environment.
2. W3: moderate the needed-item `description` the same way as `name`.
3. Info 1: make 0069's temp tables re-entrant.
4. Optional hardening: owner-level lock for the gift limit (W2) and a parent-row lock for the leaf rule (W4), if they are ever promoted from soft limits.
5. Small frontend cleanups (Info 4–7, 9).

## Areas not deeply reviewed
- Test files (backend and frontend) were not reviewed line by line; only their presence and coverage intent were checked against the spec.
- `ProductFormPage`/`ProductListPage`/`ProductDetailPage`, `ItemEditPage`, `ItemGalleryEditor`, `MeetingsView`, `NeededItemsBlock`, `PublicTermView`: only checked for renamed fields (`product_name` → `name`, camelCase → snake_case `Category`). No leftovers found.
- `alembic/data/vinted_categories_pl.json` content: not inspected; it is validated by `validate_fixture` and `test_vinted_category_fixture.py`.
