# Gap Analysis: Vinted category tree + Oddam / Zamienię / Wersja robocza on add-item

## TL;DR
- Two independent gaps. (1) Categories are flat (no `parent_id`, global `uq_categories_name`, 5 seeded rows), and every picker is a flat `<select>`. The task needs a hierarchical table, a seeded Vinted tree (Polish), a shared cascading-plus-search picker in 5 consumers, and a tree-aware admin. (2) The listing mode cannot be set at creation: `set_item_listing_preference` returns 409 while photos are PENDING/NEEDS_REVIEW, and uploading a photo deletes prefs. There is no "pending intent" concept.
- Critical finding: photo approval mostly happens **outside this repo**. VPS B's `moderation-cron` (group-thing-ai) writes `product_photos.status` straight to the shared DB. An in-process "on approve" hook therefore cannot activate intents by itself. Activation needs either a sweep job in this app or read-time derivation.
- Draft = no pref row. This already works today; only the button and the absence of a mode call are needed.
- Risk: high. Effort: high (about 2 schema migrations + 1 data seed, 1 new backend concept, ~6 frontend surfaces, ~20 test files touched).

## Key Decisions
- Characteristics: modifies_existing_code + creates_new_entities + involves_data_operations + ui_heavy; no reproducible defect. The category entity and the add form change, and the pending-intent and tree concepts are new.
- Category stays on `Product` (`products.category_id`). Items still resolve products by `(lower(name), category_id)`. A leaf id only narrows product identity, so no change is needed to `InventoryItem`.
- Path labels (`Kobiety › Ubrania › Sukienki`) should be built on the client from the cached `useCategories` tree, not added to backend responses. This avoids churn in the exact key-set tests (`test_public_term.py`, `test_organizer_*`).
- The existing 5 categories are dev data (per clarification), so the seed migration may re-point their products to a Vinted leaf (or "Inne" leaf) and drop the old rows. The `test_category_reintroduction.py` 5-row assertion must be rewritten.
- The uncommitted user work (AddView/router/appHelpers/AppPage/EventCreateView) only adds a "wydarzenie" view and restyles tiles. `/product/new` stays the entry point. Low overlap: this task should not need to touch `router.tsx`/`AddView.tsx`. `appHelpers.ts` (MAX_GIFT_ITEMS lines) may be read but should not be edited, or only after the user commits.

## Open Questions / Risks
- **Vinted data provenance.** Vinted has no public catalog API, and scraping may conflict with its ToS. The tree (an estimated ~800–1000 nodes, depth up to 5, Polish names from vinted.pl) must be compiled once into a repo fixture. Accuracy vs. the live catalog is a one-time snapshot.
- **Repeated names.** Vinted repeats names ("Inne", "Akcesoria", "Buty" under Kobiety/Mężczyźni/Dzieci). The uniqueness constraint must move to `(parent_id, name)`, with a separate partial index for roots (`parent_id IS NULL`). `Category.__eq__`/`__hash__` (business key = name) must change too.
- **Shared product across owners.** `withdraw_product_listings` hits *every* owner's items of a product. Intent semantics must hold for other owners too (existing behavior, now more visible).
- **Moje rzeczy toggles are disabled while photos are pending.** Without a change there, an item created with "Oddam" plus a pending photo looks like a draft, and the user cannot see or alter the intent. This is a CREATE-without-READ orphan.
- **REJECTED photos.** A rejected photo is not "unmoderated", so the intent activates once no PENDING/NEEDS_REVIEW photos remain, even if every photo was rejected. Is that acceptable?
- **Leaf becoming non-leaf.** If an admin adds a child under a leaf that already has products, those products sit on a non-leaf.

## Summary
- **Risk Level**: High
- **Estimated Effort**: High
- **Detected Characteristics**: modifies_existing_code, creates_new_entities, involves_data_operations, ui_heavy

## Task Characteristics
- Has reproducible defect: no
- Modifies existing code: yes (add form, item edit, needed items, term edit, admin categories, listing-preference service)
- Creates new entities: yes (category hierarchy, pending listing intent)
- Involves data operations: yes (Category tree CRUD, ListingIntent CRUD, Vinted seed)
- UI heavy: yes (new tree picker, 3 submit buttons, admin tree UI)

## Gaps Identified

### Missing Features
- **Category hierarchy**: `app/category/models.py` has `name/description/sort_order` only; there is no `parent_id`. `CategoryResponse` has no parent. Unique constraint `uq_categories_name` is global (migration 0025 L79).
- **Vinted tree data**: no fixture or source exists in the repo.
- **Tree picker component**: none exists. The closest a11y pattern is the combobox in `components/shared/LocationAddForm.tsx` (ArrowUp/Down, Enter, Esc closing only the listbox inside sheets).
- **Pending listing intent**: no storage and no activation path. Approval paths are (a) admin `moderation/service.py::decide` (the PHOTO subject has no `after_decide` hook, L145-150) and (b) the external cron writing directly to the DB, with no app callback. The app already has an APScheduler (`main.py`, `_run_media_sweep` every 15 min, `_run_term_end_scan` every 1 min) that a sweep can join.
- **3-way submit**: `ItemCreatePage.tsx` has a single "Dodaj rzecz" button and the hint "sposób udostępnienia … ustawisz na liście „Moje rzeczy”".
- **Server-side gift limit**: `MAX_GIFT_ITEMS=10` exists only in the frontend (`appHelpers.ts:114`, `AppDataContext.tsx:602`, `MyItemsView.tsx:231`). The backend has no check.

### Incomplete Features
- **Category selection everywhere**: a flat select with `categories[0]` preselected in `ItemCreatePage`, `NameCategoryEditor` ("Typ rzeczy"), `NeededItemQuickAddForm`, `EditTermDialog` (`makeEmptyDraft` L54-55), and admin `ProductFormPage`. A tree has no sensible default, so the field must start empty and be required.
- **Admin categories**: `CategoryListPage` uses flat up/down `move_category` over the global `sort_order`; `CategoryFormPage` has no parent field. Delete returns 409 only when products exist, with no check for children.
- **Product filter**: `product/query_service.py` (L132-173) filters on an exact `category_id`. Filtering by a parent node needs descendants (recursive CTE, or the id set computed client-side).
- **Frontend `Category` type**: camelCase `sortOrder/productCount` vs backend snake_case. Adding `parent_id` must use snake_case, and the stale fields should be fixed at the same time.

### Behavioral Changes Needed
- Label "Typ" changes to "Kategoria" (the add form, and "Typ rzeczy" in the item edit form).
- `set_item_listing_preference`: today it returns 409 while photos are pending. Instead it should store an intent and return 200 with a pending state (recommended, see decision `intent-on-put`).
- `withdraw_product_listings` (on a pending photo upload): today it deletes prefs. Recommended: convert active prefs into intents so they re-activate after approval (consistent with clarification 4). Proposals are still rejected as today.
- Create flow: `useCreateItem` gains `mode: GIFT|SWAP|null`. The mode call must happen **after** the photo uploads, otherwise the upload withdraws it.

## User Journey Impact Assessment

| Dimension | Current | After | Assessment |
|-----------|---------|-------|------------|
| Reachability | Dodaj → `/product/new`; mode set later in Moje rzeczy (2nd journey) | Same entry; mode chosen at submit | Improved: one fewer journey |
| Discoverability | Mode 4/10 (hint text only, separate screen) | 9/10 (three primary buttons) | +5 |
| Category finding | 9/10 (5 options) | 6/10 without search, 8/10 with search + breadcrumb (~1000 nodes) | Search is mandatory, not optional |
| Flow Integration | Neutral | Positive if Moje rzeczy shows "czeka na moderację"; negative if the intent is invisible | Depends on decision `intent-visibility` |

Personas: owner (add/edit item, needed items as organizer), organizer (term edit / needed items), admin (category tree, product form). All three get the same shared picker.

## Data Lifecycle Analysis

### Entity: Category (tree)

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | `POST /api/categories` exists, no `parent_id` | `CategoryFormPage` without parent field | Admin nav → Kategorie | Partial: no child creation |
| READ | `GET /api/categories` flat list | flat `<select>` x5 consumers | Rendered | Partial: no tree, no path labels |
| UPDATE | `PUT` + `move` (flat sort) | Form + up/down | Admin | Partial: sibling-scoped sort missing |
| DELETE | 409 when products exist | Delete button | Admin | Partial: no 409 for children |

Completeness for the tree: 25% (all four exist only in flat form). Seeding (data migration) replaces most manual CREATE.

### Entity: Listing intent (new; "Oddam/Zamienię pending moderation")

| Operation | Backend | UI | Access | Status |
|-----------|---------|-----|--------|--------|
| CREATE | Missing | Missing (Oddam/Zamienię buttons) | `/product/new` | Missing |
| READ | Missing (`MyInventoryItemResponse.listing_mode` shows only active prefs) | Missing in MyItemsView / ItemDetailPage | — | Missing: orphan risk |
| UPDATE | Missing (PUT returns 409 while pending) | MyItemsView toggles are disabled while pending | — | Missing |
| DELETE | Missing | Missing ("Wersja robocza"/clear) | — | Missing |
| ACTIVATE | Missing (cron is external; admin `decide` has no PHOTO hook) | n/a | n/a | Missing |

Completeness: 0%. The spec must cover all rows, otherwise the intent is CREATE-without-READ.

### Entity: Item draft
CREATE = register item without a pref (exists). READ = MyItemsView with `listing_mode: null` (exists). UPDATE/DELETE exist. Completeness 100%; only the button is missing.

**Orphaned Operations**: intent CREATE without READ/UPDATE (if MyItemsView is not extended); category tree CREATE (child) without admin UI (if admin is not rebuilt; in scope per clarification 5).
**Missing Touchpoints**: ItemDetailPage category display (shows `category_name` only; should show the path); admin ProductListPage/ProductDetailPage category filter or display; MyItemsView mode filter and the "Do oddania n/10" counter (should intents count?).

## Issues Requiring Decisions

### Critical
1. **intent-storage**: where to store the pending intent.
   - A) New table `item_listing_intents` (item_id unique, owner_party_id, mode), activated by moving the row into `item_listing_preferences`.
   - B) Nullable/boolean column on `item_listing_preferences` (e.g. `pending`), with every listing read filtered on it (~8 read sites: repository 688-770, organizer_page, public_view, exchange_summary, term_end_scan, notifications).
   - C) Derive at read time: keep the pref row while photos are pending and filter all listing reads by "no unmoderated photos". This needs no activation at all.
   - Recommendation: **A**. All existing listing reads stay untouched (the lowest regression surface in the 974-line `term_item_listings.py`), and it does not reintroduce a status-like column on prefs. C is elegant but touches every listing query and the cron-written DB contract.
2. **intent-activation**: how intents become active when the external cron approves photos.
   - A) APScheduler sweep job (e.g. every 1 min, like `_run_term_end_scan`) that promotes intents whose product has no PENDING/NEEDS_REVIEW photos, using `FOR UPDATE SKIP LOCKED`, plus an immediate promotion in a new PHOTO `after_decide` hook for admin decisions.
   - B) Sweep only.
   - C) Change group-thing-ai to call back.
   - Recommendation: **A**. The cron lives in another repo and writes straight to the DB. The sweep pattern already exists (`sweep_superseded_media`), and the admin hook gives instant feedback.
3. **intent-visibility**: must MyItemsView and ItemDetailPage show the pending intent and let the user change or clear it?
   - Options: Yes (badge "Oddam — po moderacji zdjęć", toggles enabled and writing the intent) / No (intent invisible until activated).
   - Recommendation: **Yes**. Otherwise it is a CREATE-without-READ orphan, and the user sees a "draft" they did not choose.
4. **vinted-source**: where the tree data comes from.
   - A) Compile a one-time Polish snapshot of the vinted.pl catalog into a repo JSON fixture, inserted by a data migration.
   - B) Fetch from Vinted at runtime or deploy time.
   - C) User supplies the file.
   - Recommendation: **A**, built by the implementer from vinted.pl navigation, and the user reviews the fixture before the seed. B depends on an unofficial API and ToS. Confirm that the full depth (Kobiety/Mężczyźni/Dzieci/Dom/Elektronika/Rozrywka/Hobby i kolekcje/Sport/Zwierzęta, down to leaves) is acceptable even though it duplicates gendered branches.

### Important
1. **intent-on-put**: should `PUT /api/item-listing-preferences/{id}` store an intent while photos are pending, instead of returning 409?
   - Options: Unify (PUT handles both) / Keep 409 and add a create-only path.
   - Default: Unify. One endpoint for create and Moje rzeczy, and it removes the disabled-toggle dead end.
2. **intent-on-upload**: when a photo is uploaded to an item that is already listed, should its active pref be converted to an intent (auto re-list after approval) or deleted (as today)?
   - Default: convert. This is consistent with clarification 4. Proposals are still rejected and their proposers notified.
3. **gift-limit-server**: should `MAX_GIFT_ITEMS=10` be enforced in the backend, and do intents count toward it?
   - Options: Server check counting active + intent GIFT / UI-only counting both / UI-only active only.
   - Default: server check counting both. Two write paths (create + PUT) now exist, and the sweep could otherwise push a user past 10.
4. **needed-item-level**: needed items and EditTermDialog also resolve a Product via `/api/products/resolve`. May they use a non-leaf category ("szukam książek")?
   - Options: Leaf-only everywhere (resolve validates leaf) / Leaf-only for inventory items, any node for needed items.
   - Default: leaf-only everywhere. This gives one picker mode and a simple resolve validation.
5. **admin-tree-ops**: depth of admin tree management.
   - Options: Create child, rename, sibling reorder, delete (409 if children or products), **no reparenting** / Also move between parents (drag or "Zmień rodzica").
   - Default: no reparenting. Minimal implementation; the seed defines the structure.
6. **admin-leaf-split**: may an admin add a child under a leaf that has products?
   - Options: Block with 409 / Allow, and the products stay on the now-inner node.
   - Default: block with 409 ("Kategoria ma przypisane rzeczy").
7. **legacy-remap**: how to handle the 5 dev categories.
   - Options: Re-point products to a Vinted leaf by mapping (Zabawka→Dzieci›Zabawki, Książka→Rozrywka›Książki, Gra→Rozrywka›Gry planszowe, Ubranie→…›Inne, Inne→Inne), then delete the old rows / Delete them along with their products.
   - Default: re-point by mapping. It is cheap and keeps dev items working.
8. **seed-migration-shape**: one data revision loading a JSON fixture (`alembic/data/vinted_categories_pl.json`) vs. an inline Python literal. Optional `external_id` (Vinted catalog id) column for idempotent re-seeding.
   - Default: JSON fixture + `external_id` unique nullable column, in a schema revision separate from the data revision (per migrations.md). The downgrade deletes the seeded rows, restores the 5 rows and re-points their products.
9. **picker-ux**: cascading (drill-down list per level with breadcrumb/back) plus a search box matching any node name and showing full paths, in a `ModalSheet` on mobile.
   - Options: Sheet (ModalSheet, trapFocus, useRegisterOpenSheet) / Inline cascading selects.
   - Default: ModalSheet with drill-down and search. ~1000 nodes do not fit inline selects on mobile, and the a11y standards already cover sheets.

## Recommendations
- Backend: migration 0064 (`parent_id` FK `fk_categories_parent_id_categories` + index, uniqueness `uq_categories_parent_id_name` + a partial unique index for roots, optional `external_id`), 0065 (Vinted seed + legacy re-point), 0066 (`item_listing_intents` table), each with a downgrade→upgrade test.
- Backend: leaf validation in `get_or_create_product_by_name` (422/409 Polish message); `CategoryResponse.parent_id`; children check on delete; sibling-scoped `move_category`.
- Backend: intent service plus an APScheduler sweep plus a PHOTO `after_decide` hook; PUT stores an intent when pending; `withdraw_product_listings` converts prefs to intents; optional server gift limit; `MyInventoryItemResponse` gains `pending_listing_mode`.
- Frontend: shared `CategoryTreePicker` (search + drill-down, path label helper in `utils/`), used by ItemQuickAddForm, NameCategoryEditor, NeededItemQuickAddForm, EditTermDialog, ProductFormPage, and CategoryFormPage (parent select). Tree-structured CategoryListPage.
- Frontend: ItemCreatePage gets three buttons (Oddam / Zamienię from `EXCHANGE_MODE_LABELS`, "Wersja robocza"), the hint is removed, and the mode is set after the photo uploads. MyItemsView/ItemDetailPage show the pending intent.

## Risk Assessment
- **Complexity Risk**: High. A new backend concept with an asynchronous activation path across repos, plus a large seed and a generic tree UI.
- **Integration Risk**: Medium-High. Five category consumers; listing-preference semantics are consumed by about 8 backend modules (mitigated by intent-storage A). External cron contract is unchanged.
- **Regression Risk**: Medium. About 20 test files rely on the flat categories or the 5-row seed (`test_category_reintroduction`, `test_category_module`, `test_product_category_fk_rename`, `ItemCreatePage.test`, `ItemQuickAddForm*.test`, `CategoryListPage.test`, `NeededItemQuickAddForm`, `EditTermDialog`, `MyItemsViewCategory.test`). The photo-moderation gate tests (`test_photo_moderation_gate/_withdraw/_repoint`) change semantics if intent-on-put or intent-on-upload are adopted.
