# Codebase Analysis Report

**Date**: 2026-10-26
**Task**: Add-item form: swap "Typ" for a Vinted category tree; end the form with Oddam / Zamienię / Wersja robocza
**Description**: In the "add item" flow (dodawanie rzeczy), replace the current "type" (Typ) field with a "category" (kategoria) field whose options are the full Vinted category tree. The form should end with 3 buttons: "Oddam" (gift), "Zamienię" (swap), "Wersja robocza" (draft).
**Analyzer**: codebase-analyzer skill (2 Explore agents: File Discovery + Code Analysis, Context Discovery)

---

## TL;DR
- On the add form, "Typ" already *is* the category picker. It is a flat `<select>` over the `categories` table, which holds 5 seeded rows (Zabawka, Książka, Gra, Ubranie, Inne) plus any added by admins. So the task is mostly "make categories hierarchical and seed the Vinted tree", not "replace a type field".
- The repo has no Vinted data, and `categories` has no `parent_id`. `uq_categories_name` is a global unique constraint, and it blocks Vinted's repeated names such as "Inne" under different parents.
- Oddam/Zamienię is set today only after creation, on "Moje rzeczy", as an `item_listing_preferences` row. Photo moderation returns 409 for it while photos are pending, and also deletes it when a photo is uploaded. So "mode at creation" conflicts with the current create-then-upload-photos order.
- "Wersja robocza" fits the existing state of having no listing-preference row (unlisted, owner-only), so no new status column is needed.
- Overall: complex (migration, tree API/UI, shared category consumers, moderation coupling). Risk: medium-high.

## Key Decisions
- Draft = no `item_listing_preferences` row. That state already means "saved, not offered" everywhere (term listings show only items with a pref row + AVAILABLE).
- Keep categories as backend data, extended with a self-referencing `parent_id` and seeded via an Alembic data migration (pattern of `0025_category_reintroduction`). Do not use a static TS/JSON tree: `products.category_id` is a NOT NULL FK, and `useCategories` and `itemQuickAdd` deliberately avoid hardcoded lists.
- The category stays on `Product` (`products.category_id`), not on `InventoryItem`. The resolve-product flow (`lower(name)` + `category_id`) keeps working with leaf ids.
- Mode at creation needs an explicit design for photo moderation. Either (a) a backend "pending intent" that is stored and activated when photos are approved, or (b) the UI sets the mode after upload and tells the user it will be applied after moderation. The gap/spec phase has to choose one.
- The gift limit (`MAX_GIFT_ITEMS=10`) is enforced only in the UI, so the "Oddam" create button must apply the same check (`AppDataContext.setItemMode` logic).

## Open Questions / Risks
- **Source of the Vinted tree.** There is no data in the repo. Licensing, depth (Vinted has 4–5 levels and hundreds of nodes), and Polish labels need to be confirmed with the user, as does whether categories split by gender/age (Damskie/Męskie/Dzieci) are wanted.
- **The 5 existing categories and their products.** Should they be remapped to Vinted leaves, kept as legacy roots, or soft-retired? Admin delete returns 409 while a category has products.
- **Leaf-only selection?** Can an item be assigned to an intermediate node? This affects validation and the product filter (`product/query_service.py` filters on an exact `category_id`; a parent filter would need descendants).
- **Shared consumers.** The same `useCategories`/flat select feeds the needed-item form (`NeededItemQuickAddForm`), `EditTermDialog`, the item edit page (`NameCategoryEditor`), and admin CRUD. `CategoryListPage` uses up/down `sort_order` moves that assume a flat list. Scope: does the tree replace the picker everywhere or only on add?
- **Name uniqueness.** `uq_categories_name` has to become unique per `(parent_id, name)`. Admin create/update and its 409 handling change with it.
- **Moderation coupling.** `add_product_photo` → `withdraw_product_listings` deletes the prefs of all items of that product, and `set_item_listing_preference` returns 409 while photos are PENDING/NEEDS_REVIEW. A naive "Oddam" at create time either fails or is silently withdrawn.
- **Tests that break if the seed changes.** `test_category_reintroduction.py` asserts exactly 5 seeded rows in order. `test_product_category_fk_rename.py` uses the seeded "Zabawka".
- **Uncommitted work in the same area.** `AddView.tsx`, `router.tsx`, `appHelpers.ts`, `AppPage.tsx`/test are modified and `EventCreateView.tsx` is untracked. Coordinate with it to avoid conflicts (the AddView tile links to `/product/new`).
- **API type mismatch.** The frontend `Category` type uses camelCase (`sortOrder`, `productCount`) while the backend sends snake_case. This is harmless today because only `id`/`name` are read, but adding `parent_id` must use the backend's casing.

---

## Summary

The add-item flow (`/product/new` → `ItemCreatePage` → `ItemQuickAddForm`) collects Nazwa, Stan and "Typ". "Typ" is a select over the flat backend `categories` table. Creation chains profile → personal inventory → resolve product (name + category) → register inventory item → upload photos, and never sets a listing mode. Gift/swap is a separate post-creation preference, gated by photo moderation and a UI-only gift limit. Draft is not a concept today, but "no preference row" already behaves like one. The main work is making categories hierarchical, seeding the Vinted tree, building a tree-aware picker, and adding three-way submit semantics that respect moderation.

---

## Files Identified

### Primary Files

**src/frontend/src/components/shared/ItemQuickAddForm.tsx** (77 lines)
- Presentational form: Nazwa (L27), Stan select over `CONDITION_LABELS` (L37), `<Field label="Typ"><select value={value.category_id}>` over `useCategories()` (L52-65).
- The "Typ" field gets replaced here by a "Kategoria" tree picker.

**src/frontend/src/pages/product/ItemCreatePage.tsx** (141 lines)
- Route `/product/new`. `draft: ItemQuickAddValue` state (L20). Defaults `category_id` to `categories[0]` (L27). `handleSubmit` → `createItem` → navigate `/product/{id}` (L29-42).
- Shows the hint "sposób udostępnienia (oddam / zamienię) ustawisz na liście „Moje rzeczy”" (L52-55) and a single "Dodaj rzecz" button (L61-67). Validation: name not blank. `NewPhotosField` from L88.
- This is where the three buttons go and the hint is removed. The default of first category can no longer be preselected in a tree.

**src/frontend/src/hooks/useCreateItem.ts** (58 lines)
- Plain `useCallback` orchestration: `getMyProfile` → `getOrCreatePersonalInventory` → `resolveProduct({name, category_id})` → `registerInventoryItem` → `addProductPhoto` per photo. Returns `{item, failedPhotos}`.
- Needs a `mode: GIFT | SWAP | null` parameter (or a follow-up call) that respects moderation.

**src/frontend/src/utils/itemQuickAdd.ts** (20 lines)
- `ItemQuickAddValue {name; condition; category_id}`. The default condition is GOOD.

**src/frontend/src/hooks/useCategories.ts** (76 lines) / **src/frontend/src/api/categories.ts** (49 lines)
- `useQuery(["categories"], getCategories)` returns a flat `Category[]` by `sort_order`. Needs `parent_id` plus tree-building or tree helpers. The camelCase type mismatch is noted above.

**src/backend/app/category/models.py** (37 lines)
- `Category` (`categories`): `name String(100)` unique (`uq_categories_name`), `description`, `sort_order`, UUID id (since 0041). No `parent_id`/slug. Needs a self-referencing FK and a uniqueness change.

**src/backend/app/category/service.py** (151 lines) + router/schemas
- Flat list with `product_count` LEFT JOIN, CRUD, delete 409 `CategoryHasProductsException`, `move_category`. `GET /api/categories` (READ/mcp:read); mutations need ADMIN. `CategoryResponse {id,name,description,sort_order,product_count,created_at,updated_at}` needs `parent_id` added.

**src/backend/alembic/versions/** (head `0063_drop_pledge_fulfillment.py`, next `0064`)
- Needs one schema migration (`parent_id`, uniqueness change) and a separate data migration seeding the Vinted tree, per `standards/backend/migrations.md` (separate schema/data revisions, reversible, a downgrade→upgrade test per migration).

**src/backend/app/groups/application/term_item_listings.py** (974 lines)
- `set_item_listing_preference` (L98-143): owner + PERSONAL inventory check, 409 `PHOTOS_IN_MODERATION_MESSAGE`, `null` deletes the row. Also covers the listing queries, take/propose/accept, `withdraw_product_listings`, and `withdraw_item_listing_if_photos_pending`. Central to mode at creation.

### Related Files

Frontend:
- **src/frontend/src/api/itemListingPreferences.ts**: `ListingMode "GIFT"|"SWAP"`, `setItemListingPreference` → `PUT /api/item-listing-preferences/{itemId}`.
- **src/frontend/src/api/products.ts**: `ResolveProductRequest {name, category_id}`. **api/inventories.ts**: `ItemCondition`, `MyInventoryItemResponse.listing_mode`, `photos_moderation_pending`.
- **src/frontend/src/app/AppDataContext.tsx** (1166 lines): `useCategories` (L129-132), `itemModes` (L241), `setItemMode` (L595-622) with balance lock, client-side `MAX_GIFT_ITEMS`, and `setItemListingPreference`. Reuse this logic for the "Oddam" button.
- **src/frontend/src/utils/appHelpers.ts** (L105-138): `ITEM_MODES`, `MAX_GIFT_ITEMS=10`, `GIFT_LIMIT_MESSAGE`, mode maps/styles. Has uncommitted edits.
- **src/frontend/src/pages/term/components/termLabels.ts**: `EXCHANGE_MODE_LABELS {GIFT:"Oddam", SWAP:"Zamienię"}`. Reuse these labels.
- **src/frontend/src/pages/items/MyItemsView.tsx** (454 lines): mode filter (L136), "Do oddania: n/10" counter (L231/275), mode toggles (L396-418) disabled when locked, photos pending or over the limit, `FloatingAddButton` → `/product/new` (L450).
- **src/frontend/src/pages/add/AddView.tsx** (102 lines): tile to `/product/new` (L50). Has uncommitted edits.
- **src/frontend/src/pages/product/ItemFieldEditors.tsx** (211 lines): `NameCategoryEditor` `<select aria-label="Typ rzeczy">` (L54-126). **ItemEditPage.tsx** (L155-162), **ItemDetailPage.tsx** (L137 `category_name ?? NO_CATEGORY_LABEL`), **hooks/useItemDetail.ts** (L164-170 `saveNameCategory`), **api/items.ts** (L35-36), **pages/product/itemPageShared.ts**.
- Other flat-category consumers: **components/shared/NeededItemQuickAddForm.tsx** (L40), **utils/neededItemQuickAdd.ts**, **components/panel/EditTermDialog.tsx** (L54-92), admin **CategoryListPage / CategoryFormPage / ProductFormPage / ProductListPage / ProductDetailPage**, **hooks/useProducts.ts**, **api/groups.ts:166**, **api/terms.ts:51**.
- **src/frontend/src/utils/productCategory.ts**: only `CONDITION_LABELS`.
- **src/frontend/src/router.tsx**: `/product/new` → `ItemCreatePage` (L138-139). Has uncommitted edits.

Backend:
- **app/product/models.py** (121 lines, L35-59): `Product.category_id` UUID FK NOT NULL, `ix_products_category_id`.
- **app/product/service.py** (547 lines, L178-205): `get_or_create_product_by_name` (lower name + category_id, `ensure_no_contact_info`, `check_text` moderation). `POST /api/products/resolve` (EDIT).
- **app/product/query_service.py** (L132-173): filters by an exact `category_id`.
- **app/circulation/models.py** (353 lines): `InventoryItem` (L176-207) has no type/category/status. `InventoryBalance` holds the status.
- **app/circulation/application/inventory_items.py**: `register_item` (L37-72) creates the item + an AVAILABLE balance + a REGISTER movement in one commit. `_has_standing_listing`; `soft_delete_item` refuses listed items.
- **app/circulation/router.py**: `POST /api/inventory-items` (L127-140), `PATCH` (L157-169) with `on_product_changed=withdraw_item_listing_if_photos_pending`.
- **app/circulation/schemas.py**: `CreateInventoryItemRequest {inventory_id, product_id, condition}`. `ItemDetailsResponse.category_id/category_name`. **infrastructure/repository.py** (L341-373) outer-joins categories.
- **app/groups/models.py** (L289-319): `ItemListingPreference` (`item_id` unique without FK, `owner_party_id`, `mode` GIFT|SWAP).
- Mode consumers: `exchange_summary.py`, `term_end_scan.py`, `organizer_page.py` + `repository.py:1046,1058`, `public_view.py`, `repository.py:688-770`, notifications, `scripts/withdraw_unmoderated_listings.py`.
- Category consumers: `groups/repository.py:479-497` (NeededItem joins Category), `groups/application/terms.py:169-180`, `public_view.py:298`, `core/authorization_matrix.py:214-220`.

---

## Current Functionality

### Key Components/Functions
- **ItemQuickAddForm**: controlled 3-field form (Nazwa, Stan, Typ).
- **ItemCreatePage**: owns the draft state and photos, single submit, redirects to item detail.
- **useCreateItem**: a 4–5 call client-side chain with no listing mode.
- **get_or_create_product_by_name**: product identity = (lower(name), category_id).
- **register_item**: creates the item, an AVAILABLE balance, and a REGISTER ledger entry.
- **set_item_listing_preference**: upserts or deletes the GIFT/SWAP preference, with the moderation gate.
- **withdraw_product_listings**: deletes the prefs of all items of a product when a photo goes PENDING.

### Data Flow
`ItemCreatePage` → `useCreateItem`:
1. `GET profile` → `POST /api/inventories` (personal, get-or-create)
2. `POST /api/products/resolve {name, category_id}` → Product (category lives here)
3. `POST /api/inventory-items {inventory_id, product_id, condition}` → InventoryItem + Balance(AVAILABLE)
4. `POST` product photos (each may be PENDING → `withdraw_product_listings`)
5. Navigate to `/product/{id}`. Later, on "Moje rzeczy": `PUT /api/item-listing-preferences/{id} {mode}`.

Visibility: an item with a pref row + AVAILABLE balance appears in term listings (mine/browse/public/organizer). Without a row it is visible only to the owner (`listing_mode: null`), which is the de facto draft.

### Category history
0006 replaced the table with a `ProductCategory` enum. 0025 reintroduced the table, seeded with 5 rows. 0041 moved ids to UUID. The tree is flat throughout.

---

## Dependencies

### Imports (What This Depends On)
- TanStack Query (`useCategories`), Chakra UI (`Field`, select), react-router (navigate)
- APIs: categories, products/resolve, inventories, inventory-items, product photos, item-listing-preferences
- Backend: SQLAlchemy models Category/Product/InventoryItem/ItemListingPreference; text/image moderation services

### Consumers (What Depends On This)
- **Category list/shape**: ItemQuickAddForm, NeededItemQuickAddForm, EditTermDialog, NameCategoryEditor/ItemEditPage, ItemDetailPage, admin Category*/Product* pages, useProducts, groups/terms APIs. Backend: product query_service, circulation item details, groups needed items, terms, public_view, authorization matrix.
- **Listing mode**: MyItemsView, AppDataContext, term pages (useItemTake, PublicTermView), organizer ExchangeItemCard, and the backend modules listed above.

**Consumer Count**: about 15 frontend + about 10 backend files
**Impact Scope**: High for the category schema/shape change; Medium for the add form and buttons.

---

## Test Coverage

### Test Files
Backend (`src/backend/tests/`):
- **test_category_reintroduction.py**: asserts exactly 5 seeded rows in order. Breaks if the seed changes.
- **test_category_module.py**: permissions, CRUD, delete 409, ordering, product_count, move.
- **test_product_category_fk_rename.py** (uses "Zabawka"), **test_product_resolution.py**, **test_item_details.py** (L90-130).
- **test_term_item_listings.py / _router.py**, **test_photo_moderation_gate.py / _withdraw.py / _repoint.py**, **test_lend_listing_preferences_migration.py**.
- Exact key-set assertions that may need updating if category fields are added to responses: **test_public_term.py** (L180/192/246), **test_organizer_page.py** (171-183), **test_organizer_terms.py:51**, **test_organizer_bridges.py:155**.

Frontend (`src/frontend/src/test/`):
- **ItemCreatePage.test.tsx** (237 lines): "Typ" label, first category preselected, resolveProduct payload, disabled submit, photos, single "Dodaj rzecz". Must be rewritten.
- **ItemQuickAddForm.test.tsx** (81 lines, "exactly 3 fields … type select"), **ItemQuickAddFormCategory.test.tsx**.
- **MyItemsViewCategory.test.tsx** (601 lines, toggles, gift limit 10), **ItemDetailPage.test.tsx**, **useItemDetail.test.tsx**, **useCategories.test.ts**, **CategoryListPage/CategoryFormPage**, **ProductFormPageCategory**, **ProductCategoryDisplayByCategoriesHook**, **NeededItemQuickAddForm**, **EditTermDialog**, **AppPage.test.tsx** (uncommitted edits), **TermPage**, **PendingActionsHost**, **pages.test.tsx**, **useProducts.test.ts**, **OrganizerItemRoute.test.tsx**.

### Coverage Assessment
- **Test count**: good coverage of categories, add form and moderation; about 20 test files are relevant.
- **Gaps**: no tests for hierarchical categories, mode at creation, or a draft path. There is no exact key-set assertion on `InventoryItemResponse`/`MyInventoryItemResponse`.

---

## Coding Patterns

### Naming Conventions
- **Components**: PascalCase `*Page`, `*View`, `*Form`, `*Editor`.
- **Hooks**: `use<Resource>` in `src/hooks/`, wrapping `src/api/*.ts`.
- **Files**: backend `app/<module>/{models,service,router,schemas}.py`, `application/`, `infrastructure/`. Alembic `NNNN_snake_name.py`. Tests flat in `tests/test_<feature>.py` and `src/test/*.test.tsx`.

### Architecture Patterns
- **Style**: functional React plus FastAPI service functions. SQLAlchemy 2.0 async with `lazy="raise"`. The groups BC uses plain FK ids with no `relationship()`.
- **State Management**: TanStack Query for server data, local `useState` for form drafts, and `AppDataContext` for app-wide item modes.
- Relevant standards: `validation.md` (inline Polish `role="alert"` errors, submit disabled while invalid), `accessibility.md` (combobox/listbox pattern from `LocationAddForm.tsx` if the picker is searchable), `data-fetching.md` (prefix query keys, invalidate on mutation), `migrations.md`, `models.md`.

---

## Complexity Assessment

| Factor | Value | Level |
|--------|-------|-------|
| File Size | form/page/hook 77–141 lines; term_item_listings 974; AppDataContext 1166 | Medium |
| Dependencies | ~6 APIs + moderation services | Medium |
| Consumers | ~25 across frontend/backend for categories | High |
| Test Coverage | ~20 relevant test files, good existing coverage | Low risk (Good) |

### Overall: Complex
Swapping the label and adding buttons is simple. The complexity comes from (1) the hierarchical category schema plus a large seed migration and the uniqueness change, (2) a tree picker that fits the shared category consumers and the flat admin UI, and (3) setting the mode at creation, which interacts with photo moderation and the UI-only gift limit.

---

## Key Findings

### Strengths
- Categories are already a backend table with UUIDs, admin CRUD, and an FK from products. Extending it is a natural fit.
- Clear separation: the form is presentational, the page owns state, and the hook owns orchestration.
- The draft semantics already exist (no pref row).
- The labels (`EXCHANGE_MODE_LABELS`) and the gift limit logic can be reused.

### Concerns
- Moderation returns 409 for the mode and auto-withdraws it while photos are pending, so mode at creation is not a trivial follow-up call.
- `uq_categories_name` is global, and Vinted names repeat.
- The existing seed test pins exactly 5 rows.
- The admin category UI assumes a flat `sort_order`.
- The gift limit is enforced only on the client.
- Uncommitted work exists in AddView/router/appHelpers.

### Opportunities
- A searchable picker or breadcrumb drill-down (`Kobiety › Odzież › Sukienki`) improves the UX of a large tree.
- The tree could later be shared by the needed-item and term forms.
- Enforcing the gift limit on the backend would close the UI-only gap. This is optional and outside the minimal scope.

---

## Impact Assessment

- **Primary changes**: `ItemQuickAddForm.tsx`, `ItemCreatePage.tsx`, `useCreateItem.ts`, `itemQuickAdd.ts`, `useCategories.ts`/`api/categories.ts`, `app/category/{models,service,schemas,router}.py`, new Alembic `0064` (schema) + `0065` (Vinted seed data).
- **Related changes**: `NameCategoryEditor`/`ItemDetailPage` (show the category path), admin `CategoryListPage`/`CategoryFormPage` (parent selection), `NeededItemQuickAddForm`/`EditTermDialog` if the picker is shared, possibly `term_item_listings.py` (pending intent) and `product/query_service.py` (descendant filter).
- **Test updates**: rewrite `ItemCreatePage.test.tsx` and `ItemQuickAddForm*.test.tsx`; update `test_category_reintroduction.py` and `test_category_module.py`; add migration up/down tests and tests for mode at creation and drafts.

### Risk Level: Medium-High
Many consumers depend on the category shape. A data migration seeds hundreds of rows and has to handle the existing 5 categories and their products. Mode at creation touches the moderation gate and withdraw path. Test coverage is good, which helps catch regressions.

---

## Recommendations

**Modifying existing code + new capability (hierarchical categories):**

1. **Schema**: add `parent_id UUID NULL` FK → `categories.id` (named `fk_categories_parent_id_categories`, indexed). Replace `uq_categories_name` with uniqueness on `(parent_id, name)`, using a partial or COALESCE-based index for roots. Consider an optional `vinted_id`/`slug` for idempotent seeding. Keep this in a schema-only revision.
2. **Seed**: write a separate data revision that inserts the Vinted tree with deterministic `sort_order`. Decide how the 5 legacy categories are handled: map them to Vinted nodes and re-point `products.category_id`, or keep them. Write the downgrade in reverse order.
3. **API**: add `parent_id` to `CategoryResponse`. Return the flat list and build the tree on the client. This is the simplest option, and one list query can handle a few hundred rows. Validate that the chosen `category_id` exists (and is a leaf, if that is the rule) in `resolve`.
4. **Picker**: build a new shared component, either a drill-down or a searchable combobox following the `LocationAddForm` a11y pattern, labelled "Kategoria". There is no default preselection, and the field is required with an inline Polish error.
5. **Buttons**: replace "Dodaj rzecz" with Oddam / Zamienię / Wersja robocza. Draft creates the item without a pref. Oddam/Zamienię create it and then set the pref. The Oddam button respects `MAX_GIFT_ITEMS` (reuse the logic from `AppDataContext`). Remove the "ustawisz na liście Moje rzeczy" hint.
6. **Moderation**: decide between a backend pending-intent (store the mode and apply it when photos are approved) and a UI fallback (set the mode when no photos are pending; otherwise show "udostępnimy po moderacji zdjęć" and leave the item as a draft). The UI fallback is the minimal option per `minimal-implementation.md`.
7. **Testing**: 2–8 tests per group: migration up/down, category tree response, resolve with a child category, create page with the three buttons (draft sends no pref call, gift over the limit is blocked, mode with pending photos), and the picker's keyboard behaviour.

---

## Next Steps
Run the gap-analyzer next, and resolve the open questions with the user first: the Vinted data source and depth, legacy category mapping, leaf-only selection, scope of the picker (add form only or all category selects), and how photo moderation applies to Oddam/Zamienię at creation.
