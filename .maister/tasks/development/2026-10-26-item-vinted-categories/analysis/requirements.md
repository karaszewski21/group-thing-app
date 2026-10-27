# Requirements: Vinted category tree + Oddam / Zamienię / Wersja robocza

## TL;DR
- Replace "Typ" with a required "Kategoria" leaf picked from a seeded Polish Vinted tree (ModalSheet picker with search + drill-down), everywhere items/products pick a category.
- The add-item form submits via three buttons: Oddam (ACTIVE + GIFT), Zamienię (ACTIVE + SWAP), Wersja robocza (DRAFT, no mode).
- Items get an explicit `status` (DRAFT/ACTIVE) kept in lockstep with the listing `mode`; the photo-moderation listing gate is removed; the backend enforces the 10-gift limit.
- The term's needed items lose their product/category link and become plain names; existing needed items and pledges are wiped (dev data).
- The 5 legacy categories are deleted with their products; admin manages the tree (no reparenting).

## Key Decisions
- Status lives on the item (`inventory_items.status`, DRAFT/ACTIVE; MODERATION/REJECTED reserved for later); `mode` stays on `item_listing_preferences`. ACTIVE iff a pref row exists. — user's model.
- Backfill: `status` NOT NULL default DRAFT (schema revision), then a data revision sets ACTIVE for items with a pref. — user confirmed.
- Needed items: add `name`, drop `product_id`, wipe existing needed items and pledges. — user: "Wyczyść dane".
- Reuse ModalSheet, trapFocus, useRegisterOpenSheet, LocationAddForm combobox pattern, EXCHANGE_MODE_LABELS. — user: these suffice.

## Open Questions / Risks
- Wiping legacy products cascades to inventory items, prefs, reservations, swap proposals, photos; delete in dependency order (dev data only).
- `inventory_items.status` vs `InventoryBalance.status` naming collision; spec must name/document it distinctly (e.g. `listing_status`) or justify `status`.
- Vinted catalog ids may be missing for some nodes (`external_id` nullable).

## Initial description
"chce zmienić w dodawaniu rzeczy typ na kategorie. Kategorię listę chcę wziąć całą z Vinted. 3 przyciski: Oddam, Zamienię, Wersja robocza."

## Q&A (all rounds)
Phase 1 (clarifications.md): full Vinted tree, cascading + search, leaf assignment; existing 5 categories are dev data; draft = no listing mode; tree picker everywhere incl. admin rebuild.

Phase 2 (scope-clarifications.md):
- Pending-intent concept dropped. Explicit item status DRAFT/ACTIVE (+ later MODERATION/REJECTED); GIFT/SWAP stays in `mode`.
- Photo moderation: only the listing gate is removed (no 409 on PUT pref while photos PENDING/NEEDS_REVIEW; photo upload no longer withdraws offers). Moderation itself (VPS B cron, admin page, hiding rejected photos) stays.
- Vinted source: one-time vinted.pl snapshot → `alembic/data/vinted_categories_pl.json`, user reviews fixture; roots Kobiety, Mężczyźni, Dzieci, Dom, Elektronika, Rozrywka, Hobby i kolekcje, Sport, Zwierzęta.
- Seed: JSON + nullable unique `external_id` (Vinted catalog id); schema revision separate from data revision.
- Backend enforces MAX_GIFT_ITEMS=10 on create and mode change (Polish message "Możesz mieć maksymalnie 10 rzeczy do oddania…").
- Needed items decoupled from products (plain names) in this task; entity rename = future task.
- Admin: create child, rename, sibling reorder, delete (409 with children or products); no reparenting; child under a leaf with products → 409 "Kategoria ma przypisane rzeczy".
- Legacy 5 categories deleted together with their products.
- Picker: ModalSheet, search with full-path results + drill-down with breadcrumb/"Wstecz".

Phase 5:
- Status transitions: set mode → ACTIVE; clear mode → DRAFT; completed gift/swap → item arrives at the new owner as DRAFT (pref row deleted as today).
- Migration backfill: default DRAFT; items with a pref → ACTIVE.
- Needed items: wipe existing rows + pledges; new `name` column; drop `product_id`.
- No further reference features beyond ModalSheet, LocationAddForm combobox, EXCHANGE_MODE_LABELS.

## User journey
- Owner: Dodaj (AddView tile) → `/product/new` → name, condition, Kategoria (picker), photos → Oddam / Zamienię / Wersja robocza → item page. Mode can later change in "Moje rzeczy" (status follows).
- Owner editing item: NameCategoryEditor "Kategoria" via the same picker.
- Organizer: term edit / needed list → plain name only.
- Admin: Kategorie → tree list, add child/root, rename, reorder siblings, delete; admin ProductFormPage uses the picker.

## Similar features / reuse
- `components/shared/ModalSheet`, `trapFocus.ts`, `openSheets.ts` (`useRegisterOpenSheet`).
- `components/shared/LocationAddForm.tsx` combobox a11y pattern.
- `EXCHANGE_MODE_LABELS` for Oddam/Zamienię labels.
- `useCategories` / `api/categories.ts`, `useCreateItem`, `set_item_listing_preference`, `move_category`, APScheduler not needed anymore.

## Visual assets
- `analysis/design-context/INDEX.md` + 9 HTML mockups in `analysis/design-context/mockups/` (approved, binding).

## Functional requirements summary
1. Category tree: `parent_id` (self FK), uniqueness `(parent_id, name)` + partial unique for roots, `external_id` nullable unique; seeded from JSON; legacy 5 + their products removed.
2. Leaf-only assignment for products (resolve/create validates leaf; Polish 422/409).
3. Category API exposes `parent_id` (+ external_id if useful); admin CRUD tree-aware; delete 409 on children/products; add child under leaf-with-products 409; sibling-scoped move; no reparent.
4. Item `status` DRAFT/ACTIVE in lockstep with listing pref; exposed in item responses.
5. Create-item flow accepts mode GIFT/SWAP/null; mode applied after photo uploads; status set accordingly.
6. Photo-moderation gate removed from listing pref set and from photo upload withdraw.
7. Server gift limit 10 on create and mode change.
8. Needed items: `name` column, `product_id` dropped, data wiped, all readers (pledges, organizer_page, terms, repository joins) switched to name.
9. Frontend: shared CategoryTreePicker (search + drill-down, leaf-only, any-node mode for admin parent), path label helper; used in ItemQuickAddForm, NameCategoryEditor, ProductFormPage, CategoryFormPage; NeededItemQuickAddForm/EditTermDialog without category; ItemCreatePage three buttons, hint removed; admin CategoryListPage tree.

## Scope boundaries
- In: everything above.
- Out: entity rename of needed items; photo moderation removal beyond the listing gate; reparenting; runtime Vinted fetch; changes to the uncommitted user work in AddView/router/appHelpers/AppPage/EventCreateView (do not edit; `appHelpers.ts` read-only unless user commits).

## Technical considerations
- Migrations numbered from the current head (gap analysis suggested 0064+), each with downgrade→upgrade pytest.
- Frontend `Category` type in snake_case (`parent_id`), fix stale camelCase fields.
- Exact key-set response tests must be updated, not loosened.
- Tests relying on 5 seeded categories / moderation gate must be rewritten.
