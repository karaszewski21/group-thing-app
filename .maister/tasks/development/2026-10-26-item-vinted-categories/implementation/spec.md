# Specification: Vinted category tree + Oddam / Zamienię / Wersja robocza

## TL;DR
- `categories` becomes a tree (`parent_id`, `external_id`), seeded once from a reviewed Polish Vinted JSON snapshot. The legacy flat catalog is wiped, products can only use leaf categories, and admins manage the tree without reparenting.
- One shared `CategoryTreePicker` (ModalSheet, search with full paths + drill-down) replaces every "Typ" `<select>`. The add-item form ends with three buttons: Oddam / Zamienię / Wersja robocza.
- Items get `inventory_items.listing_status` (DRAFT/ACTIVE), kept in lockstep with the `item_listing_preferences` row. The mode is set atomically at registration, and the backend enforces the 10-gift limit.
- The photo-moderation listing gate and withdraw-on-upload/re-point are removed. Needed items become plain names (no product link), and existing needed items and pledges are wiped.
- The spec audit (1 high, 6 medium, 13 low) is resolved. The picker sheet is portaled out of forms and labels, every picker button is `type="button"`, register-time listing requires a PERSONAL inventory, and the wipe, downgrades, dead-code list and test list are completed (see Audit resolution).

## Key Decisions
- Name the item status `listing_status` (enum `ItemListingStatus`), not `status` — `InventoryBalance.status` (AVAILABLE/RESERVED…) and `ItemDetailsResponse.status` (`ItemStatusResponse`) already exist in the same module and payload, so a bare `status` would be ambiguous in queries and on the wire.
- The enum holds only `DRAFT`/`ACTIVE`. The column is `VARCHAR(20)` so MODERATION/REJECTED can be added later without a type change — no speculative enum members (minimal-implementation).
- `listing_status` mirrors the pref row (ACTIVE ⇔ a pref row exists). Every listing read stays pref-driven, unchanged, which gives the smallest regression surface in `term_item_listings.py`.
- Set the mode at registration: `POST /api/inventory-items` accepts an optional `listing_mode`, and the item, pref and status are written in one commit before the photo uploads. This supersedes the "mode after photo uploads" ordering, which only existed because uploads used to withdraw listings. Atomic creation means a gift-limit 409 leaves nothing behind, so the form keeps its data and a retry cannot create a duplicate draft.
- Implicit Enter submission on the add form does nothing. All three buttons are `type="button"`, so the visibility outcome (gift / swap / draft) is always an explicit choice.
- Path labels and search run client-side over the cached `useCategories` list (about 1000 rows, one request). There is no new endpoint and no path field in any response, so no exact key-set churn.
- Leaf-only assignment is enforced in `app/product/service.py` (create, update, resolve) through one `require_leaf_category` helper in `app/category/service.py`. A non-leaf gets 409 with a Polish message; an unknown id gets 404.
- Root uniqueness uses `uq_categories_parent_id_name` plus the partial unique index `uq_categories_root_name … WHERE parent_id IS NULL`, as decided. `Category.__eq__`/`__hash__` move to the business key `(parent_id, name)`.
- The legacy wipe deletes every category row that exists before the seed (the 5 legacy rows plus any admin-added flat rows) together with all their products and dependents. A leftover flat root would sit among the Vinted roots and break the taxonomy. In dev this empties the item catalog.
- Needed-item DTOs replace `product_id/product_name/product_category_*` with `name`, and `MyPledgeResponse.product_name` becomes `item_name`. The value is no longer a product name, and the exact key-set tests must be rewritten anyway. The outbox payload key `product_name` stays, because it is an internal contract and events may already be queued.
- Needed-item names go through the same text checks as product names did on resolve (`ensure_no_contact_info` + `check_text(TextField.PRODUCT_NAME)`), because they render on the anonymous public term page.
- Migrations: schema and data stay in separate revisions (`0064`–`0069`, see Technical Approach), each with a downgrade→upgrade pytest.
- The admin tree is built from nested lists with disclosure buttons (`aria-expanded`) instead of `role="tree"`. A real ARIA tree needs a roving-tabindex keyboard model that is not required here. The mockup layout is kept.
- Audit decisions:
  - **Portal in the picker only (H1).** `CategoryTreePicker` renders its `ModalSheet` through `createPortal(…, document.body)`. `ModalSheet` itself stays in-place, so term dialogs and their tests are untouched; it only gains `type="button"` on its ✕, a harmless global fix.
  - **PERSONAL inventory (M3).** Register with a non-null `listing_mode` into a non-PERSONAL inventory → 403 `AccessDeniedException`, the same rule and status as `PUT /api/item-listing-preferences`.
  - **`external_id` provenance (M4).** Set only when read from a vinted.pl catalog URL or page, otherwise `null`. A guessed id is a defect. A fixture with all ids null is acceptable.
  - **Needed-item failures in `handleAddTerm` (M5).** Continue creating the remaining items, collect the failures, close the modal, and show one toast. Rejected drafts are not kept.
  - **Picker search (L7).** Case- and diacritic-insensitive, showing at most 50 results with a narrowing hint.
  - **`update_product` leaf check (L8).** Runs only when `category_id` changes.
  - **Category display (L9).** `ItemDetailPage` keeps showing the leaf `category_name`, unchanged. The `ProductListPage` filter lists leaves only.
  - **Categories cache (L11).** The categories query gets `staleTime: 5 min`; mutations already invalidate it.
  - **`any` mode search (L13).** In `any` mode, a non-leaf search result selects that node.
  - **Downgrades (L2, L12).** The 0068 downgrade wipes needed items first. The 0069 downgrade deletes all categories, and fails if products exist.

## Open Questions / Risks
- **Uncommitted user work.** `src/frontend/src/test/AppPage.test.tsx` mocks camelCase `Category` rows and asserts the needed-item `resolveProduct` flow, so it will fail to type-check or pass after this change. It must be updated, but only after the user commits their work. `src/frontend/src/utils/appHelpers.ts` keeps `MAX_GIFT_ITEMS`, the stale "Enforced only in the UI" comment and a `GIFT_LIMIT_MESSAGE` that differs from the new backend text; aligning it waits for the user's commit too. `router.tsx`, `AddView.tsx`, `AppPage.tsx` and `EventCreateView.tsx` need no change (the admin "add child" link uses a `?parent=` query on the existing `categories/new` route).
- **Fixture provenance.** The Vinted tree (about 800–1000 nodes, up to 5 levels) is compiled once by hand from vinted.pl navigation. That is a one-time snapshot, there may be ToS concerns, and some catalog ids may be missing (`external_id` nullable; ids are never invented, see FR-2). **The user must review the fixture and its provenance note `alembic/data/vinted_categories_pl.json` before the seed revision is applied anywhere.**
- **Destructive data revision.** The legacy wipe deletes all products, items, ledger rows, reservations, swaps, conversations, photo rows and the related notifications and PENDING term-end outbox events (dev data). Spaces objects of deleted photos are orphaned, because a migration cannot reach storage. Do not run it against data that matters.
- **Gift-limit race.** Two concurrent "Oddam" requests by one owner can both pass the count check, leaving 11 gifts. This is accepted as a soft limit; the UI checks too.
- **Leaf race.** An admin adding a child at the same moment a product is created on that leaf can leave a product on an inner node. This is accepted (admin-only, rare).
- **Needed items after term creation.** Needed-item names are now moderated by `POST /api/needed-items`, which runs after `createTerm` in `AppDataContext.handleAddTerm`. A rejected name therefore leaves the created term behind, and the organizer must re-add it in `EditTermDialog`. See FR-24 for the handling.
- **Listed before photo approval.** With the gate gone, an Oddam/Zamienię item appears in terms before its photos are approved. Only APPROVED photos are ever rendered to others, so the item shows without a photo until approval.
- **Test-suite churn.** 19 backend test files take `GET /api/categories[0]`, which will now be a non-leaf root. All of them must switch to a leaf helper. Five moderation test files are deleted or rewritten.

## Goal
Owners classify each item with a leaf from the Polish Vinted category tree and, in the same step, decide whether it is offered (Oddam/Zamienię) or kept as a draft. Category data and listing semantics stay consistent across the backend, the admin tooling and the term's needed list.

## User Stories
- As an owner adding an item, I want to pick "Kategoria" from a searchable Vinted tree so that my item is classified the way I know from Vinted.
- As an owner, I want to finish the add form with Oddam, Zamienię or Wersja robocza so that I decide its visibility immediately, without a second trip to "Moje rzeczy".
- As an owner editing an item, I want to change its category with the same picker and see whether it is a draft.
- As an owner whose photos are in moderation, I want to still offer my item so that moderation no longer blocks me.
- As an organizer, I want to list needed items by plain name, without forcing a category.
- As an admin, I want to manage the category tree (add root or child, rename, reorder siblings, delete) and see clear errors when an operation is not allowed.

## Core Requirements

### A. Category tree (backend)
1. **FR-1 Schema.** `categories` gains:
   - `parent_id UUID NULL`, a self-FK `fk_categories_parent_id_categories` (RESTRICT), with index `ix_categories_parent_id`.
   - `external_id INTEGER NULL`, unique (`uq_categories_external_id`).
   - Uniqueness: drop `uq_categories_name`; add `uq_categories_parent_id_name (parent_id, name)` and the partial unique index `uq_categories_root_name (name) WHERE parent_id IS NULL`.
   - `sort_order` is now ordered among siblings.
2. **FR-2 Fixture.** `src/backend/alembic/data/vinted_categories_pl.json` is a JSON array of root nodes. Each node is `{"name": string (1–100 chars, trimmed), "external_id": integer | null, "children": [node, …]}`, and a leaf has `children: []` or omits the key. Array order defines `sort_order` (0-based per sibling list). Sibling names are unique, and non-null `external_id`s are globally unique. The roots, in order, are: Kobiety, Mężczyźni, Dzieci, Dom, Elektronika, Rozrywka, Hobby i kolekcje, Sport, Zwierzęta. The seed revision validates the fixture (shape, lengths, sibling and `external_id` uniqueness) and fails loudly on any violation.
   - **Provenance.** `external_id` is set only when it was read from a vinted.pl catalog URL or page; otherwise it is `null`. An invented or guessed id is a defect, and a fixture with all ids `null` is acceptable.
   - The implementer adds `src/backend/alembic/data/vinted_categories_pl.README.md` next to the fixture, listing the source URLs or pages, the snapshot date and how ids were obtained.
   - **The user must review and approve the fixture and this provenance note before the seed is applied.**
3. **FR-3 Legacy wipe and seed (data revision).** In one revision:
   - Collect every category id that exists before seeding, all products in those categories, and all inventory items of those products.
   - Delete their dependents in FK-safe order (see Technical Approach), then the products, then the categories.
   - Insert the fixture tree with app-generated UUIDs and parent ids in a single batched insert.
   - Downgrade first fails loudly if any `products` row exists ("remove products before downgrading 0069"). It then deletes **all** `categories` rows leaves-first (repeat `DELETE FROM categories c WHERE NOT EXISTS (SELECT 1 FROM categories ch WHERE ch.parent_id = c.id)` until no row is deleted; nulling `parent_id` first is not possible because the many "Inne" leaves would collide on `uq_categories_root_name` — implementation note from Group 3), which also covers admin-added children of seeded nodes and rows with a null `external_id`. Finally it re-inserts the 5 legacy rows (Zabawka, Książka, Gra, Ubranie, Inne; sort 0–4). Products are not restored.
4. **FR-4 API shape.** `CategoryResponse` gains `parent_id: UUID | null`; `external_id` is not exposed. `GET /api/categories` returns the flat list ordered by `sort_order, name` with the existing `product_count` aggregate (still a single query).
5. **FR-5 Create.** `CreateCategoryRequest` gains `parent_id: UUID | null` (null means root). The service checks, in order:
   - An unknown parent → 404.
   - A parent with products → 409 "Kategoria ma przypisane rzeczy".
   - A duplicate sibling name → 409 "Kategoria o tej nazwie już istnieje na tym poziomie" (explicit check, not the generic integrity 409).
   - On success, `sort_order` = the maximum sibling `sort_order` + 1.
6. **FR-6 Update.** Only rename and description change. `UpdateCategoryRequest` has no `parent_id` (no reparenting). A duplicate sibling name → the same 409 as FR-5.
7. **FR-7 Delete.** Explicit `EXISTS` pre-checks run before `db.delete`, in this order:
   - A category with children → 409 "Nie można usunąć „{name}”: kategoria ma podkategorie.".
   - A category with products → 409 "Nie można usunąć „{name}”: kategoria ma przypisane rzeczy." (replaces the English `CategoryHasProductsException` text).
   - The `IntegrityError` mapping is no longer the primary mechanism, because the new self-FK would otherwise surface as the "products" message.
8. **FR-8 Move.** `move_category` swaps `sort_order` only with the adjacent sibling (same `parent_id`, `IS NULL` for roots). At a sibling boundary it is a no-op.
9. **FR-9 Leaf-only products.** `create_product`, `update_product` and `get_or_create_product_by_name` call `require_leaf_category`, which returns 404 for an unknown category and 409 "Wybierz najbardziej szczegółową kategorię (bez podkategorii)." for a category that has children. The check runs before the name lookup in resolve. In `update_product` it runs only when `category_id` differs from the stored value, so a product left on an inner node by the accepted leaf race can still be renamed.

### B. Item listing status and modes (backend)
10. **FR-10 Status column.** `inventory_items.listing_status VARCHAR(20) NOT NULL`, server default `'DRAFT'`, mapped as `ItemListingStatus(StrEnum){DRAFT, ACTIVE}` through `_enum_column` in `app/circulation/models.py`. A data revision sets `ACTIVE` for every item that has an `item_listing_preferences` row.
11. **FR-11 Exposure.** `listing_status` is added to `InventoryItemResponse`, `ItemDetailsResponse` (circulation) and `MyInventoryItemResponse` (groups). Frontend types follow:
    - `listing_status: "DRAFT" | "ACTIVE"` on `api/items.ts` `ItemDetailsResponse` and on `api/inventories.ts` `InventoryItemResponse` and `MyInventoryItemResponse`;
    - `listing_mode?: ListingMode | null` on `api/inventories.ts` `CreateInventoryItemRequest`.
12. **FR-12 Register with mode.** `CreateInventoryItemRequest` gains `listing_mode: GIFT | SWAP | null` (default null; other `ReservationType` values → 400 through a validator, like `_OFFERABLE_RESERVATION_TYPES`).
    - Null → the item is created with `DRAFT` and no pref.
    - Non-null → the item is created with `ACTIVE`, and a pref row is inserted in the same commit by a groups hook injected from `app/circulation/router.py` (the existing `on_product_changed` injection pattern).
    - With a non-null mode, the hook first requires the target inventory to be `PERSONAL`; otherwise it raises `AccessDeniedException` → 403, the same rule and status as `set_item_listing_preference`.
    - A gift-limit violation raises before commit, and nothing is persisted.
    - `register_item` is refactored accordingly. Today it commits internally; it gains an optional flush-only `on_registered` hook and commits once, after the hook.
13. **FR-13 Lockstep transitions.**
    - `set_item_listing_preference`: setting a mode → `ACTIVE`; clearing it → `DRAFT`. The item row is read `FOR UPDATE` through a new `get_item_for_update` (repository → circulation service → `circulation_bridge`), replacing `get_item_for_share`.
    - `confirm_transaction`: every item whose pref it deletes (both SWAP legs) → `DRAFT`, so the item arrives at its new owner as a draft.
    - Groups writes the status only through a flush-only `circulation_bridge.set_item_listing_status`; `register_item` sets the initial value itself, inside circulation.
    - The invariant "ACTIVE ⇔ a pref row exists" holds after every write.
14. **FR-14 Gift limit.** `MAX_GIFT_ITEMS = 10` lives in `term_item_listings.py`. Both paths count the owner party's GIFT prefs, excluding the item itself.
    - Registering with GIFT at or over the limit → 409 "Możesz mieć maksymalnie 10 rzeczy do oddania. Wybierz „Zamienię” albo zapisz wersję roboczą."
    - Setting GIFT through `PUT /api/item-listing-preferences/{id}` at or over the limit → 409 "Możesz mieć maksymalnie 10 rzeczy do oddania. Zdejmij „Oddam” z innej rzeczy."
15. **FR-15 Gate removal.**
    - `set_item_listing_preference` no longer returns 409 for PENDING/NEEDS_REVIEW photos (`PHOTOS_IN_MODERATION_MESSAGE` is deleted).
    - `add_product_photo` no longer takes or calls `on_pending_photo`.
    - `update_item` no longer takes or calls `on_product_changed`.
    - Deleted as dead code (re-grep for callers before deleting each):
      - `withdraw_product_listings`, `withdraw_item_listing_if_photos_pending`, `_withdraw_items`, the `_WITHDRAWN_*` messages and `_listing_product_name` (its only caller is `_withdraw_items`);
      - `scripts/withdraw_unmoderated_listings.py`;
      - the `product_bridge`/`product_service` gate reads `has_unmoderated_photos` and `list_product_ids_with_unmoderated_photos`;
      - `circulation_bridge.list_item_ids_for_product` and `circulation_service.list_item_ids_for_product`;
      - `repository.list_pending_swap_proposals_involving_items`;
      - the groups-bridge `find_item_including_deleted` (the circulation service function stays, because `app/messaging/application/conversations.py` uses it);
      - the whole `get_item_for_share` chain (`circulation_bridge`, `inventory_items.get_item_for_share`, `repository.get_item_for_share`) once FR-13 replaces it.
    - The `UNMODERATED_STATUSES` comment in `app/product/service.py` ("cannot be listed in a term…") is corrected.
    - `product_ids_with_unmoderated_photos` and `photos_moderation_pending` stay (informational flag). The VPS B cron, admin moderation and hiding of rejected photos are unchanged.

### C. Needed items (backend)
16. **FR-16 Schema and data.** A data revision deletes all `pledges`, then all `needed_items`. The following schema revision adds `needed_items.name VARCHAR(255) NOT NULL` and drops `fk_needed_items_product_id_products` and `product_id`. The 0068 downgrade first runs `DELETE FROM pledges; DELETE FROM needed_items` (needed items created after the upgrade cannot be mapped back to a product; dev data, consistent with the wipe). It then re-adds `product_id UUID NOT NULL` with its FK and drops `name`.
17. **FR-17 Contract.**
    - `CreateNeededItemRequest {term_id, name (trimmed, 1–255), description?}` and `UpdateNeededItemRequest {name?, description?}`. The name passes `ensure_no_contact_info` + `check_text(TextField.PRODUCT_NAME)` on create and on a name change.
    - `NeededItemResponse` is `{id, term_id, name, description, claimed, created_at, updated_at}`.
    - `PublicNeededItemResponse` is `{id, name, description, claimed, claimed_by_name, claimed_by_party_id}`.
    - `OrganizerNeededItemResponse.product_name` becomes `name`, and `MyPledgeResponse.product_name` becomes `item_name`.
18. **FR-18 Readers switched to `needed_items.name`, with the Product/Category joins removed:**
    - `app/groups/application/terms.py`: `_needed_item_view`, create, update, and the `soft_delete_needed_item` notification text.
    - `app/groups/application/pledges.py`: the outbox payload keeps the key `product_name` but takes its value from `needed_item.name`.
    - `app/groups/application/public_view.py`.
    - `app/groups/application/organizer_page.py`.
    - `app/groups/infrastructure/repository.py`: `get_needed_item_with_product`, `list_needed_items_with_product_for_term`, the pledge list join (~L545) and `list_needed_items_with_product_for_terms`, renamed to drop "with_product"; ordering moves to `NeededItem.name`.
    - The `product_bridge` docstring.

### D. Frontend
19. **FR-19 Category data.**
    - `api/categories.ts`: `Category` becomes snake_case `{id, name, description, parent_id, sort_order, product_count, created_at, updated_at}`, fixing the stale camelCase, and `CreateCategoryRequest` gains `parent_id?: string | null`.
    - New pure `utils/categoryTree.ts`: build an index (by id, children by parent sorted by `sort_order`), `isLeaf`, `categoryPathNames`/`formatCategoryPath` (separator " › "), and `searchCategories(query)`.
    - `searchCategories` does a substring match on the name, ignoring case and diacritics: `toLocaleLowerCase("pl")`, NFD with combining marks removed, and `ł`→`l`. So "ksiazki" finds "Książki".
    - It returns each node with its ancestor path, plus the total match count.
    - `useCategories` sets `staleTime: 5 * 60_000` on the categories query, so each picker mount (for example, reopening `NameCategoryEditor`) does not refetch about 1000 rows. Mutations already invalidate the `categories` prefix.
20. **FR-20 CategoryTreePicker** (`components/shared/CategoryTreePicker.tsx`) is a field trigger plus a sheet.
    - **DOM placement (H1).** The sheet is rendered through `createPortal(<ModalSheet …/>, document.body)` inside `CategoryTreePicker`, so it is never a DOM descendant of the host `<form>` or of any `<label>`. React events still bubble through the React tree, so `onClick`/`onKeyDown` handlers in the sheet call `stopPropagation()` where a host handler must not see them; for example, `NameCategoryEditor`'s Enter/Escape `onKeyDown` must not be attached to the trigger.
    - **Button types (H1).** Every `<button>` in the picker (trigger, breadcrumb items, "‹ Wstecz", rows, "Wybierz „…”", "Kategoria główna") is `type="button"`. `ModalSheet.tsx`'s ✕ also gets `type="button"`, a one-attribute change that is harmless for the other callers.
    - **Enter in search (H1).** Enter in the search input always calls `preventDefault()`. With an active option it selects or drills that option; otherwise it does nothing.
    - **Trigger.** A `type="button"` labelled with `aria-labelledby` pointing at the host's visible label `<span id>` (never wrapped in a `<label>`, which would re-click the trigger after a scrim close and is invalid with interactive content). It shows the placeholder "Wybierz kategorię", or the selected node as a small ancestor path ("Kobiety › Ubrania › Sukienki ›") plus the bold leaf name. It accepts `aria-invalid`/`aria-describedby` and `disabled`. The trigger subscribes to `useCategories` once; the sheet receives the index as props, so opening it never refetches.
    - **Sheet.** A shared `ModalSheet` titled "Wybierz kategorię", so trapFocus, Esc-close, `useRegisterOpenSheet` and focus return to the trigger come for free.
    - **Search input (combobox).** With a non-empty query, the sheet shows a results listbox where each row is the full path plus the name, with a polite live count "N wyników". At most the first 50 results render, and when more match the sheet shows "Pokazano 50 z N — zawęź wyszukiwanie". ArrowUp/Down plus Enter work, with `aria-activedescendant`, and `aria-controls` is set only while results are shown. Esc with results open clears the search (`preventDefault` + `stopPropagation`) and does not close the sheet.
    - **Drill-down.** A breadcrumb "Wszystkie › …" where each ancestor is clickable, a "‹ Wstecz" control one level up, and rows as buttons; non-leaf rows show "›" and only descend.
    - **Modes.** `leaf` (default): only leaves select, and selecting closes the sheet; a non-leaf search result drills into that node. `any` (admin parent): any node selects, and a non-leaf search result selects that node instead of drilling. In browse, rows with children still drill, a "Wybierz „{current}”" button selects the current level, and an optional "Kategoria główna (brak)" choice clears to root.
    - **Reopen.** The sheet opens at the selected node's parent level.
21. **FR-21 Add item.** In `ItemQuickAddForm` the "Typ" select becomes a required "Kategoria *" picker (leaf mode, no default), and `itemQuickAdd.ts` defaults `category_id` to "". The Kategoria field does not use the `<label>`-wrapping `Field`: it renders a `<div>` with a label `<span id>`, and the trigger references that id through `aria-labelledby`. In `ItemCreatePage`:
    - The `<form>` keeps `onSubmit={(e) => e.preventDefault()}`, so implicit Enter submission from the name input does nothing even though no submit button exists.
    - The `categories[0]` default and the "…ustawisz na liście „Moje rzeczy”" sentence are removed. The "Opis dodasz na stronie rzeczy" part may stay in the photo hint.
    - The single submit is replaced by three `type="button"` buttons: **Oddam** (primary, mint) → `GIFT`, **Zamienię** (secondary, teal-soft) → `SWAP`, **Wersja robocza** (outline, full width) → null. Labels come from `EXCHANGE_MODE_LABELS`.
    - All three are disabled until the name is non-blank and a category is chosen, and while busy. Implicit Enter submission is a no-op.
    - `useCreateItem(value, photos, mode)` passes `listing_mode` to `registerInventoryItem`, then uploads photos as today.
    - A backend error (for example the gift limit) is shown verbatim in the existing `role="alert"` box, and the form keeps all its data.
22. **FR-22 Item edit.** `NameCategoryEditor` replaces `<select aria-label="Typ rzeczy">` with the picker labelled "Kategoria" (leaf mode); save stays resolve → re-point. `ItemEditPage`:
    - Shows a status chip next to the heading: `DRAFT` → "Wersja robocza", `ACTIVE` → "Aktywna".
    - Removes the "Rzecz zdjęta z terminów do czasu zatwierdzenia zdjęć…" notice.
    - In `pages/product/ItemGalleryEditor.tsx` (~L175–178), drop the false sentence "…Nowe zdjęcie zdejmuje te rzeczy z terminów do czasu jego zatwierdzenia." and keep "Inni zobaczą je po sprawdzeniu". The assertion in `src/test/ItemDetailPage.test.tsx` (~L690) is updated to match.
    - `ItemDetailPage` keeps showing the leaf `category_name`, unchanged (no path).
23. **FR-23 Moje rzeczy.** `MyItemsView` no longer disables the mode toggles for `photos_moderation_pending`. It drops the "Tryb włączysz po zatwierdzeniu zdjęć" hint and its `aria-describedby`, and keeps the "Zdjęcia w moderacji" pill. A backend 409 on a mode change surfaces as today (toast with the server message). The `AppDataContext` comment about the 409 is updated; the polling may stay, because it still refreshes the pill and thumbnail.
24. **FR-24 Needed items UI.**
    - `NeededItemQuickAddForm` and `EditTermDialog` drop the category field, `resolveProduct` and `makeEmptyDraft(categories)`. Create and update send `name` (and `description`), and the edit-change detection compares `name`.
    - `utils/neededItemQuickAdd.ts` drops `category_id` and the `categoryId` parameter of `createEmptyNeededItemQuickAddValue`. `AppDataContext.addDraftNeededItem` (~L536) and the `draftNeededItem` initialisation call it without arguments.
    - `AppDataContext.handleAddTerm` drops the resolve loop. When `createTerm` succeeds:
      - It creates every needed item, continuing past failures, and collects the rejected names together with the first server message.
      - It then resets the term form, closes the modal and refreshes the terms. `addTermError` is used only for a `createTerm` failure.
      - With one or more failures, it shows a single toast: "Termin dodany, ale nie dodano rzeczy: {name1}, {name2} — {first server message}". The organizer re-adds them in `EditTermDialog`; rejected drafts are not kept.
    - Display sites switch `product_name` to `name`: `AppDataContext` (L803, L1030), `EditTermDialog`, `PublicTermView`, `NeededItemsBlock`. `MeetingsView` switches to `item_name`.
    - `api/terms.ts`, `api/groups.ts` (`PublicNeededItemResponse`, `OrganizerNeededItem`) and `api/pledges.ts` (`MyPledgeResponse`) are updated.
    - The `categories` export of `AppDataContext` is removed if no consumer remains.
25. **FR-25 Admin.**
    - **`CategoryListPage`** becomes an expandable tree of nested lists with disclosure buttons, built from `categoryTree.ts`. Each row shows the name, a meta line ("N podkategorii" through `Intl.PluralRules("pl")`, or "N rzeczy" for a leaf with products) and the actions ↑ ↓ "+ Podkategoria" Edytuj Usuń. ↑/↓ move within siblings.
    - "+ Podkategoria" links to `/admin/categories/new?parent={id}`. "+ Podkategoria" and "Usuń" are disabled, with the title "Kategoria ma przypisane rzeczy", on nodes with products.
    - A backend 409 renders in a top `role="alert"`. "Filtruj po nazwie…" expands the branches that contain matches. "+ Nowa kategoria główna" goes to `/admin/categories/new`.
    - **`CategoryFormPage`**: in create mode it reads `?parent=` and uses the picker in `any` mode ("Kategoria nadrzędna", hint "Puste = kategoria główna. Nie można zmienić po utworzeniu."). In edit mode it shows the parent path read-only. A 409 is shown inline.
    - In both admin forms (`Box as="form"`), the category field's label becomes a `<span id>` referenced by the trigger's `aria-labelledby`, not `<label htmlFor>`. The picker sheet is portaled (FR-20), so closing it or pressing Enter in its search never submits the admin form.
    - **`ProductFormPage`** uses the picker (leaf mode) instead of the select.
    - **`ProductListPage`**'s filter `<select>` lists **leaves only** (products only sit on leaves, and there is no descendant filter), labelled and sorted by full path. Its category column and **`ProductDetailPage`**'s category show full path labels.

## Visual Design
Mockups in `analysis/design-context/` are binding inputs — implementation-planner will attach `Visual References` to UI task groups. Fidelity: high-fidelity HTML in the app's Tailwind v4 `@theme` tokens (user screens) and Chakra-like admin styling (`analysis/design-context/design-resources.md`).

| ID | Mockup | Key elements | Requirements |
|----|--------|-------------|--------------|
| screen:dodaj-rzecz | `analysis/design-context/mockups/dodaj-rzecz.html` | Nazwa, Stan, empty required "Kategoria *" trigger "Wybierz kategorię ›", Zdjęcia, three disabled buttons in a 2-col grid (draft full width) | FR-20, FR-21 |
| screen:dodaj-rzecz-wybrana-kategoria | `…/mockups/dodaj-rzecz-wybrana-kategoria.html` | Trigger shows path "Kobiety › Ubrania › Sukienki ›" + bold leaf "Sukienki midi"; buttons enabled | FR-19, FR-20, FR-21 |
| screen:dodaj-rzecz-limit-oddam | `…/mockups/dodaj-rzecz-limit-oddam.html` | Danger-soft `role="alert"` with the backend gift-limit text, data kept | FR-14, FR-21 |
| screen:wybor-kategorii-przegladanie | `…/mockups/wyb-r-kategorii-przegl-danie.html` | ModalSheet "Wybierz kategorię", search box, "‹ Wstecz", breadcrumb, rows with "›" for non-leaves | FR-20 |
| screen:wybor-kategorii-szukaj | `…/mockups/wyb-r-kategorii-szukaj.html` | Combobox results with path + highlighted name, "6 wyników", non-leaf result with "›" drills in | FR-19, FR-20 |
| screen:edycja-rzeczy-kategoria | `…/mockups/edycja-rzeczy-kategoria.html` | Item name + "Wersja robocza" chip, "Kategoria" picker trigger, Zapisz/Anuluj | FR-11, FR-22 |
| screen:admin-drzewo-kategorii | `…/mockups/admin-drzewo-kategorii.html` | "Kategorie" + "+ Nowa kategoria główna", 409 alert, filter, indented expandable rows, meta counts, sibling ↑/↓, disabled actions on a leaf with products | FR-7, FR-8, FR-25 |
| screen:admin-formularz-kategorii | `…/mockups/admin-formularz-kategorii.html` | "Nowa podkategoria", parent picker (any node) with hint, Nazwa, Opis, Zapisz/Anuluj | FR-5, FR-20, FR-25 |
| screen:rzeczy-potrzebne-na-termin | `…/mockups/rzeczy-potrzebne-na-termin.html` | "Potrzebne rzeczy" list of plain names with Usuń, add row "np. Termos" + Dodaj, no category | FR-24 |
| component:category-tree-picker | `…/mockups/wyb-r-kategorii-szukaj.html` | Shared picker: search + drill-down, leaf-only by default, any-node for admin parent | FR-20 |
| component:item-submit-actions | `…/mockups/dodaj-rzecz.html` | Oddam (primary), Zamienię (secondary), Wersja robocza (outline) | FR-21 |

## Reusable Components

### Existing Code to Leverage
- `src/frontend/src/components/shared/ModalSheet.tsx`, `trapFocus.ts` and `openSheets.ts`: sheet chrome, focus trap, Esc, open-sheet registration and focus return for the picker.
- `src/frontend/src/components/shared/LocationAddForm.tsx`: the combobox a11y pattern (ArrowUp/Down, Enter, `aria-activedescendant`, Esc closing only the listbox inside a sheet) for the picker search.
- `src/frontend/src/pages/term/components/termLabels.ts` (`EXCHANGE_MODE_LABELS`): the Oddam/Zamienię button labels.
- `src/frontend/src/hooks/useCategories.ts` / `api/categories.ts`: the single cached category query feeding the picker, the admin tree and path labels. `remove`/`move` are reused by the tree page.
- `src/frontend/src/hooks/useCreateItem.ts`, `pages/product/ItemCreatePage.tsx` and `ItemQuickAddForm.tsx`: the existing create chain, error box and photo field; they gain a mode argument and the picker.
- `src/frontend/src/api/problem.ts` (`serverMessageOr`/`extractProblemMessage`): passes backend 409 messages through verbatim.
- `src/backend/app/category/service.py`: `list_categories` aggregate, `move_category` swap, `_get_category_entity`, `_count_products`. Extended rather than rewritten.
- `src/backend/app/groups/application/term_item_listings.py` (`set_item_listing_preference`, `confirm_transaction`) and `app/groups/infrastructure/circulation_bridge.py`: the existing write sites, which gain the status writes.
- `src/backend/app/circulation/router.py`'s hook-injection pattern (today's `on_product_changed`): reused for the register-time listing hook, so circulation still never imports groups at service level.
- `src/backend/app/circulation/models.py` (`_enum_column`): the string-backed `ItemListingStatus` column.
- `src/backend/app/moderation/rules.py` (`ensure_no_contact_info`) and `text_guard.py` (`check_text`): needed-item name moderation.
- `alembic/versions/0025_category_reintroduction.py`: the legacy seed rows and SQL insert pattern for the downgrade. Migration test templates: `tests/test_group_soft_delete_migration.py`, `tests/test_locations_migration.py`.

### New Components Required
- `CategoryTreePicker.tsx`: no tree or drill-down selection component exists. The only picker is a flat `<select>`, which cannot handle about 1000 nested nodes on mobile.
- `utils/categoryTree.ts`: pure path, leaf and search helpers shared by the picker, the admin tree and the product pages. There is no existing tree utility, and it keeps view logic table-testable.
- `alembic/data/vinted_categories_pl.json` plus 6 revisions (`0064`–`0069`): new data and schema with no existing source.
- `require_leaf_category` (`app/category/service.py`), `set_item_listing_status` (circulation service and bridge), `get_item_for_update` (repository → service → bridge; no FOR UPDATE item reader exists today) and a register-time listing hook (`term_item_listings.py`): small functions, each with an immediate caller, that put the new invariants in exactly one place.
- `alembic/data/vinted_categories_pl.README.md`: the fixture provenance note required by FR-2.

## Technical Approach

**Revision chain** (head is `0063`; renumber if the head has moved):

| Rev | Kind | Content |
|-----|------|---------|
| `0064_item_listing_status` | schema | add `inventory_items.listing_status` NOT NULL, server_default `'DRAFT'` |
| `0065_backfill_item_listing_status` | data | `UPDATE inventory_items SET listing_status='ACTIVE' WHERE id IN (SELECT item_id FROM item_listing_preferences)`; downgrade resets to `'DRAFT'` |
| `0066_category_tree` | schema | `parent_id` + FK + index, `external_id` + unique, swap `uq_categories_name` for the per-parent unique and the partial root unique; downgrade in reverse order |
| `0067_wipe_needed_items` | data | `DELETE FROM pledges; DELETE FROM needed_items`; downgrade is a no-op (data not restored) |
| `0068_needed_item_name` | schema | add `needed_items.name`, drop the FK and then `product_id`; downgrade reverses |
| `0069_vinted_categories` | data | legacy wipe + fixture seed (FR-3) |

**Legacy-wipe delete order (0069).** With the item set I and the product set P (all products of the pre-existing categories), delete in this order:
1. `messages` / `conversation_reads` of the `conversations` where item_id ∈ I, then those conversations.
2. `swap_proposals` where `listing_item_id` or `offered_item_id` ∈ I.
3. `giveaway_term_end_markers` whose `reservation_id` belongs to those items' reservations. Then, from `notifications`, delete the rows where:
   - `reservation_id` ∈ those reservations;
   - `proposal_id` ∈ the swap proposals deleted in step 2;
   - `link_path` = `/product/{id}` for id ∈ I.

   Then delete the `outbox_entries` with `status = 'PENDING'` and `event_type` ∈ {`groups.term_ended_giveaway`, `groups.term_ended_swap`}, so the listener cannot recreate prompts for wiped reservations.
4. `circulation_entries` where item_id ∈ I, then `circulation_transactions` left with no entries.
5. `reservations` (null `paired_reservation_id` first).
6. `inventory_balances`.
7. `item_listing_preferences` where item_id ∈ I (loose pointer, no FK).
8. `inventory_items`.
9. `moderation_decisions` where (`subject_type = 'PHOTO'` and `subject_id` ∈ the photos of P) or (`subject_type = 'PRODUCT_TEXT'` and `subject_id` ∈ P), then `product_photos` of P.
10. `products`.
11. The pre-existing categories.

The implementer must re-grep `ForeignKey("inventory_items.id"|"products.id"|"reservations.id")` and the loose `*_item_id`/`reservation_id` columns at implementation time and extend this list if anything new appears.

**0065 note.** 0065 is kept for chain correctness (user-confirmed), even though on real data 0069 later deletes every item it touches.

**Create-item flow.** The frontend chain is profile → personal inventory → `POST /api/products/resolve {name, category_id}` (leaf check) → `POST /api/inventory-items {inventory_id, product_id, condition, listing_mode}` → photo uploads → navigate to `/product/{id}`. The backend runs `register_item` (status set from the mode) → flush → hook (PERSONAL check → `get_profile_by_account_user_id` → gift-limit count → insert pref) → a single commit. On any exception the request session closes without committing.

**Listing invariant.** Pref existence stays the only input to listing reads (`repository` 688–770, `organizer_page`, `public_view`, `exchange_summary`, `term_end_scan`, notifications), and none of those change. `listing_status` is a mirror written in the same transaction as each pref insert or delete: register, set/clear, confirm_transaction, and the backfill. The `list_my_active_taken_term_item_listings` fallback for a missing pref stays; only its comment changes, because a pref can still be cleared by the owner.

**Cross-module boundaries.**
- Groups writes `inventory_items.listing_status` only through `circulation_bridge`.
- Product checks leaves through `app.category.service`. Product already depends on categories through its FK; `category` must not import `product` ORM, and keeps its ad-hoc `_products` table.
- No new `relationship()`. `Category` gets no ORM self-relationship either, since tree assembly is client-side.

**Authorization.** No new routes, so `AUTHORIZATION_MATRIX` is unchanged. `GET /api/categories` stays READ/`mcp:read`; mutations stay ADMIN.

**Docs.**
- Update `.maister/docs/project/architecture.md` § "Photo Upload and Content Moderation": remove the "Publish gate and withdraw" bullets and the one-time cleanup script, and note that the listing gate was removed and listings are independent of moderation.
- Add a short note on `listing_status` lockstep and the category tree.

## Implementation Guidance

### Testing Approach
- 2–8 focused tests per implementation step group; verification runs only the new and changed tests, not the entire suite.
- Backend: integration-first through `client`, real PostgreSQL. Add a `leaf_category_ids(client, headers, n=1)` helper to `tests/conftest.py`, returning the first `n` distinct categories with no children; `test_product_resolution.py` needs `n=2`. Switch every `categories.json()[0]` / name-based lookup to it.
  - The helper queries the API on every call and is never cached at session or module scope, because migration round trips that cross 0069 re-seed the tree with new UUIDs. Dates come from `clock.local_now()`. Exact key-set assertions are updated, never loosened.
- Frontend: Vitest + Testing Library. `createQueryWrapper()` for hook and picker tests, `vi.mock` API modules, and a table-driven `it.each` for `categoryTree.ts`.

**New backend tests (expected):**
- `tests/test_item_listing_status_migration.py`: 0064/0065 round trip. The backfill test seeds an item and a pref, upgrades only to `0065`, asserts ACTIVE, and upgrades to `head` in the `finally` block, because 0069 later deletes such items.
- `tests/test_category_tree_migration.py`: 0066 round trip; per-parent and partial root uniqueness.
- `tests/test_needed_item_name_migration.py`: 0067/0068 round trip; `product_id` gone, `name` present.
- `tests/test_vinted_category_seed_migration.py`: 0069 round trip; 9 roots in order; no legacy names; every non-root has an existing parent; unique `external_id`s; fixture validator rejects duplicate siblings; legacy-wipe cleanup of notifications by `proposal_id`/`link_path`, PENDING term-end outbox entries and PRODUCT_TEXT decisions.
- `tests/test_needed_item_name_migration.py` also checks that the 0068 downgrade succeeds with a needed item present.
- `tests/test_category_tree.py`: `parent_id` in the response; create a child; 409 for a parent with products; duplicate-sibling 409; delete-with-children 409; sibling-scoped move.
- `tests/test_product_leaf_category.py`: resolve, create and update with a non-leaf → 409; unknown → 404.
- `tests/test_item_listing_status.py`: register DRAFT and ACTIVE (pref created); register with a mode into a non-PERSONAL inventory → 403; PUT set/clear flips status; 11th GIFT → 409 on register (nothing persisted) and on PUT; confirmed GIFT → the item is DRAFT at its new owner; a pending photo upload keeps the pref; PUT with photos pending → 200.

**Backend test files expected to change:**
- `test_category_reintroduction.py` (5-row assertion → legacy absent) and `test_category_module.py` (messages, tree-aware create/move/delete).
- `test_product_category_fk_rename.py` and `test_pagination.py` (seeded "Zabawka" → leaf).
- `test_product_resolution.py`, `test_item_details.py` (+ `listing_status`), `test_term_item_listings.py` and `test_term_item_listings_router.py` (status, gift limit, no gate).
- `test_photo_moderation_gate.py` (rewrite to "allowed while pending").
- Delete, because their behaviour is removed: `test_photo_moderation_withdraw.py`, `test_photo_moderation_repoint.py`, `test_photo_moderation_hardening.py` (it imports from the gate and withdraw tests and exercises `withdraw_item_listing_if_photos_pending`), and `test_withdraw_unmoderated_listings_script.py` (with the script).
- `test_photo_moderation_queries.py`: drop the tests of `list_item_ids_for_product`, `list_pending_swap_proposals_involving_items` and the removed gate reads, and keep the `product_ids_with_unmoderated_photos` tests.
- `test_moderation.py`: drop the hook args.
- `test_category_module.py` additionally covers "delete a parent → podkategorie message" (not the products message), and `test_product_resolution.py` covers "update_product unchanged non-leaf category → 200".
- Needed items: `test_groups.py`, `test_public_term.py`, `test_organizer_page.py`, `test_organizer_page_queries.py`, `test_exchange_summary.py`, `test_notifications.py`, `test_group_soft_delete_keep_live.py`, `test_group_soft_delete_reads.py`, `test_authorization_matrix.py` (needed-item payloads `{term_id, name}`, key sets).
- Category-helper switch only: `test_attendance_withdrawal.py`, `test_circulation.py`, `test_conversation_inbox.py`, `test_conversation_messages.py`, `test_domain_clock_guard.py`, `test_item_conversations.py`, `test_reservation_write_guards.py`, `test_term_clock_regressions.py`, `test_term_end_scan.py`, `test_circulation_ledger.py`, `test_lend_listing_preferences_migration.py` if it registers items with categories.

**New frontend tests (expected):**
- `src/test/categoryTree.test.ts`: path, leaf and search table.
- `src/test/CategoryTreePicker.test.tsx`: drill-down, breadcrumb, Wstecz; search results with paths; diacritic-insensitive match and the 50-result cap hint; non-leaf result drills (leaf mode) or selects (any mode); ArrowDown+Enter selects; Esc clears the search without closing; focus returns to the trigger. Rendered inside a `<form onSubmit={spy}>`, three checks: the ✕ does not submit, Enter in search does not submit, and a scrim click closes the sheet without reopening it.

**Frontend test files expected to change:**
- `ItemCreatePage.test.tsx` (rewrite: three buttons, `listing_mode` payload, disabled until valid, gift-limit message verbatim with data kept, Enter does nothing), `ItemQuickAddForm.test.tsx`, `ItemQuickAddFormCategory.test.tsx`.
- `CategoryListPage.test.tsx` (tree, sibling move, 409 alert, disabled actions), `CategoryFormPage.test.tsx` (`?parent`, root, read-only parent on edit), `ProductFormPageCategory.test.tsx`, `ProductCategoryDisplayByCategoriesHook.test.tsx`, `useCategories.test.ts` (snake_case fixtures).
- `NeededItemQuickAddForm.test.tsx`, `EditTermDialog.test.tsx` (no category, no resolve).
- `MyItemsViewCategory.test.tsx` (toggles enabled while photos are pending), `ItemDetailPage.test.tsx` (including the gallery hint assertion ~L690), `useItemDetail.test.tsx`.
- `ProductListPage` filter test (leaves only, path labels), in the existing product list test file.
- Needed-item and pledge DTO fixtures: `TermPage.test.tsx`, `termViewModel.test.ts`, `organizerBlocks.test.tsx`, `organizerCirclesExchangeBlocks.test.tsx`, `organizerDirectorySupport.test.tsx`, `organizerMediaBlocks.test.tsx`, `OrganizerEditor.test.tsx`, `OrganizerTermsPage.test.tsx`, `PublicOrganizationPage.test.tsx`, `LayoutRenderer.test.tsx`, `useOrganizerPage.test.tsx`.
- `Category` type: `pages.test.tsx`, `extension-points.test.tsx`, `OrganizerItemRoute.test.tsx`, `OrganizerPhotosTab.test.tsx`.
- `AppPage.test.tsx`: **blocked on the user committing their uncommitted work.**

### Standards Compliance
- `standards/backend/models.md`: `BaseEntity` UUID ids; string-backed enum via `_enum_column`; business-key `__eq__`/`__hash__` `(parent_id, name)`; cross-module plain FK ids and bridges, with no new `relationship()`.
- `standards/backend/migrations.md`: separate schema and data revisions; explicit `fk_`/`ix_`/`uq_` names; partial unique index; reverse-order downgrades; a downgrade→upgrade pytest per revision.
  - **Deliberate deviation from "Additive Nullable Columns":** `inventory_items.listing_status` is NOT NULL with `server_default 'DRAFT'` (the default covers existing rows), and `needed_items.name` is NOT NULL (the table is empty after 0067). Both are user-confirmed.
- `standards/backend/api.md` / `global/error-handling.md`: typed `BusinessConflictException` / `EntityNotFoundException` with specific Polish messages; fail-fast validation.
- `standards/backend/security.md`: the matrix is unchanged; ADMIN-only category mutations.
- `standards/backend/queries.md`: the category list stays a single aggregated query; the gift count is a single `COUNT`; no N+1 in the needed-item reads after the joins are dropped.
- `standards/frontend/components.md` / `accessibility.md`: a single-responsibility picker over the shared ModalSheet; combobox Esc rules; focus return; `sr-only` spacing; disclosure buttons in the admin tree.
- `standards/frontend/data-fetching.md`: one `useCategories` subscriber per picker field (the sheet gets props); mutations invalidate the `categories` prefix; server messages pass through verbatim.
- `standards/global/validation.md`: server-side enforcement of the leaf rule and gift limit; required field with the submit buttons disabled while invalid; inline `role="alert"` errors.
- `standards/global/minimal-implementation.md`: dead gate code and the script are deleted; no MODERATION/REJECTED enum members; no descendant filter; no new endpoints.
- `standards/testing/backend-testing.md` / `frontend-testing.md`: flat `tests/test_<feature>.py` placement, `test_<operation>_<scenario>_<expected>` names, and explicit `vitest` imports.

## Audit resolution
Source: `verification/spec-audit.md` (pass-with-concerns; 0 critical, 1 high, 6 medium, 13 low). User-approved decisions are unchanged.

| Finding | Resolution in this spec |
|---------|-------------------------|
| H1 | FR-20: sheet portaled to `document.body`; every picker button and the `ModalSheet` ✕ are `type="button"`; Enter in search always `preventDefault()`; trigger uses `aria-labelledby`, never a wrapping `<label>`. FR-21: Kategoria field outside the `<label>` `Field`; `ItemCreatePage` `onSubmit` prevents default. FR-25: admin label as `<span id>`. New picker-in-form tests. |
| M1 | FR-22: drop the "Nowe zdjęcie zdejmuje…" sentence in `ItemGalleryEditor.tsx`; update `ItemDetailPage.test.tsx` ~L690. |
| M2 | Wipe step 3: also delete notifications by `proposal_id` and by `link_path` `/product/{id}`, and PENDING `groups.term_ended_giveaway`/`_swap` outbox entries. |
| M3 | FR-12: register-time hook requires a PERSONAL inventory → otherwise 403 `AccessDeniedException`; test added. |
| M4 | FR-2: `external_id` only when read from vinted.pl, else `null` (all-null acceptable); provenance README reviewed with the fixture. |
| M5 | FR-24: continue past failures, collect them, close the modal, one toast listing the rejected names + first server message; no retained drafts. |
| M6 | Testing: delete `test_photo_moderation_hardening.py`; `leaf_category_ids(…, n)` helper (n=2 for resolution); `test_photo_moderation_queries.py` keeps only surviving reads. |
| L1 | 0065 backfill test asserts at `0065`, then upgrades to head in `finally`; note that 0065 is kept for chain correctness. |
| L2 | FR-16: the 0068 downgrade deletes pledges and needed items before re-adding `product_id`; test added. |
| L3 | FR-15: dead-code list extended (`list_item_ids_for_product`, `list_pending_swap_proposals_involving_items`, groups-bridge `find_item_including_deleted`, the `get_item_for_share` chain); `UNMODERATED_STATUSES` comment fixed. FR-13 + New Components: `get_item_for_update`. |
| L4 | FR-7: explicit children-then-products `EXISTS` pre-checks before delete; test for the parent message. |
| L5 | Wipe step 9: also delete PRODUCT_TEXT `moderation_decisions` for P. |
| L6 | FR-13 reworded: groups writes the status only through the bridge; `register_item` sets the initial value. |
| L7 | FR-19/FR-20: diacritic-insensitive search; first 50 results plus a "zawęź wyszukiwanie" hint. |
| L8 | FR-9: `update_product` leaf check only when `category_id` changes; test added. |
| L9 | FR-22: `ItemDetailPage` keeps the leaf name; FR-25: `ProductListPage` filter lists leaves only, by path. |
| L10 | Standards Compliance: deliberate NOT NULL deviation acknowledged. |
| L11 | FR-19: `staleTime` 5 min on the categories query. |
| L12 | FR-3: the 0069 downgrade fails if any product exists, deletes every category leaves first (repeatedly deleting categories without children, never clearing `parent_id`), then re-inserts the 5 legacy rows. |
| L13 | FR-20: a non-leaf search result in `any` mode selects; FR-11: frontend `listing_status`/`listing_mode` types; FR-24: `addDraftNeededItem` caller change; Testing: the helper is never cached. |

## Out of Scope
- Renaming the "needed items" entity (a future task).
- MODERATION/REJECTED item statuses, and any change to photo moderation beyond the listing gate (cron, admin moderation page and rejected-photo hiding stay).
- Reparenting categories, drag-and-drop ordering, and descendant (subtree) product filtering.
- Fetching Vinted data at runtime or deploy time, and keeping the snapshot in sync.
- Restoring deleted legacy products or Spaces objects; a client-side gift-limit pre-check on the add page.
- Edits to the user's uncommitted files (`AddView.tsx`, `router.tsx`, `appHelpers.ts`, `AppPage.tsx`, `AppPage.test.tsx`, `EventCreateView.tsx`).

## Success Criteria
- After `alembic upgrade head`, `categories` holds only the reviewed Vinted tree: 9 roots in order, every node reachable from a root, and no legacy rows. `alembic downgrade 0063` followed by `upgrade head` succeeds.
- Every product write with a non-leaf category returns 409, and every picker in the app only lets the user choose leaves (except the admin parent picker).
- Oddam / Zamienię / Wersja robocza create the item with `listing_status` ACTIVE+GIFT / ACTIVE+SWAP / DRAFT respectively. An 11th GIFT returns the Polish 409 and persists nothing.
- For every item, `listing_status = 'ACTIVE'` exactly when an `item_listing_preferences` row exists, after register, set, clear, confirm and backfill.
- Uploading a PENDING photo or re-pointing an item never removes its pref, and `PUT` a mode while photos are pending returns 200.
- Needed items are created, edited, pledged and displayed by `name` with no product or category, and the public term page shows names.
- The picker meets the a11y rules: keyboard-only selection works, Esc in search does not close the sheet, and focus returns to the trigger.
- Using the picker never submits a host form: closing with ✕, pressing Enter in search or clicking the scrim leaves the admin forms and the add form unsubmitted, and a scrim click does not reopen the sheet.
- All new and changed tests pass. mypy and ruff are no worse than the HEAD baseline. `tsc -p tsconfig.app.json` is clean, except for the blocked `AppPage.test.tsx` until the user commits.
