# Implementation Plan: Vinted category tree + Oddam / Zamienię / Wersja robocza

## TL;DR
- 17 task groups, 115 steps, about 84–94 focused tests. There are 8 backend groups (fixture, migrations, seed, category, listing, gate removal, needed items, suite alignment), 7 frontend groups, a test review group, and one blocked deferred group.
- The order is: fixture (Group 1, ends at a USER REVIEW checkpoint) and migrations 0064–0068 (Group 2) → seed 0069 + leaf helper (Group 3) → backend domains (Groups 4–7) → backend suite alignment (Group 8).
- The frontend starts with the category utilities (Group 9) and the picker (Group 10), then the add-item, edit, admin and needed-item screens (Groups 11–14), then fixture alignment (Group 15) and test review (Group 16).
- Group 17 (AppPage.test.tsx, appHelpers.ts) stays blocked until the user commits their uncommitted work. Until then, `tsc -p tsconfig.app.json` and the full Vitest run are expected to fail only in `AppPage.test.tsx`.

## Key Decisions
- Compiling the fixture is its own first group, and its last step is a USER REVIEW checkpoint. 0069 depends on it. Until the user approves, 0069 may run only on ephemeral testcontainers databases, never on a persistent database (dev compose, staging, prod).
- The ORM mappings move together with their schema revisions in Group 2, so the models always match `alembic upgrade head`. The cost is that the needed-item service code (`product_id`) stays broken until Group 7. Groups 2–6 run only their own tests in the meantime.
- The `leaf_category_ids` conftest helper lands with 0069 (Group 3), because that revision is what turns `categories[0]` into a non-leaf root. Each domain group switches the test files it already touches. Group 8 switches the remaining test files that only need the helper.
- The gate removal (Group 6) comes after the listing status work (Group 5). Both edit `term_item_listings.py`, `circulation_bridge.py` and the circulation router, and Group 6 deletes the `get_item_for_share` chain that Group 5 replaces with `get_item_for_update`.
- Frontend groups use mocked API modules, so they depend only on each other and on the spec contract, not on the backend groups. Their integration is checked in Group 16 and by the verification phase.
- The test budget is above the default 16–34. With 14 implementation groups at 2–8 tests each, the total is about 84 new or rewritten tests plus up to 10 gap tests. The spec's expected-test list requires this.
- Two mockup deviations follow the spec. The admin tree uses nested lists with disclosure buttons, while the mockup uses `role="tree"`. Picker triggers are `<button type="button">` labelled through `aria-labelledby`, while the mockups use a `div role=button` inside a `<label>`.

## Open Questions / Risks
- **Fixture review blocks Groups 3–8.** Group 1 is not complete until the user approves the fixture. Groups 2 and 9–15 can proceed in the meantime.
- **Interim backend breakage.** Between Group 2 and Group 7, any test that creates or reads needed items fails, because the ORM no longer has `product_id` and the services still use it. Between Group 3 and Group 8, test files that still use `categories[0]` fail. Groups run only their own tests in these windows.
- **Interim frontend type errors.** The snake_case `Category` change (Group 9) breaks the type-check of consumers until Groups 13 and 15. `AppPage.test.tsx` stays red until Group 17.
- **Destructive 0069.** It wipes all products, items and their dependents. FK targets must be re-grepped during implementation (step 3.2).
- **Shared files.** `app/groups/schemas.py` (Groups 5 and 7), `app/product/service.py` (Groups 4 and 6), `product_bridge.py` (Groups 6 and 7), `AppDataContext.tsx` (Groups 12 and 14) and `pages.test.tsx` (Groups 13 and 15) are declared in both groups of each pair, so the executor serializes those groups.
- **AppDataContext `categories` export.** It is removed only if no consumer remains, and that includes the uncommitted `AppPage.tsx`/`AddView.tsx`, which must not be edited. If either of them still consumes it, the export stays.

## Overview
Total Steps: 115
Task Groups: 17
Expected Tests: ~84 focused new/rewritten tests + up to 10 gap tests (≈84–94)

Commands:
- **Backend:** run from `src/backend` with `uv run python -m pytest <files>`, `uv run python -m mypy app` and `uv run python -m ruff check .`. The mypy baseline at HEAD is about 32 errors.
- **Frontend:** run from `src/frontend` with `npx vitest run <files>`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint` and `npm test`.

Secrets: never print secret values. No `env`/`printenv`, `cat .env` or `docker inspect` Env output. Check configuration by presence only. This rule is repeated in every group that touches a database or configuration.

## Implementation Steps

### Task Group 1: Vinted Category Fixture (data snapshot + provenance)
**Dependencies:** None
**Files to Modify:** src/backend/alembic/data/vinted_categories_pl.json, src/backend/alembic/data/vinted_categories_pl.README.md, src/backend/tests/test_vinted_category_fixture.py
**Estimated Steps:** 6

- [x] 1.0 Complete Vinted fixture layer
  - [x] 1.1 Write 4 pure (no-DB) tests in `tests/test_vinted_category_fixture.py` that read the real JSON:
    - The roots are exactly, in order: Kobiety, Mężczyźni, Dzieci, Dom, Elektronika, Rozrywka, Hobby i kolekcje, Sport, Zwierzęta.
    - Every `name` is trimmed and 1–100 characters long, and nodes only use the keys `name`, `external_id` and `children`.
    - Sibling names are unique within each children list.
    - Every non-null `external_id` is an `int`, and they are globally unique.
  - [x] 1.2 Compile the tree from the vinted.pl catalog navigation (one root at a time, for example with WebFetch).
    - Keep the Polish names exactly as displayed and keep the site's order, since array order becomes `sort_order`.
    - Expect up to 5 levels and about 800–1000 nodes. Leaves use `children: []`.
  - [x] 1.3 Fill in `external_id` only when it is read from a vinted.pl catalog URL (`/catalog/{id}-…`) or page. Otherwise it is `null`. Never guess an id. A fixture with all ids null is acceptable (FR-2, M4).
  - [x] 1.4 Write `vinted_categories_pl.README.md` with:
    - the source URLs/pages and the snapshot date;
    - how the ids were obtained, and the count of null ids;
    - node counts per root and the maximum depth;
    - a one-line ToS/one-time-snapshot note.
  - [x] 1.5 Run only `uv run python -m pytest tests/test_vinted_category_fixture.py`.
  - [x] 1.6 **USER REVIEW CHECKPOINT (blocking).**
    - Stop and present the fixture and README summary to the user: roots, node counts, depth, null-id count and sample paths.
    - Record the explicit approval (date, and any requested edits) in the work-log. Apply any requested edits, then re-run 1.5.
    - Until the user approves: revision 0069 must not be applied to any persistent database (dev compose DB, staging, prod). Ephemeral testcontainers databases are fine.
    - This group stays incomplete until the user approves.

**Acceptance Criteria:**
- The 4 fixture tests pass.
- The README states the provenance, and no `external_id` is invented.
- The user's approval is recorded in the work-log.

### Task Group 2: Schema & Data Migrations 0064–0068 + ORM Mappings
**Dependencies:** None
**Files to Modify:** src/backend/alembic/versions/0064_item_listing_status.py, src/backend/alembic/versions/0065_backfill_item_listing_status.py, src/backend/alembic/versions/0066_category_tree.py, src/backend/alembic/versions/0067_wipe_needed_items.py, src/backend/alembic/versions/0068_needed_item_name.py, src/backend/app/circulation/models.py, src/backend/app/category/models.py, src/backend/app/groups/models.py, src/backend/tests/test_item_listing_status_migration.py, src/backend/tests/test_category_tree_migration.py, src/backend/tests/test_needed_item_name_migration.py
**Estimated Steps:** 8

- [x] 2.0 Complete migrations 0064–0068 layer
  - [x] 2.1 Write 6 tests, using `tests/test_group_soft_delete_migration.py` and `tests/test_locations_migration.py` as templates:
    - 0064 round trip: the column exists with default `DRAFT`.
    - 0065 backfill: seed an item and a pref, upgrade only to `0065`, and assert `ACTIVE`. Upgrade to `head` in `finally` (L1).
    - 0066 round trip, plus the same name under two parents is allowed while a duplicate under one parent fails.
    - 0066: two roots with the same name fail (partial `uq_categories_root_name`).
    - 0067/0068 round trip: `product_id` is gone and `name` is present.
    - The 0068 downgrade succeeds with a needed item present (L2).
  - [x] 2.2 `0064_item_listing_status`: add `inventory_items.listing_status VARCHAR(20) NOT NULL server_default 'DRAFT'`. The downgrade drops it.
  - [x] 2.3 `0065_backfill_item_listing_status`: `UPDATE … SET listing_status='ACTIVE' WHERE id IN (SELECT item_id FROM item_listing_preferences)`. The downgrade resets every row to `'DRAFT'`.
  - [x] 2.4 `0066_category_tree`, upgrade:
    - Add `parent_id UUID NULL` with `fk_categories_parent_id_categories` (RESTRICT) and `ix_categories_parent_id`.
    - Add `external_id INTEGER NULL` with `uq_categories_external_id`.
    - Drop `uq_categories_name`, then add `uq_categories_parent_id_name (parent_id, name)` and the partial `uq_categories_root_name (name) WHERE parent_id IS NULL`.
    - The downgrade reverses this in reverse dependency order.
  - [x] 2.5 `0067_wipe_needed_items`: `DELETE FROM pledges; DELETE FROM needed_items`. The downgrade is a no-op.
  - [x] 2.6 `0068_needed_item_name`:
    - Upgrade: add `needed_items.name VARCHAR(255) NOT NULL`, then drop `fk_needed_items_product_id_products` and then `product_id`.
    - Downgrade: `DELETE FROM pledges; DELETE FROM needed_items`, re-add `product_id UUID NOT NULL` with its FK, then drop `name`.
  - [x] 2.7 Update the ORM to match:
    - `app/circulation/models.py`: `ItemListingStatus(StrEnum){DRAFT, ACTIVE}` and `listing_status` through `_enum_column` (with a server default).
    - `app/category/models.py`: `parent_id` as a plain FK column with no `relationship()`, plus `external_id`. Table args match 0066. `__eq__`/`__hash__` use the business key `(parent_id, name)`.
    - `app/groups/models.py` `NeededItem`: add `name` and remove `product_id`.
  - [x] 2.8 Run only the 3 migration test files. Never print DB credentials; check configuration by presence only.

**Acceptance Criteria:**
- The 6 migration tests pass, and each revision's downgrade→upgrade works.
- The constraint and index names follow `standards/backend/migrations.md`.
- Known interim state: the needed-item service code is broken until Group 7. This is not a failure of this group.

### Task Group 3: Legacy Wipe & Vinted Seed Migration 0069 + Leaf Test Helper
**Dependencies:** 1, 2
**Files to Modify:** src/backend/alembic/versions/0069_vinted_categories.py, src/backend/tests/test_vinted_category_seed_migration.py, src/backend/tests/conftest.py, src/backend/tests/test_category_reintroduction.py
**Estimated Steps:** 8

- [x] 3.0 Complete seed migration layer
  - [x] 3.1 Write 8 tests in `test_vinted_category_seed_migration.py`, and update `test_category_reintroduction.py` (the legacy names are absent at head):
    - downgrade to `0068` → upgrade head round trip;
    - 9 roots in fixture order;
    - no legacy names (Zabawka, Książka, Gra, Ubranie, Inne) remain;
    - every non-root has an existing parent;
    - the non-null `external_id`s are unique;
    - the fixture validator rejects duplicate siblings (in-memory bad fixture);
    - legacy-wipe cleanup: at `0068`, seed a legacy-category product with an item, a reservation, a swap proposal, notifications by `reservation_id`/`proposal_id`/`link_path=/product/{id}`, a PENDING `groups.term_ended_giveaway` outbox entry and a PRODUCT_TEXT decision. After upgrade all of them are gone;
    - the downgrade raises when a product exists.
  - [x] 3.2 Re-grep `ForeignKey("inventory_items.id"|"products.id"|"reservations.id")` and the loose `*_item_id`/`reservation_id` columns. Extend the delete order with any new dependent.
  - [x] 3.3 Implement the fixture loader and validator inside 0069:
    - checks: shape, trimmed names of 1–100 characters, sibling uniqueness, global `external_id` uniqueness;
    - failures raise with the path of the offending node.
  - [x] 3.4 Implement the legacy wipe in the spec's 11-step FK-safe order, over the set of category ids that exist before the seed, P (their products) and I (those products' items).
    - Use `sa.text` with bound parameters or subqueries.
    - This includes the outbox `status='PENDING'` term-end events and the PHOTO/PRODUCT_TEXT moderation decisions.
  - [x] 3.5 Insert the tree with app-generated `uuid4` ids and parent ids, and `sort_order` set from the 0-based position within each sibling list. Use a single batched insert.
  - [x] 3.6 Downgrade:
    - Raise "remove products before downgrading 0069" if any `products` row exists.
    - Then `UPDATE categories SET parent_id = NULL; DELETE FROM categories`.
    - Re-insert the 5 legacy rows (sort 0–4), following the pattern in `0025_category_reintroduction.py`.
  - [x] 3.7 Add `leaf_category_ids(client, headers, n=1)` to `tests/conftest.py`. It returns the first `n` distinct categories that have no children. It queries the API on every call and is never cached at session or module scope.
  - [x] 3.8 Run only `test_vinted_category_seed_migration.py` and `test_category_reintroduction.py` on testcontainers.
    - Do not run `alembic upgrade` against any persistent DB unless the Group 1 approval is recorded.
    - Never print secrets; check configuration by presence only.

**Acceptance Criteria:**
- The 8 seed tests plus the updated reintroduction test pass.
- At head, `categories` holds only the fixture tree, and the downgrade semantics match FR-3.

### Task Group 4: Backend Category Tree API & Leaf-Only Products
**Dependencies:** 3
**Files to Modify:** src/backend/app/category/schemas.py, src/backend/app/category/service.py, src/backend/app/category/router.py, src/backend/app/product/service.py, src/backend/tests/test_category_tree.py, src/backend/tests/test_product_leaf_category.py, src/backend/tests/test_category_module.py, src/backend/tests/test_product_resolution.py
**Estimated Steps:** 10

- [x] 4.0 Complete category tree layer
  - [x] 4.1 Write 8 tests:
    - `test_category_tree.py`:
      - the response key set includes `parent_id`;
      - a created child gets sibling max `sort_order` + 1;
      - creating under a parent with products → 409 "Kategoria ma przypisane rzeczy";
      - a duplicate sibling name → 409 "…na tym poziomie";
      - deleting a parent → 409 "…ma podkategorie." (not the products message);
      - `move` is sibling-scoped and a no-op at the boundary.
    - `test_product_leaf_category.py`:
      - resolve, create and update with a non-leaf → 409 "Wybierz najbardziej szczegółową kategorię (bez podkategorii).";
      - an unknown category → 404.
  - [x] 4.2 Schemas:
    - `CategoryResponse.parent_id: UUID | None`; `external_id` is not exposed.
    - `CreateCategoryRequest.parent_id: UUID | None = None`.
    - `UpdateCategoryRequest` gets no `parent_id`.
  - [x] 4.3 `list_categories`: a single aggregated query ordered by `sort_order, name`, including `parent_id` and `product_count`.
  - [x] 4.4 `create_category`:
    - checks in this order: unknown parent → 404; parent with products → 409; duplicate sibling (explicit check, with `IS NULL` for roots) → 409;
    - `sort_order` = sibling max + 1.
  - [x] 4.5 `update_category`: rename and description only, with the duplicate-sibling 409.
  - [x] 4.6 `delete_category`: run `EXISTS` children → 409 "Nie można usunąć „{name}”: kategoria ma podkategorie.", then `EXISTS` products → 409 "…ma przypisane rzeczy.". Replace the English `CategoryHasProductsException` text.
  - [x] 4.7 `move_category`: swap only with the adjacent sibling that has the same `parent_id`.
  - [x] 4.8 Add `require_leaf_category(db, category_id)` in `app/category/service.py` (404 when unknown, 409 when it has children). The category module must not import the product ORM; it keeps its ad-hoc `_products` table.
    - Call it in `create_product`.
    - Call it in `get_or_create_product_by_name`, before the name lookup.
    - Call it in `update_product` only when `category_id` changes (L8).
  - [x] 4.9 Update `test_category_module.py` (messages, tree-aware create/move/delete) and `test_product_resolution.py`:
    - use `leaf_category_ids(n=2)`;
    - add "update with an unchanged non-leaf category → 200".
  - [x] 4.10 Run only the 4 test files above.

**Acceptance Criteria:**
- The 8 new tests and the updated module/resolution tests pass.
- Every product write with a non-leaf category returns 409.
- `GET /api/categories` is still a single query.

### Task Group 5: Backend Listing Status, Register-with-Mode & Gift Limit
**Dependencies:** 3
**Files to Modify:** src/backend/app/circulation/schemas.py, src/backend/app/circulation/router.py, src/backend/app/circulation/service.py, src/backend/app/circulation/application/inventory_items.py, src/backend/app/circulation/application/item_details.py, src/backend/app/circulation/infrastructure/repository.py, src/backend/app/groups/application/term_item_listings.py, src/backend/app/groups/infrastructure/circulation_bridge.py, src/backend/app/groups/schemas.py, src/backend/app/groups/router/term_item_listings.py, src/backend/tests/test_item_listing_status.py, src/backend/tests/test_item_details.py, src/backend/tests/test_term_item_listings.py, src/backend/tests/test_term_item_listings_router.py
**Estimated Steps:** 10

- [x] 5.0 Complete listing status layer
  - [x] 5.1 Write 8 tests in `test_item_listing_status.py`:
    - register with `listing_mode=null` → DRAFT, no pref;
    - register with SWAP → ACTIVE plus a pref;
    - register with a mode into a non-PERSONAL inventory → 403, nothing persisted;
    - register with a non-offerable mode → rejected by the validator (same status as `_OFFERABLE_RESERVATION_TYPES`; the spec says 400);
    - PUT set → ACTIVE, clear → DRAFT;
    - the 11th GIFT on register → 409 "…Wybierz „Zamienię” albo zapisz wersję roboczą.", with no new item;
    - the 11th GIFT on PUT → 409 "…Zdejmij „Oddam” z innej rzeczy.";
    - a confirmed GIFT → the item is DRAFT at its new owner.
  - [x] 5.2 Schemas:
    - `CreateInventoryItemRequest.listing_mode: GIFT | SWAP | None = None`, with a validator;
    - `listing_status` on `InventoryItemResponse`, `ItemDetailsResponse` and `MyInventoryItemResponse`.
  - [x] 5.3 Refactor `register_item`:
    - set `listing_status` from the mode;
    - add an optional flush-only `on_registered` hook;
    - commit once, after the hook. Any exception means no commit.
  - [x] 5.4 Add `get_item_for_update` (`SELECT … FOR UPDATE`: repository → `inventory_items` → `circulation.service` → `circulation_bridge`). Add a flush-only `set_item_listing_status` through the service and the bridge.
  - [x] 5.5 Add the register-time listing hook in `term_item_listings.py`: PERSONAL check (`AccessDeniedException` → 403) → `get_profile_by_account_user_id` → gift-limit count → insert pref. Inject it from `app/circulation/router.py`, following the `on_product_changed` pattern.
  - [x] 5.6 Add `MAX_GIFT_ITEMS = 10` and one count helper (a single `COUNT` of the owner party's GIFT prefs, excluding the item itself), shared by both paths and their two Polish messages.
  - [x] 5.7 `set_item_listing_preference`: replace `get_item_for_share` with `get_item_for_update`. Setting a mode → ACTIVE; clearing it → DRAFT, through the bridge.
  - [x] 5.8 `confirm_transaction`: every item whose pref is deleted (both SWAP legs) → DRAFT.
  - [x] 5.9 Expose `listing_status` in `item_details` and the groups My-inventory read.
    - Update the exact key sets in `test_item_details.py`, `test_term_item_listings.py` and `test_term_item_listings_router.py` (update them, never loosen them).
    - Switch these files to `leaf_category_ids`.
  - [x] 5.10 Run only the 4 test files above.

**Acceptance Criteria:**
- The 8 new tests and the updated key-set tests pass.
- "ACTIVE ⇔ pref row exists" holds after register, set, clear and confirm.
- A gift-limit or 403 failure persists nothing.

### Task Group 6: Backend Moderation Listing-Gate Removal & Dead Code
**Dependencies:** 5
**Files to Modify:** src/backend/app/groups/application/term_item_listings.py, src/backend/app/circulation/router.py, src/backend/app/circulation/service.py, src/backend/app/circulation/application/inventory_items.py, src/backend/app/circulation/infrastructure/repository.py, src/backend/app/groups/infrastructure/circulation_bridge.py, src/backend/app/groups/infrastructure/product_bridge.py, src/backend/app/product/service.py, src/backend/app/product/router.py, src/backend/scripts/withdraw_unmoderated_listings.py, src/backend/tests/test_photo_moderation_gate.py, src/backend/tests/test_photo_moderation_withdraw.py, src/backend/tests/test_photo_moderation_repoint.py, src/backend/tests/test_photo_moderation_hardening.py, src/backend/tests/test_withdraw_unmoderated_listings_script.py, src/backend/tests/test_photo_moderation_queries.py, src/backend/tests/test_moderation.py, .maister/docs/project/architecture.md
**Estimated Steps:** 8

- [x] 6.0 Complete gate removal layer
  - [x] 6.1 Rewrite `test_photo_moderation_gate.py` with 4 "allowed while pending" tests:
    - PUT a mode with PENDING/NEEDS_REVIEW photos → 200, and the item is ACTIVE;
    - uploading a PENDING photo keeps the pref;
    - re-pointing an item (`update_item` to another product) keeps the pref;
    - `photos_moderation_pending` is still reported.
  - [x] 6.2 Remove the photo gate from `set_item_listing_preference` and delete `PHOTOS_IN_MODERATION_MESSAGE`.
  - [x] 6.3 Remove the hooks and their router injections:
    - `add_product_photo` (service and router) drops the `on_pending_photo` parameter and call;
    - `update_item` drops `on_product_changed`.
  - [x] 6.4 Delete the dead code from FR-15, re-grepping for callers before each deletion:
    - `withdraw_product_listings`, `withdraw_item_listing_if_photos_pending`, `_withdraw_items`, `_WITHDRAWN_*` and `_listing_product_name`;
    - the product-bridge/product-service `has_unmoderated_photos` and `list_product_ids_with_unmoderated_photos`;
    - `list_item_ids_for_product` (bridge and service) and `repository.list_pending_swap_proposals_involving_items`;
    - the groups-bridge `find_item_including_deleted` (the circulation service function stays);
    - the whole `get_item_for_share` chain.
  - [x] 6.5 Delete the script and the tests for removed behaviour:
    - delete `scripts/withdraw_unmoderated_listings.py`, `test_photo_moderation_withdraw.py`, `test_photo_moderation_repoint.py`, `test_photo_moderation_hardening.py` and `test_withdraw_unmoderated_listings_script.py`;
    - trim `test_photo_moderation_queries.py` to keep the `product_ids_with_unmoderated_photos` tests;
    - drop the hook args in `test_moderation.py`.
  - [x] 6.6 Correct the `UNMODERATED_STATUSES` comment in `app/product/service.py` and the `list_my_active_taken_term_item_listings` fallback comment.
  - [x] 6.7 Update `.maister/docs/project/architecture.md`, § "Photo Upload and Content Moderation":
    - remove the publish-gate/withdraw bullets and the cleanup script;
    - add a short note on `listing_status` lockstep and the category tree.
  - [x] 6.8 Run only `test_photo_moderation_gate.py`, `test_photo_moderation_queries.py`, `test_moderation.py` and `test_item_listing_status.py`.

**Acceptance Criteria:**
- The 4 rewritten gate tests pass, and the trimmed and kept moderation tests pass.
- No production code references any of the deleted symbols (verified by grep).

### Task Group 7: Backend Needed Items as Plain Names
**Dependencies:** 2, 3
**Files to Modify:** src/backend/app/groups/schemas.py, src/backend/app/groups/application/terms.py, src/backend/app/groups/application/pledges.py, src/backend/app/groups/application/public_view.py, src/backend/app/groups/application/organizer_page.py, src/backend/app/groups/application/exchange_summary.py, src/backend/app/groups/service.py, src/backend/app/groups/infrastructure/repository.py, src/backend/app/groups/infrastructure/product_bridge.py, src/backend/app/groups/router/terms.py, src/backend/app/groups/router/pledges.py, src/backend/tests/test_groups.py, src/backend/tests/test_public_term.py, src/backend/tests/test_organizer_page.py, src/backend/tests/test_organizer_page_queries.py, src/backend/tests/test_exchange_summary.py, src/backend/tests/test_notifications.py, src/backend/tests/test_group_soft_delete_keep_live.py, src/backend/tests/test_group_soft_delete_reads.py, src/backend/tests/test_authorization_matrix.py
**Estimated Steps:** 8

- [x] 7.0 Complete needed-items layer
  - [x] 7.1 Write 6 focused tests in `test_groups.py` and `test_public_term.py`:
    - create `{term_id, name}` → the exact `NeededItemResponse` key set `{id, term_id, name, description, claimed, created_at, updated_at}`;
    - a name containing contact info → rejected (`ensure_no_contact_info`);
    - updating the name re-runs moderation and persists the new name;
    - the public view returns the `PublicNeededItemResponse` key set with `name`;
    - `MyPledgeResponse.item_name` is set;
    - the pledge outbox payload's `product_name` takes the needed-item name.
  - [x] 7.2 Schemas per FR-17: create, update, `NeededItemResponse`, `PublicNeededItemResponse`, `OrganizerNeededItemResponse.name` and `MyPledgeResponse.item_name`.
  - [x] 7.3 `terms.py`:
    - `_needed_item_view`;
    - create and update with `ensure_no_contact_info` + `check_text(TextField.PRODUCT_NAME)` (on create, and on a name change);
    - the `soft_delete_needed_item` notification text uses `name`.
  - [x] 7.4 `pledges.py`: the outbox key stays `product_name`, but its value is `needed_item.name`. `MyPledge` uses `item_name`.
  - [x] 7.5 Switch `public_view.py`, `organizer_page.py`, `exchange_summary.py` and `groups/service.py` to `needed_items.name`. Re-grep `product_id` in `app/groups` for any missed reader.
  - [x] 7.6 `repository.py`:
    - rename `get_needed_item_with_product`, `list_needed_items_with_product_for_term(s)` and the pledge-list join so they drop "with_product";
    - remove the Product/Category joins and order by `NeededItem.name`, with no N+1;
    - update the `product_bridge.py` docstring.
  - [x] 7.7 Update the needed-item payloads (`{term_id, name}`) and key sets in `test_organizer_page.py`, `test_organizer_page_queries.py`, `test_exchange_summary.py`, `test_notifications.py`, `test_group_soft_delete_keep_live.py`, `test_group_soft_delete_reads.py` and `test_authorization_matrix.py`. Switch these files to `leaf_category_ids` where they register items.
  - [x] 7.8 Run only the test files listed in this group.

**Acceptance Criteria:**
- The 6 new tests and all updated needed-item tests pass.
- No `NeededItem.product_id` reference remains in `app/`.

### Task Group 8: Backend Test-Suite Leaf-Category Alignment
**Dependencies:** 3, 4, 5, 6, 7
**Files to Modify:** src/backend/tests/test_attendance_withdrawal.py, src/backend/tests/test_circulation.py, src/backend/tests/test_conversation_inbox.py, src/backend/tests/test_conversation_messages.py, src/backend/tests/test_domain_clock_guard.py, src/backend/tests/test_item_conversations.py, src/backend/tests/test_reservation_write_guards.py, src/backend/tests/test_term_clock_regressions.py, src/backend/tests/test_term_end_scan.py, src/backend/tests/test_circulation_ledger.py, src/backend/tests/test_lend_listing_preferences_migration.py, src/backend/tests/test_product_category_fk_rename.py, src/backend/tests/test_pagination.py
**Estimated Steps:** 4

- [x] 8.0 Complete backend suite alignment
  - [x] 8.1 Red baseline: no new tests, because the existing tests in these files are the tests. Run the listed files and grep `tests/` for `categories.json()[0]`, `"Zabawka"` and name-based category lookups. Record the failing tests.
  - [x] 8.2 Switch each hit to `leaf_category_ids(client, headers, n)`, with no caching.
  - [x] 8.3 In `test_product_category_fk_rename.py` and `test_pagination.py`, replace the seeded "Zabawka" with a leaf obtained from the helper.
  - [x] 8.4 Run only the 13 listed files. Then run `uv run python -m mypy app` and `uv run python -m ruff check .`, which must be no worse than the HEAD baseline (about 32 mypy errors). Never print secrets; check configuration by presence only.

**Acceptance Criteria:**
- The 13 files pass.
- No `categories.json()[0]` remains in `tests/`.
- mypy and ruff are no worse than the baseline.

### Task Group 9: Frontend Category Data & Tree Utilities
**Dependencies:** None (contract: spec FR-4/FR-19)
**Files to Modify:** src/frontend/src/api/categories.ts, src/frontend/src/utils/categoryTree.ts, src/frontend/src/hooks/useCategories.ts, src/frontend/src/test/categoryTree.test.ts, src/frontend/src/test/useCategories.test.ts
**Estimated Steps:** 5

- [x] 9.0 Complete category data layer
  - [x] 9.1 Write 6 tests:
    - `categoryTree.test.ts` (an `it.each` table):
      - the index sorts children by `sort_order`;
      - `isLeaf`;
      - `formatCategoryPath` with " › ";
      - `searchCategories("ksiazki")` finds "Książki", and the `ł`→`l` and case folds work;
      - the result carries the ancestor path and the total match count.
    - `useCategories.test.ts`: snake_case fixtures, and `staleTime` is 5 minutes, so there is no refetch on remount.
    - Use explicit `vitest` imports.
  - [x] 9.2 `api/categories.ts`: `Category` is snake_case `{id, name, description, parent_id, sort_order, product_count, created_at, updated_at}`, and `CreateCategoryRequest.parent_id?: string | null`.
  - [x] 9.3 Create the pure `utils/categoryTree.ts` with the index builder, `isLeaf`, `categoryPathNames`, `formatCategoryPath` and `searchCategories`.
    - The search folds with `toLocaleLowerCase("pl")`, NFD with combining marks stripped, and `ł`→`l`.
    - It returns the nodes and the total count; the picker applies the 50-result cap.
  - [x] 9.4 `hooks/useCategories.ts`: `staleTime: 5 * 60_000`. Mutations still invalidate the `categories` prefix.
  - [x] 9.5 Run only `npx vitest run src/test/categoryTree.test.ts src/test/useCategories.test.ts`.

**Acceptance Criteria:**
- The 6 tests pass.
- Type errors in other `Category` consumers are expected until Groups 13 and 15.

### Task Group 10: Shared CategoryTreePicker
**Dependencies:** 9
**Files to Modify:** src/frontend/src/components/shared/CategoryTreePicker.tsx, src/frontend/src/components/shared/ModalSheet.tsx, src/frontend/src/test/CategoryTreePicker.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/wyb-r-kategorii-przegl-danie.html
  element: screen:wybor-kategorii-przegladanie
  locator: the sheet, lines 286–300 (sheet head, search, "‹ Wstecz", breadcrumb nav, rows)
  acceptance: the sheet title is "Wybierz kategorię" with a ✕; the search placeholder reads "Szukaj kategorii, np. „buty”"; "‹ Wstecz" sits above the breadcrumb "Wszystkie › Kobiety › **Ubrania**" (current level bold); rows with children show "›" and only drill; a leaf row selects
- mockup: analysis/design-context/mockups/wyb-r-kategorii-szukaj.html
  element: screen:wybor-kategorii-szukaj
  locator: the sheet, lines 286–297 (combobox, count, results listbox)
  acceptance: the combobox has `aria-expanded`, plus `aria-controls` only while results show, and `aria-activedescendant`; a polite live count "N wyników"; each result shows the small path "Kobiety › Ubrania › Sukienki ›" above the name, with the matched part highlighted; a non-leaf result shows "›" and drills (leaf mode)
- mockup: analysis/design-context/mockups/wyb-r-kategorii-szukaj.html
  element: component:category-tree-picker
  locator: the whole picker: the trigger at lines 273–276 and the sheet at lines 286–297
  acceptance: one shared component with search plus drill-down; `leaf` mode by default, and `any` mode selects any node; the trigger placeholder is "Wybierz kategorię ›"
- mockup: analysis/design-context/mockups/dodaj-rzecz-wybrana-kategoria.html
  element: screen:dodaj-rzecz-wybrana-kategoria
  locator: the Kategoria trigger, lines 273–276
  acceptance: the trigger shows the ancestor path "Kobiety › Ubrania › Sukienki ›" in small text above the bold leaf "Sukienki midi", with a "›" chevron at the right; it is a `<button type="button">` (not a div role=button, a deliberate spec deviation)
- mockup: analysis/design-context/mockups/admin-formularz-kategorii.html
  element: screen:admin-formularz-kategorii
  locator: the parent picker trigger, line 270
  acceptance: `any` mode shows the selected node (an inner node is allowed) as path + name; it offers "Wybierz „{current}”" and "Kategoria główna (brak)"
**Estimated Steps:** 8

- [x] 10.0 Complete picker component
  - [x] 10.1 Write 8 tests in `CategoryTreePicker.test.tsx` (`createQueryWrapper()`, mocked `api/categories`):
    1. drill-down, breadcrumb jumps and "‹ Wstecz";
    2. search shows rows with paths, the "ksiazki" diacritic match, and the "Pokazano 50 z N — zawęź wyszukiwanie" hint above 50 results;
    3. a non-leaf result drills in `leaf` mode and selects in `any` mode;
    4. ArrowDown + Enter selects, and `aria-activedescendant` updates;
    5. Esc with results open clears the search and does not close the sheet;
    6. after a selection, focus returns to the trigger;
    7. inside `<form onSubmit={spy}>`, neither the ✕ nor Enter in the search submits;
    8. a scrim click closes the sheet without reopening it, and does not submit.
  - [x] 10.2 `ModalSheet.tsx`: add `type="button"` to the ✕ (one attribute; the other callers are unaffected).
  - [x] 10.3 Trigger:
    - a `<button type="button">` with props `labelledBy`, `aria-invalid`, `aria-describedby`, `disabled`, `value`, `onChange` and `mode`;
    - it shows the placeholder or the path + bold leaf;
    - it calls `useCategories` exactly once and passes the index to the sheet as props.
  - [x] 10.4 Sheet:
    - `createPortal(<ModalSheet title="Wybierz kategorię" …/>, document.body)`;
    - `stopPropagation()` on sheet `onClick`/`onKeyDown` handlers where a host handler must not see the event.
  - [x] 10.5 Search combobox, following the `LocationAddForm.tsx` pattern:
    - ArrowUp/Down, and Enter always `preventDefault()` (it selects or drills the active option);
    - Esc clears the search with `preventDefault` + `stopPropagation`;
    - `aria-controls` only while results are shown; a live count; at most 50 rows plus the hint.
  - [x] 10.6 Drill-down:
    - breadcrumb "Wszystkie › …" with clickable ancestors, "‹ Wstecz", and row buttons;
    - "›" on non-leaves;
    - the sheet reopens at the selected node's parent level.
  - [x] 10.7 Modes:
    - `leaf`: selecting closes the sheet.
    - `any`: "Wybierz „{current}”" and the optional "Kategoria główna (brak)" (clears to root); a non-leaf search result selects.
    - Every picker button is `type="button"`.
  - [x] 10.8 Run only `npx vitest run src/test/CategoryTreePicker.test.tsx`.

**Acceptance Criteria:**
- The 8 tests pass.
- The picker never submits a host form.
- The implementation matches every `acceptance` above.

### Task Group 11: Frontend Add Item — Kategoria Picker + Oddam / Zamienię / Wersja robocza
**Dependencies:** 10
**Files to Modify:** src/frontend/src/api/inventories.ts, src/frontend/src/api/items.ts, src/frontend/src/components/shared/ItemQuickAddForm.tsx, src/frontend/src/utils/itemQuickAdd.ts, src/frontend/src/hooks/useCreateItem.ts, src/frontend/src/pages/product/ItemCreatePage.tsx, src/frontend/src/test/ItemCreatePage.test.tsx, src/frontend/src/test/ItemQuickAddForm.test.tsx, src/frontend/src/test/ItemQuickAddFormCategory.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/dodaj-rzecz.html
  element: screen:dodaj-rzecz
  locator: the form card, lines 269–284
  acceptance: field order Nazwa, Stan, "Kategoria *" (required marker `aria-hidden`), Zdjęcia (0/5); an empty trigger "Wybierz kategorię ›"; no "Typ" select; no "…ustawisz na liście „Moje rzeczy”" sentence; all three buttons disabled
- mockup: analysis/design-context/mockups/dodaj-rzecz.html
  element: component:item-submit-actions
  locator: the `.actions` block, lines 279–283
  acceptance: a 2-column grid with Oddam (primary, mint) and Zamienię (secondary, teal-soft) side by side and Wersja robocza (outline) full width below; all are `type="button"`; labels from `EXCHANGE_MODE_LABELS`; disabled until the name is non-blank and a category is chosen, and while busy
- mockup: analysis/design-context/mockups/dodaj-rzecz-wybrana-kategoria.html
  element: screen:dodaj-rzecz-wybrana-kategoria
  locator: lines 270–283 (form with the chosen leaf and enabled buttons)
  acceptance: with a name and a leaf chosen, the trigger shows path + leaf, and all three buttons are enabled
- mockup: analysis/design-context/mockups/dodaj-rzecz-limit-oddam.html
  element: screen:dodaj-rzecz-limit-oddam
  locator: the alert, line 278, above the actions
  acceptance: the danger-soft `role="alert"` box shows the backend text verbatim ("Możesz mieć maksymalnie 10 rzeczy do oddania. Wybierz „Zamienię” albo zapisz wersję roboczą."); the name, Stan, category and photos stay filled; the buttons are enabled again
**Estimated Steps:** 7

- [x] 11.0 Complete add-item UI
  - [x] 11.1 Write 7 tests:
    - `ItemCreatePage.test.tsx` (rewrite):
      - the three buttons are disabled until a name and a category are set;
      - Oddam/Zamienię/Wersja robocza send `listing_mode` GIFT/SWAP/null to `registerInventoryItem`;
      - a gift-limit 409 is shown verbatim in `role="alert"` and the data is kept;
      - Enter in the name input sends no request.
    - `ItemQuickAddForm*.test.tsx`:
      - Kategoria is a required picker, labelled by `aria-labelledby` and not inside a `<label>`;
      - there is no default category.
  - [x] 11.2 Types: `listing_status: "DRAFT" | "ACTIVE"` on `api/items.ts` `ItemDetailsResponse` and on `api/inventories.ts` `InventoryItemResponse`/`MyInventoryItemResponse`; `listing_mode?: ListingMode | null` on `CreateInventoryItemRequest`.
  - [x] 11.3 `utils/itemQuickAdd.ts`: the default `category_id` is `""`.
  - [x] 11.4 `ItemQuickAddForm.tsx`: the Kategoria field is a `<div>` with a label `<span id>` and a `CategoryTreePicker` in leaf mode (not the label-wrapping `Field`).
  - [x] 11.5 `useCreateItem(value, photos, mode)` passes `listing_mode`, then uploads the photos as today.
  - [x] 11.6 `ItemCreatePage.tsx`:
    - `onSubmit={(e) => e.preventDefault()}`;
    - remove the `categories[0]` default and the "Moje rzeczy" sentence;
    - three `type="button"` buttons in the mockup grid, with the disabled rules;
    - errors shown verbatim through `extractProblemMessage`.
  - [x] 11.7 Run only the 3 test files above.

**Acceptance Criteria:**
- The 7 tests pass.
- The page matches every `acceptance` above.

### Task Group 12: Frontend Item Edit & Moje rzeczy
**Dependencies:** 10, 11
**Files to Modify:** src/frontend/src/pages/product/ItemFieldEditors.tsx, src/frontend/src/pages/product/ItemEditPage.tsx, src/frontend/src/pages/product/ItemGalleryEditor.tsx, src/frontend/src/pages/items/MyItemsView.tsx, src/frontend/src/app/AppDataContext.tsx, src/frontend/src/test/ItemDetailPage.test.tsx, src/frontend/src/test/MyItemsViewCategory.test.tsx, src/frontend/src/test/useItemDetail.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/edycja-rzeczy-kategoria.html
  element: screen:edycja-rzeczy-kategoria
  locator: the item row and form, lines 268–276
  acceptance: a thumbnail, the item name heading, and a status chip next to it ("Wersja robocza" for DRAFT, "Aktywna" for ACTIVE); the form has Nazwa, a "Kategoria" picker trigger with path + bold leaf, and Zapisz (primary) / Anuluj (ghost) side by side; no "Rzecz zdjęta z terminów…" notice
**Estimated Steps:** 7

- [x] 12.0 Complete item edit UI
  - [x] 12.1 Write 5 tests:
    - `NameCategoryEditor` shows a "Kategoria" picker and save runs resolve → re-point;
    - the status chip shows the DRAFT/ACTIVE labels;
    - the moderation notice is absent;
    - the gallery hint no longer has "Nowe zdjęcie zdejmuje…" (`ItemDetailPage.test.tsx` ~L690);
    - `MyItemsView` mode toggles are enabled while photos are pending, and the "Zdjęcia w moderacji" pill is kept.
  - [x] 12.2 `ItemFieldEditors.tsx` `NameCategoryEditor`: replace `<select aria-label="Typ rzeczy">` with a leaf-mode picker labelled "Kategoria" through a `<span id>`. Do not attach the editor's Enter/Escape `onKeyDown` to the trigger.
  - [x] 12.3 `ItemEditPage.tsx`: add the status chip next to the heading and remove the moderation notice.
  - [x] 12.4 `ItemGalleryEditor.tsx` (~L175–178): drop the false sentence and keep "Inni zobaczą je po sprawdzeniu".
  - [x] 12.5 `MyItemsView.tsx`:
    - remove the `photos_moderation_pending` disabling, the "Tryb włączysz po zatwierdzeniu zdjęć" hint and its `aria-describedby`;
    - update the 409 comment in `AppDataContext.tsx` (the polling stays).
  - [x] 12.6 Add `listing_status` to the fixtures in `useItemDetail.test.tsx`. `ItemDetailPage` keeps the leaf `category_name`.
  - [x] 12.7 Run only the 3 test files above.

**Acceptance Criteria:**
- The 5 tests pass.
- The screens match the `acceptance` above.

### Task Group 13: Frontend Admin Category Tree & Product Forms
**Dependencies:** 10
**Files to Modify:** src/frontend/src/pages/admin/CategoryListPage.tsx, src/frontend/src/pages/admin/CategoryFormPage.tsx, src/frontend/src/pages/admin/ProductFormPage.tsx, src/frontend/src/pages/admin/ProductListPage.tsx, src/frontend/src/pages/admin/ProductDetailPage.tsx, src/frontend/src/test/CategoryListPage.test.tsx, src/frontend/src/test/CategoryFormPage.test.tsx, src/frontend/src/test/ProductFormPageCategory.test.tsx, src/frontend/src/test/ProductCategoryDisplayByCategoriesHook.test.tsx, src/frontend/src/test/pages.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/admin-drzewo-kategorii.html
  element: screen:admin-drzewo-kategorii
  locator: the admin block, lines 266–280 (head, alert, filter, tree)
  acceptance: an "Kategorie" heading with a "+ Nowa kategoria główna" primary button; a top `role="alert"` with the backend 409 text; a "Filtruj po nazwie…" input; indented rows with a ▾/▸ disclosure (`aria-expanded`), the name, a meta line ("N podkategorii" via `Intl.PluralRules("pl")` or "N rzeczy"), and actions ↑ ↓ "+ Podkategoria" Edytuj Usuń; "+ Podkategoria"/Usuń are disabled with the title "Kategoria ma przypisane rzeczy" on a leaf with products. Uses nested lists with disclosure buttons, not `role="tree"` (spec deviation)
- mockup: analysis/design-context/mockups/admin-formularz-kategorii.html
  element: screen:admin-formularz-kategorii
  locator: the form grid, lines 268–274
  acceptance: the heading reads "Nowa podkategoria" (with `?parent`); field order Kategoria nadrzędna (any-mode picker, hint "Puste = kategoria główna. Nie można zmienić po utworzeniu."), Nazwa, Opis (opcjonalnie); Zapisz/Anuluj; the label is a `<span id>` referenced by `aria-labelledby`; edit mode shows the parent path read-only; a 409 is shown inline
**Estimated Steps:** 6

- [x] 13.0 Complete admin category UI
  - [x] 13.1 Write 8 tests:
    - the tree renders nested rows with disclosure `aria-expanded` and Polish plural meta;
    - ↑/↓ call `move` for a sibling;
    - a 409 on delete is shown in the top alert;
    - the actions are disabled with the title on a node with products;
    - the filter expands the branches that contain matches;
    - `CategoryFormPage` with `?parent=` preselects the parent and posts `parent_id`, and an empty value posts null (root);
    - edit mode shows the read-only parent path;
    - `ProductFormPage` uses the leaf picker, and the `ProductListPage` filter lists leaves only by full path (in `pages.test.tsx`).
  - [x] 13.2 `CategoryListPage.tsx`:
    - an expandable tree built from `categoryTree.ts`, with disclosure buttons and the meta line;
    - ↑ ↓ "+ Podkategoria" (link `/admin/categories/new?parent={id}`) Edytuj Usuń;
    - the top alert, the filter that auto-expands matches, and "+ Nowa kategoria główna".
  - [x] 13.3 `CategoryFormPage.tsx`: create mode reads `?parent=`, uses the any-mode picker and the hint; edit mode shows the parent path read-only; 409 inline; `<span id>` label.
  - [x] 13.4 `ProductFormPage.tsx`: a leaf-mode picker instead of the select, with a `<span id>` label.
  - [x] 13.5 `ProductListPage.tsx`: the filter `<select>` lists leaves only, labelled and sorted by full path; the category column shows full paths. `ProductDetailPage.tsx` shows the full path. Update `ProductCategoryDisplayByCategoriesHook.test.tsx` and `ProductFormPageCategory.test.tsx` to snake_case fixtures.
  - [x] 13.6 Run only the 5 test files above.

**Acceptance Criteria:**
- The 8 tests pass.
- The admin forms are never submitted by the picker.
- The pages match the `acceptance` above.

### Task Group 14: Frontend Needed Items as Plain Names
**Dependencies:** None (contract: spec FR-17)
**Files to Modify:** src/frontend/src/components/shared/NeededItemQuickAddForm.tsx, src/frontend/src/components/panel/EditTermDialog.tsx, src/frontend/src/utils/neededItemQuickAdd.ts, src/frontend/src/app/AppDataContext.tsx, src/frontend/src/pages/term/views/PublicTermView.tsx, src/frontend/src/pages/organizer/blocks/NeededItemsBlock.tsx, src/frontend/src/pages/meetings/MeetingsView.tsx, src/frontend/src/api/terms.ts, src/frontend/src/api/groups.ts, src/frontend/src/api/pledges.ts, src/frontend/src/test/NeededItemQuickAddForm.test.tsx, src/frontend/src/test/EditTermDialog.test.tsx, src/frontend/src/test/AppDataContextNeededItems.test.tsx
**Visual References:**
- mockup: analysis/design-context/mockups/rzeczy-potrzebne-na-termin.html
  element: screen:rzeczy-potrzebne-na-termin
  locator: the "Potrzebne rzeczy" card, lines 270–278
  acceptance: the "Potrzebne rzeczy" label above a list of plain names, each with a danger "Usuń"; an add row with an input (placeholder "np. Termos") and a primary "Dodaj"; no category field or select anywhere
**Estimated Steps:** 7

- [x] 14.0 Complete needed-items UI
  - [x] 14.1 Write 6 tests:
    - `NeededItemQuickAddForm` has no category field and adds by name;
    - `EditTermDialog` lists names, creates `{term_id, name, description}` without `resolveProduct`, and detects edits by `name`;
    - in a new `src/test/AppDataContextNeededItems.test.tsx` (not the blocked `AppPage.test.tsx`), `handleAddTerm`:
      - continues past a failed needed item;
      - closes the modal;
      - shows one toast "Termin dodany, ale nie dodano rzeczy: {names} — {first message}".
  - [x] 14.2 `utils/neededItemQuickAdd.ts`: drop `category_id` and the `categoryId` parameter. `addDraftNeededItem` (~L536) and the `draftNeededItem` initialisation call it without arguments.
  - [x] 14.3 `NeededItemQuickAddForm.tsx` and `EditTermDialog.tsx`: drop the category field, `resolveProduct` and `makeEmptyDraft(categories)`, and send `name`/`description`.
  - [x] 14.4 `AppDataContext.tsx`:
    - in `handleAddTerm`, remove the resolve loop, use continue-and-collect, and show a single toast; `addTermError` covers only a `createTerm` failure;
    - display sites L803/L1030 use `name`;
    - remove the `categories` export only if no consumer remains. Grep the uncommitted `AppPage.tsx`/`AddView.tsx` too, without editing them.
  - [x] 14.5 `api/terms.ts`, `api/groups.ts` (`PublicNeededItemResponse`, `OrganizerNeededItem`) and `api/pledges.ts` (`MyPledgeResponse.item_name`).
  - [x] 14.6 `PublicTermView.tsx` and `NeededItemsBlock.tsx` → `name`; `MeetingsView.tsx` → `item_name`.
  - [x] 14.7 Run only the 3 test files above.

**Acceptance Criteria:**
- The 6 tests pass.
- The needed list matches the `acceptance` above.

### Task Group 15: Frontend Test Fixture & Type Alignment
**Dependencies:** 9, 11, 12, 13, 14
**Files to Modify:** src/frontend/src/test/TermPage.test.tsx, src/frontend/src/test/termViewModel.test.ts, src/frontend/src/test/organizerBlocks.test.tsx, src/frontend/src/test/organizerCirclesExchangeBlocks.test.tsx, src/frontend/src/test/organizerDirectorySupport.test.tsx, src/frontend/src/test/organizerMediaBlocks.test.tsx, src/frontend/src/test/OrganizerEditor.test.tsx, src/frontend/src/test/OrganizerTermsPage.test.tsx, src/frontend/src/test/PublicOrganizationPage.test.tsx, src/frontend/src/test/LayoutRenderer.test.tsx, src/frontend/src/test/useOrganizerPage.test.tsx, src/frontend/src/test/pages.test.tsx, src/frontend/src/test/extension-points.test.tsx, src/frontend/src/test/OrganizerItemRoute.test.tsx, src/frontend/src/test/OrganizerPhotosTab.test.tsx
**Estimated Steps:** 5

- [x] 15.0 Complete frontend fixture alignment
  - [x] 15.1 Red baseline: no new tests. Run `npx tsc -p tsconfig.app.json --noEmit` and the listed files, and record the errors. Exclude `AppPage.test.tsx`, which is blocked until Group 17.
  - [x] 15.2 Change the needed-item and pledge DTO fixtures to `name`/`item_name` in the term/organizer test files.
  - [x] 15.3 Change the `Category` fixtures to snake_case with `parent_id` in `pages.test.tsx`, `extension-points.test.tsx`, `OrganizerItemRoute.test.tsx` and `OrganizerPhotosTab.test.tsx`.
  - [x] 15.4 Grep `src/` (excluding the 6 uncommitted files) for leftovers: the needed-item `product_name`, camelCase Category fields (`sortOrder`, `productCount`), `PHOTOS_IN_MODERATION` and "Typ rzeczy". Fix any hits within this group's files.
  - [x] 15.5 Run `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint` and `npm test`.

**Acceptance Criteria:**
- The listed files pass.
- tsc, lint and Vitest report failures only in `src/test/AppPage.test.tsx` (the exact list is recorded in the work-log), which is explicitly expected until Group 17.

### Task Group 16: Test Review & Gap Analysis
**Dependencies:** All previous groups (1–15)
**Files to Modify:** src/backend/tests/test_*.py, src/frontend/src/test/*.test.ts, src/frontend/src/test/*.test.tsx (append only)
**Estimated Steps:** 4

- [x] 16.0 Review and fill critical gaps
  - [x] 16.1 Review the tests from Groups 1–14 (about 84).
  - [x] 16.2 Analyze gaps for this feature only. Candidates:
    - a full `alembic downgrade 0063` → `upgrade head` chain;
    - the listing invariant (ACTIVE ⇔ pref) across a register → set → clear → confirm sequence;
    - Enter or ✕ in the picker inside the admin `CategoryFormPage`/`ProductFormPage` forms;
    - `ItemDetailPage` still shows the leaf `category_name`;
    - a leaf-mode non-leaf search result drills in `ItemCreatePage`.
  - [x] 16.3 Write up to 10 additional strategic tests.
  - [x] 16.4 Run only the feature-specific tests (about 84–94). Never print secrets.

**Acceptance Criteria:**
- All feature tests pass, apart from the known `AppPage.test.tsx` exclusion.
- No more than 10 tests are added.

### Task Group 17: Deferred Until User Commits (BLOCKED)
**Dependencies:** 16, plus an external precondition: the user has committed `AddView.tsx`, `router.tsx`, `appHelpers.ts`, `AppPage.tsx`, `AppPage.test.tsx` and `EventCreateView.tsx`
**Files to Modify:** src/frontend/src/test/AppPage.test.tsx, src/frontend/src/utils/appHelpers.ts
**Estimated Steps:** 4

- [x] 17.0 Complete deferred follow-ups
  - [x] 17.1 Precondition: `git status --short` shows none of the 6 files as modified or untracked. If any of them is, stop. The group stays blocked; do not edit or stash the user's files.
  - [x] 17.2 Update `AppPage.test.tsx`:
    - change the camelCase `Category` mocks to `{id, name, description, parent_id, sort_order, product_count, created_at, updated_at}`;
    - replace the needed-item `resolveProduct` flow assertions with name-only `createNeededItem({term_id, name, description})`, and assert that `resolveProduct` is never called.
  - [x] 17.3 Update `utils/appHelpers.ts`:
    - change the `MAX_GIFT_ITEMS` comment "Enforced only in the UI." to state that the backend also enforces it (409);
    - align `GIFT_LIMIT_MESSAGE` with the backend PUT text "Możesz mieć maksymalnie 10 rzeczy do oddania. Zdejmij „Oddam” z innej rzeczy.";
    - grep its consumers (`AppDataContext.tsx`, `MyItemsView.tsx`) and the tests that assert the old text, and update those tests.
  - [x] 17.4 Run `npx vitest run src/test/AppPage.test.tsx` plus any updated tests, then `npx tsc -p tsconfig.app.json --noEmit` and `npm test`.

**Acceptance Criteria:**
- `AppPage.test.tsx` passes, and tsc and the full Vitest run are clean with no exclusions.

## Execution Order

1. Group 1: Vinted Category Fixture (6 steps, ends at the USER REVIEW checkpoint)
2. Group 2: Migrations 0064–0068 + ORM (8 steps, no dependencies)
3. Group 3: Seed Migration 0069 + leaf helper (8 steps, depends on 1, 2)
4. Group 4: Category Tree API & Leaf-Only Products (10 steps, depends on 3)
5. Group 5: Listing Status, Register-with-Mode & Gift Limit (10 steps, depends on 3)
6. Group 6: Moderation Gate Removal & Dead Code (8 steps, depends on 5)
7. Group 7: Backend Needed Items as Plain Names (8 steps, depends on 2, 3)
8. Group 8: Backend Test-Suite Leaf-Category Alignment (4 steps, depends on 3, 4, 5, 6, 7)
9. Group 9: Frontend Category Data & Tree Utilities (5 steps, no dependencies)
10. Group 10: Shared CategoryTreePicker (8 steps, depends on 9)
11. Group 11: Add Item — Picker + 3 Buttons (7 steps, depends on 10)
12. Group 12: Item Edit & Moje rzeczy (7 steps, depends on 10, 11)
13. Group 13: Admin Category Tree & Product Forms (6 steps, depends on 10)
14. Group 14: Frontend Needed Items as Plain Names (7 steps, no dependencies)
15. Group 15: Frontend Test Fixture & Type Alignment (5 steps, depends on 9, 11, 12, 13, 14)
16. Group 16: Test Review & Gap Analysis (4 steps, depends on 1–15)
17. Group 17: Deferred Until User Commits (4 steps, depends on 16 + the user's commit; BLOCKED)

## Standards Compliance

Follow the standards in `.maister/docs/standards/`:
- `global/`: validation (required field, buttons disabled while invalid, inline `role="alert"`), error-handling (typed Polish 404/409), minimal-implementation (dead code deleted, no speculative enum members, no new endpoints), conventions and commenting.
- `backend/`:
  - models.md: `_enum_column`, business-key `__eq__`/`__hash__`, no new `relationship()`, bridges for cross-module access;
  - migrations.md: separate schema and data revisions, named constraints, partial unique index, reverse-order downgrades, a round-trip pytest per revision, and the acknowledged NOT NULL deviation;
  - queries.md: a single aggregated category list, a single COUNT, no N+1;
  - api.md;
  - security.md: the authorization matrix is unchanged.
- `frontend/`:
  - components.md: a single-responsibility picker;
  - accessibility.md: ModalSheet trapFocus/Esc/focus return, combobox Esc rules, disclosure buttons, `sr-only` spacing;
  - data-fetching.md: one `useCategories` subscriber per field, server messages verbatim;
  - css.md and responsive.md.
- `testing/`:
  - backend-testing.md: testcontainers, `client`, exact key sets, `test_<operation>_<scenario>_<expected>`, flat `tests/`;
  - frontend-testing.md: explicit `vitest` imports, `createQueryWrapper()`, `vi.mock` + `vi.resetAllMocks()`, `it.each` tables.

## Notes

- Test-Driven: each group starts with its focused tests (2–8; the alignment groups start from a red baseline).
- Run Incrementally: run only the tests of the current group. The full suites run in Groups 15, 16 and 17 and in the verification phase.
- Mark Progress: check off the steps as they are completed.
- Reuse First: `ModalSheet`/`trapFocus`/`openSheets`, the `LocationAddForm` combobox pattern, `EXCHANGE_MODE_LABELS`, `useCategories`, `extractProblemMessage`, the `on_product_changed` injection pattern, `_enum_column`, and the `0025` legacy insert pattern.
- Never edit the user's uncommitted files (`AddView.tsx`, `router.tsx`, `appHelpers.ts`, `AppPage.tsx`, `AppPage.test.tsx`, `EventCreateView.tsx`) outside Group 17.
- Secrets: never print secret values. Check configuration by presence only.
