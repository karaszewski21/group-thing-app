# Implementation Plan: Item detail page `/product/:id`

## Overview
Total Steps: 60 (Group 3 revised to 7 steps; rework steps 5.8 and 6.9 added)
Task Groups: 8
Expected Tests: 43-53 (43 new/updated tests planned across Groups 1-7: 3+8+8+7+5+8+4, plus up to 10 gap tests in Group 8; obsolete panel tests are deleted)

Spec: `implementation/spec.md` (16 core requirements). Design context (binding): `analysis/design-context/INDEX.md` (14 IDs), `analysis/design-context/ascii/ui-mockups.md`. Coverage matrix: `implementation/visual-coverage.md`.

Paths are relative to the repo root `C:\Users\karas\Desktop\group-thing-app`. Backend commands run in `src/backend`, frontend commands in `src/frontend`.

### Ground rules for every group
- Circulation never imports `app.groups` (or `app.users` models). Cross-module reads use Core `table(...)`/`column(...)` references, typed, with a docstring naming the exception (precedent: `_item_listing_preferences`).
- Notifications are staged through `notifications_bridge.create_notification` before the caller's single `db.commit()`.
- Pre-production: no backward-compat shims, no link backfill.
- Frontend ids are UUID strings. Never `Number()` an id.
- All user-facing copy is Polish and matches the spec/mockups character for character.
- Uncommitted pre-existing working-tree changes (e.g. `.playwright-mcp/*`) belong to the user. Do not revert, stage or reformat them.
- Backend test naming follows the repo's convention: `test_actionName_condition_expectedResult` (e.g. `test_addItemPhoto_eleventhPhoto_returns409`).
- Each group runs ONLY its own new/updated tests. The full gates run in Group 8.

### Parallel waves (file sets are disjoint inside each wave)
| Wave | Groups | Why safe |
|------|--------|----------|
| 1 | 1 (DB), 4 (notifications/slugs), 5 (frontend api/hooks + tsc baseline) | No shared files |
| 2 | 2 (circulation read), 6 (item page), 7 (entry points + panel cleanup) | 2 is backend-only; 6 and 7 share no file (router.tsx/pages/product/ItemDetailPage test vs panel/krag files/panel tests) |
| 3 | 3 (backend product module: photos + description endpoints + matrix), plus the frontend rework steps 5.8 and 6.9 | 3 touches `app/product/*`, `circulation/schemas.py` (one import swap) and the matrix; 5.8/6.9 are frontend-only and run after 3's API contract is fixed (they only need the contract, not a running backend) |
| 4 | 8 (test review + final gates) | After everything |

---

## Implementation Steps

### Task Group 1: Database Layer (ProductPhoto + migration 0045)
**Dependencies:** None
**Files to Modify:** `src/backend/alembic/versions/0045_product_photos.py` (new), `src/backend/app/product/models.py`, `src/backend/tests/test_product_photo_model.py` (new)

> **Redone (user decision during implementation):** gallery photos belong to the catalog PRODUCT, not to the inventory item. They are shared by every item of that product, like the description. The redo is complete: `ProductPhoto` is in `app/product/models.py`, `0045_product_photos.py` exists, the local DB is at 0045, and the old `inventory_item_photos` / `InventoryItemPhoto` artifacts are gone.
**Estimated Steps:** 5

- [x] 1.0 Complete the photo storage layer
  - [x] 1.1 Write 3 focused tests in `tests/test_product_photo_model.py`
    - `test_insertProductPhoto_validRow_persistsWithUuidIdAndTimestamps` (insert via `db_session`, flush, id is UUID, `created_at`/`updated_at` set)
    - `test_insertProductPhoto_duplicateProductAndUrl_raisesIntegrityError` (violates `uq_product_photos_product_id_url`)
    - `test_productPhotoEquality_sameProductAndUrl_equalAndSameHash` (business-key `__eq__`/`__hash__` on `(product_id, url)`, not on `id`)
    - Reuse the `_create_product` shape (and the category it needs) from `tests/test_circulation_ledger.py`; copy the minimal helper into the file if it is private
  - [x] 1.2 Add `ProductPhoto(BaseEntity)` to `app/product/models.py`
    - `__tablename__ = "product_photos"`; `product_id: Mapped[uuid.UUID]` FK `products.id` named `fk_product_photos_product_id_products` (no cascade, no `relationship()`); `url: Mapped[str] = mapped_column(String(500))`; `sort_order: Mapped[int] = mapped_column(Integer)`
    - `__table_args__ = (UniqueConstraint("product_id", "url", name="uq_product_photos_product_id_url"),)`
    - `__eq__`/`__hash__` on `(product_id, url)` per `standards/backend/models.md`; the docstring says the photos are shared by every item of the product
  - [x] 1.3 Write `alembic/versions/0045_product_photos.py` (`down_revision` = the 0044 revision id; read it from `0044_user_profiles_birth_year.py`)
    - Columns: `id` UUID PK `server_default=sa.text("gen_random_uuid()")` named `pk_product_photos`; `product_id` UUID NOT NULL FK `fk_product_photos_product_id_products` → `products.id`; `url` String(500) NOT NULL; `sort_order` Integer NOT NULL; `created_at`/`updated_at` TIMESTAMP NOT NULL (mirror 0042's BaseEntity column definitions exactly)
    - `uq_product_photos_product_id_url` UNIQUE `(product_id, url)`; no extra index; no CHECK constraints (limits live in the application layer)
    - `downgrade()` drops the table; schema only
    - Compare against `alembic revision --autogenerate` output mentally: model and migration must not drift
  - [x] 1.4 Apply and verify reversibility locally: in `src/backend`, `set -a; . ./.env; set +a; uv run alembic upgrade head`, then `uv run alembic downgrade -1`, then `uv run alembic upgrade head` again. The local DB must end at 0045
  - [x] 1.5 Ensure the group's tests pass: `uv run pytest tests/test_product_photo_model.py` (the test container runs `alembic upgrade head`, so this also proves the migration applies on a clean DB)

**Acceptance Criteria:**
- The 3 tests pass
- Local DB is at revision 0045; downgrade/upgrade round trip succeeds
- `uv run ruff check app/product/models.py alembic/versions/0045_product_photos.py` clean
- No `inventory_item_photos` / `InventoryItemPhoto` leftovers in `src/backend` (grep)

---

### Task Group 2: Backend Circulation Read (details, status, history)
**Dependencies:** 1
**Files to Modify:** (photos are product-level: read through `app/product/service.py`; the `InventoryItemPhotoResponse` → `ProductPhotoResponse` move is done in Group 3, step 3.2) `src/backend/app/circulation/domain/item_privacy.py` (new), `src/backend/app/circulation/application/identity.py`, `src/backend/app/circulation/application/item_details.py` (new), `src/backend/app/circulation/application/movements.py`, `src/backend/app/circulation/infrastructure/repository.py`, `src/backend/app/circulation/service.py`, `src/backend/app/circulation/router.py`, `src/backend/app/circulation/schemas.py`, `src/backend/app/product/service.py`, `src/backend/tests/test_item_details.py` (new), `src/backend/tests/test_item_history.py` (new)
**Estimated Steps:** 9

- [x] 2.0 Complete the read side (`GET …/details`, `GET …/history`)
  - [x] 2.1 Write 8 focused integration tests (httpx `AsyncClient`, real Postgres)
    - `tests/test_item_details.py`:
      1. `test_getItemDetails_ownerAndNonOwner_returnsFieldsPhotosAndIsOwnerFlag` (name, category_id, category_name, condition, description from `plugin_data["ai-description"]["description"]`, photos sorted by `sort_order` (seed `ProductPhoto` rows for the item's `product_id` directly), `product_photo_url`, `is_owner` true for owner / false for another user)
      2. `test_getItemDetails_pluginDescriptionMissingOrBlank_fallsBackToProductDescription`
      3. `test_getItemDetails_deletedOrMissingItem_returns200DeletedOr404` (deleted → 200, `deleted_at` set, `status.code == "DELETED"`; random UUID → 404)
      4. `test_getItemDetails_afterTake_reservedStatusWithTermDateAndPerViewerLabel` (taker sees "Ty", owner sees taker's display name, third party sees "inna rodzina"; `term_occurs_on` equals the term's `occurs_on`). Reuse the term + listing + take setup from `tests/test_term_item_listings.py`
      5. `test_getItemDetails_offeredItemInPendingSwap_returnsProposedSwapThenInTransitAfterAccept` (`PROPOSED_SWAP` with null term date before accept; `IN_TRANSIT` after `accept_swap_proposal`)
      6. `test_getItemDetails_lentItem_returnsLentWithDueDateAndBorrowerLabel`
    - `tests/test_item_history.py`:
      7. `test_getItemHistory_registerLendReturn_newestFirstWithPrivacyLabelsAndNoIds` (order RETURN, LEND, REGISTER; labels for owner/borrower/third party; `term_occurs_on` set on LEND, null on REGISTER/RETURN; recursively assert no key ending in `_id`/`id`, no UUID string of any user/inventory/reservation/transaction anywhere in the JSON, and the raw `CirculationTransaction.description` text absent)
      8. `test_getItemHistory_swapDeletedMissingAndAnonymous_handledPerSpec` (swap: only this item's leg, `movement_type == "SWAP"`, `{from} → {to}` description, `term_occurs_on` set, the other item's product name absent from the payload; deleted item → 200 ending with REMOVE "Usunięta przez: Ty" for the owner; random UUID → 404; no token → 401)
  - [x] 2.2 `application/identity.py`: add `find_user_id_by_principal(db, principal) -> uuid.UUID | None`; make `get_user_id_by_principal` delegate to it and raise as today when `None`
  - [x] 2.3 `domain/item_privacy.py` (pure, no I/O)
    - `ItemStatusCode(StrEnum)`: `AVAILABLE, RESERVED, IN_TRANSIT, RETURNING, PROPOSED_SWAP, LENT, DELETED`
    - `OTHER_FAMILY_LABEL = "inna rodzina"`, `SELF_LABEL = "Ty"`
    - `label(subject, viewer, participants, display_name)` per spec rules 1-3 (viewer `None` never matches)
    - `history_description(movement_type, from_label, to_label)`: REGISTER → `Dodana przez: {to}`; REMOVE → `Usunięta przez: {from}`; GIFT/LEND/RETURN/SWAP → `{from} → {to}`
    - `history_term_occurs_on(movement_type, occurs_on)`: kept for GIFT/LEND/SWAP, `None` otherwise
    - `derive_status(...)` implementing "Current status derivation" steps 1-4 exactly (DELETED first; AVAILABLE/RETURNED → AVAILABLE; RESERVED/IN_TRANSIT → newest active reservation by `reserved_at`, RETURN → RETURNING with null term, SWAP with `paired_reservation_id is None` → PROPOSED_SWAP with null term, else balance code with term; no reservation → balance code, null term/label; LENT → due_date, subject = current inventory owner, participants {borrower, home owner})
  - [x] 2.4 `infrastructure/repository.py` reads (docstrings name the Core-reference exception)
    - (photos are not read here: they come from `product_service.list_product_photos`, see 2.5)
    - `get_item_details_row(item_id)`: one select of `InventoryItem` + `Product.name/category_id/photo_url/description/plugin_data` + `categories.name` (Core, typed `column("name", String)`, `column("id", postgresql.UUID(as_uuid=True))`); no `deleted_at` filter; template: `get_item_with_product_name`
    - `list_item_history_rows(item_id)`: ONE select — `CirculationEntry` (by `item_id`) → `CirculationTransaction` → LEFT `Account` → LEFT `Inventory` → LEFT `user_profiles` (Core, `account_user_id = inventories.owner_user_id`, typed `display_name`) → LEFT `Reservation` (entry's `reservation_id`) → LEFT `terms` (Core, typed `column("occurs_on", DateTime)`); only needed columns; `ORDER BY occurred_at DESC, CirculationTransaction.created_at DESC, CirculationTransaction.id DESC`. Template: `movements_for_item` in `tests/ledger_assertions.py` (reversed order)
    - `find_display_names(user_ids) -> dict[uuid, str]` and `find_term_occurs_on(term_id) -> datetime | None` (Core)
  - [x] 2.5 `product/service.py`: constants `SHARED_DESCRIPTION_PLUGIN_ID = "ai-description"`, `SHARED_DESCRIPTION_FIELD = "description"`; `get_shared_description(plugin_data, fallback) -> str | None` (non-blank string or `fallback`); `list_product_photos(db, product_id) -> list[ProductPhoto]` ordered by `sort_order`. Read helpers only; the writers come in Group 3
  - [x] 2.6 `application/item_details.py`: `get_item_details(db, item_id, principal)` — `repository.get_item_details_row` (404 when missing via `EntityNotFoundException`), photos via `product_service.list_product_photos(item.product_id)`, `find_user_id_by_principal`, `resolve_owning_inventory` for `is_owner` and home owner, `find_item_balance`, `list_active_reservations_for_item`, display names, `derive_status`, `get_shared_description(plugin_data, Product.description)`
  - [x] 2.7 `application/movements.py`: `get_item_history(db, item_id, principal)` — `repository.get_item` (404 only when the row is missing; deleted is fine), `list_item_history_rows`, group rows by transaction into −1 (from) and +1 (to) sides, EXTERNAL side = no owner, labels via `label()` with participants = {from_owner, to_owner}, description + term via the domain functions
  - [x] 2.8 `schemas.py`: `InventoryItemPhotoResponse {id, url, sort_order}` (superseded: Group 3 step 3.2 replaces it with `app.product.schemas.ProductPhotoResponse`), `ItemStatusResponse {code, term_occurs_on, due_date, counterparty_label}`, `ItemDetailsResponse` (fields per spec "Response models"), `ItemHistoryEntryResponse {occurred_at, movement_type, description, term_occurs_on}` (no ids). `service.py`: re-export `get_item_details`, `get_item_history`, `find_user_id_by_principal`. `router.py`: `GET /api/inventory-items/{item_id}/details` → `ItemDetailsResponse`, `GET /api/inventory-items/{item_id}/history` → `list[ItemHistoryEntryResponse]`, both `principal: ReadPrincipal`, `item_id: uuid.UUID` (malformed → 400 in the legacy envelope; the central validation handler never returns 422). Declare the two routes so they do not collide with existing `/{item_id}` routes (more specific paths, verify ordering)
  - [x] 2.9 Ensure tests pass: `uv run pytest tests/test_item_details.py tests/test_item_history.py` (run ONLY these); `uv run ruff check app/circulation app/product` and `uv run mypy app/circulation app/product` clean for the touched modules

**Acceptance Criteria:**
- The 8 tests pass
- History is a single SQL query (no per-entry query); details uses a bounded number of queries independent of photo/history size
- No user/inventory/reservation/transaction id and no `CirculationTransaction.description` in either payload
- `grep -rn "app.groups" src/backend/app/circulation` returns nothing new

---

### Task Group 3: Backend product module: photos + description endpoints + matrix
**Dependencies:** 1, 2
**Files to Modify:** `src/backend/app/product/router.py`, `src/backend/app/product/service.py`, `src/backend/app/product/schemas.py`, `src/backend/app/circulation/schemas.py` (photo response import swap only), `src/backend/app/core/authorization_matrix.py`, `src/backend/tests/test_product_photos.py` (new), `src/backend/tests/test_product_description.py` (new), `src/backend/tests/test_authorization_matrix.py`
**Estimated Steps:** 7

> **Revised (user decision during implementation):** the gallery and the description live in the PRODUCT module, as `/api/products/{product_id}/…` endpoints with the same EDIT authorization as the existing product endpoints. There is no item-owner check and no dependency from product to circulation. Circulation gets **no** photo or description mutations, **no** `lock_item`, **no** deleted-item re-check for photos, and **no** rename of `_require_item_owner` (it stays private with its 2 callers). If any of these were started, revert them. The item page shows the editors only to the item owner (`is_owner`) and calls the product endpoints with `item.product_id`.

- [x] 3.0 Complete the product photo and description endpoints
  - [x] 3.1 Write 8 focused tests
    - `tests/test_product_photos.py`:
      1. `test_addProductPhoto_validAndInvalidUrl_appendsSortOrderOr400` (201, `sort_order == count`; the photo is listed by `GET /api/products/{id}/photos` and appears in `/details` of two different items of that product owned by different users; `"ftp://x"` and blank → 400 (legacy envelope) with "Podaj poprawny link zaczynający się od http:// lub https://")
      2. `test_addProductPhoto_eleventhOrDuplicate_returns409WithPolishMessage` ("Osiągnięto limit 10 zdjęć"; "To zdjęcie jest już w galerii")
      3. `test_productPhotoRoutes_unknownProduct_return404` (GET, POST, DELETE and PUT order with a random product UUID)
      4. `test_removeProductPhoto_middlePhoto_renumbersRemainingDensely` (also: photo id of another product → 404)
      5. `test_reorderProductPhotos_permutationOrStaleList_reordersOr409` (valid permutation → 200 in the new order with `sort_order` = index; missing or extra id → 409 "Lista zdjęć jest nieaktualna — odśwież stronę")
    - `tests/test_product_description.py`:
      6. `test_updateProductDescription_mergesIntoAiDescriptionKeepsOtherKeysAndBlankRemoves` (no plugin registered; other plugin keys and other `ai-description` fields untouched; blank → key removed and empty `ai-description` dropped; `/details` of an item of that product then returns the saved value instead of the `Product.description` fallback; >2000 chars → 400; unknown product → 404)
      7. `test_productPhotoAndDescriptionMutations_tokenWithoutEdit_returns403` (`PATCH …/description` and `POST …/photos` with a READ-only token → 403 from the route dependency at runtime)
    - `tests/test_authorization_matrix.py`:
      8. `test_resolveRequirement_productPhotoAndDescriptionRoutes_resolveToEditOrRead` (PATCH `/api/products/{id}/description`, POST `/api/products/{id}/photos`, PUT `/api/products/{id}/photos/order`, DELETE `/api/products/{id}/photos/{pid}` → `("EDIT", "mcp:edit")`; GET `/api/products/{id}/photos` → READ via row 11)
  - [x] 3.2 `product/schemas.py`: `ProductPhotoResponse {id, url, sort_order}` (`from_attributes`), `AddProductPhotoRequest {url}` (trimmed, 1-500, reuse `_PHOTO_URL_PATTERN`, Polish message identical to the frontend copy, via `PydanticCustomError` like `_validate_photo_url`), `ReorderProductPhotosRequest {photo_ids: list[uuid.UUID]}`, `UpdateProductDescriptionRequest {description: str | None, max_length 2000}`, `ProductDescriptionResponse {description: str | None}`. In `circulation/schemas.py`, delete `InventoryItemPhotoResponse` and type `ItemDetailsResponse.photos` as `list[ProductPhotoResponse]` imported from `app.product.schemas` (the JSON shape is unchanged, so Group 2's tests still pass)
  - [x] 3.3 `product/service.py` photo writers (each commits, like the existing product service functions): `add_product_photo(db, product_id, url)`, `remove_product_photo(db, product_id, photo_id)`, `reorder_product_photos(db, product_id, photo_ids)`.
    - Each one first locks the **product row**: `select(Product).where(Product.id == product_id).with_for_update()`, raising the same 404 as `get_product` when it is missing. The row always exists, even with zero photos, so this serializes every photo change of the product: the limit, the duplicate check and the dense order stay correct.
    - Duplicate URL detected before insert → `BusinessConflictException("To zdjęcie jest już w galerii")`; count ≥ 10 → `BusinessConflictException("Osiągnięto limit 10 zdjęć")`.
    - Photo not of this product → 404.
    - Delete renumbers densely.
    - Reorder requires an exact permutation (set equality and equal length), else 409 "Lista zdjęć jest nieaktualna — odśwież stronę".
  - [x] 3.4 `product/service.py`: `set_shared_description(db, product_id, description) -> str | None`. It runs `get_product` (404), trims, turns blank into `None`, copies `plugin_data`, copies the `ai-description` sub-dict when it is a dict (else `{}`), sets or pops `"description"`, drops an empty `ai-description` key, reassigns a fresh dict (mirror `replace_plugin_data`) and commits. There is no plugin registration check. A `StaleDataError` on concurrent writes is surfaced as 409 by the existing handler
  - [x] 3.5 `product/router.py` on the existing `APIRouter(prefix="/api/products")`:
    - `GET /{product_id}/photos` → `list[ProductPhotoResponse]` (`principal: ReadPrincipal`);
    - `POST /{product_id}/photos` → 201;
    - `DELETE /{product_id}/photos/{photo_id}` → 204;
    - `PUT /{product_id}/photos/order` → 200 `list[ProductPhotoResponse]`;
    - `PATCH /{product_id}/description` → 200 `ProductDescriptionResponse`.

    The four mutations declare `principal: EditPrincipal`. All ids are `uuid.UUID` (malformed → 400). Verify that none of them collides with `/resolve` or `/{product_id}`
  - [x] 3.6 `core/authorization_matrix.py`: add `"PATCH"` to row 17 (`_methods("POST", "PUT", "PATCH", "DELETE")`, `^/api/products(/.*)?$`, EDIT) and update its comment. Row 11 (GET → READ) already covers `GET …/photos`. Add no item-scoped photo or description rows. Adjust any existing assertion in `test_authorization_matrix.py` that expected `PATCH /api/products/...` to resolve to AUTHENTICATED
  - [x] 3.7 Ensure tests pass: `uv run pytest tests/test_product_photos.py tests/test_product_description.py tests/test_authorization_matrix.py tests/test_item_details.py tests/test_product_photo_model.py`; ruff and mypy clean on `app/product`, `app/circulation/schemas.py` and `app/core/authorization_matrix.py`

**Acceptance Criteria:**
- The 8 tests pass, and Group 1's and Group 2's tests still pass
- Every new mutating route uses `EditPrincipal`, and the GET uses `ReadPrincipal`
- `app/product` imports nothing from `app.circulation`; circulation has no photo or description mutation code and no `lock_item`
- Photo count and dense `sort_order` stay correct under concurrent requests on one product (product row lock)

---

### Task Group 4: Backend Notifications, Links and RESERVED_SLUGS
**Dependencies:** None
**Files to Modify:** `src/backend/app/notifications/models.py`, `src/backend/app/groups/application/term_item_listings.py`, `src/backend/app/groups/application/pledge_fulfillment.py`, `src/backend/app/organizations/slugs.py`, `src/backend/tests/test_term_item_listings.py`, `src/backend/tests/test_pledge_fulfillment.py`, `src/backend/tests/test_organizations.py`
**Estimated Steps:** 7

- [x] 4.0 Complete notification and slug changes
  - [x] 4.1 Write/extend 7 focused tests (extend existing setups, do not duplicate them)
    - `test_term_item_listings.py`:
      1. `test_takeItemListing_taker_receivesItemReservedForPickupWithProductLink` (exact message `Zarezerwowano „{name}” — odbierz na terminie DD.MM`, `link_path == f"/product/{item_id}"`) — and the owner's `TERM_ITEM_LISTING_TAKEN` now links to `/product/{item_id}` (update the existing assertion if it checked the term link)
      2. `test_proposeSwap_owner_notificationLinksToOfferedItem`
      3. `test_acceptSwapProposal_proposerAndAutoRejected_notificationsLinkToListingItem` (SWAP_ACCEPTED and the loop's SWAP_REJECTED)
      4. `test_rejectSwapProposal_proposer_notificationLinksToListingItem`
      5. `test_resolveTransactionReservations_alreadyResolved_notificationLinksToItem` (`TERM_ALREADY_RESOLVED` → `/product/{reservation.item_id}`; reuse the existing TERM_ALREADY_RESOLVED test path in this file)
    - `test_pledge_fulfillment.py`:
      6. `test_fulfillPledge_registeredItem_notificationLinksToItem` (`PLEDGE_ITEM_REGISTERED` → `/product/{item.id}`)
    - `test_organizations.py`:
      7. `test_createMyOrganization_nameProduct_neverGetsReservedSlug` (org named "Product" gets a suffixed slug, not `product`)
  - [x] 4.2 `notifications/models.py`: add `ITEM_RESERVED_FOR_PICKUP = "ITEM_RESERVED_FOR_PICKUP"` (24 chars, fits VARCHAR(30), no migration) and update the `NotificationKind` docstring (sent to the taker of a term listing at take time)
  - [x] 4.3 `term_item_listings.py::take_item_listing`: stage the taker notification (`party_id=taker_profile.party_id`, message above with `term.occurs_on:%d.%m`, `link_path=f"/product/{item_id}"`) before the existing single `db.commit()`; repoint `TERM_ITEM_LISTING_TAKEN` to `/product/{item_id}`
  - [x] 4.4 Same file: `propose_swap` → `/product/{offered_item_id}`; `accept_swap_proposal` SWAP_ACCEPTED → `/product/{proposal.listing_item_id}` and the `other` loop's SWAP_REJECTED → `/product/{other.listing_item_id}`; `reject_swap_proposal` → `/product/{proposal.listing_item_id}`; `_resolve_transaction_reservations_for_action` TERM_ALREADY_RESOLVED → `/product/{reservation.item_id}`. Delete the `resolve_organizer_slug` calls that only fed the removed links; remove the import if unused (ruff)
  - [x] 4.5 `pledge_fulfillment.py`: PLEDGE_ITEM_REGISTERED → `/product/{item.id}`; drop the now-unused slug call/import. Leave `TERM_CONFIRMATION_NEEDED` (`term_end_scan.py`) and `pledges.py` untouched
  - [x] 4.6 `organizations/slugs.py`: add `"product"` to `RESERVED_SLUGS` in the "Top-level frontend routes" group
  - [x] 4.7 Ensure tests pass: `uv run pytest tests/test_term_item_listings.py tests/test_pledge_fulfillment.py tests/test_organizations.py tests/test_swap_proposal_model.py`; `uv run ruff check app/groups app/notifications app/organizations`

**Acceptance Criteria:**
- The 7 tests pass; any existing assertion on the old term link for these kinds is updated, not deleted
- `TERM_CONFIRMATION_NEEDED` link unchanged; no `app.groups` import added to circulation

---

### Task Group 5: Frontend API Client and Hooks
**Dependencies:** None
**Files to Modify:** `.maister/tasks/development/2026-10-01-item-detail-page/implementation/tsc-baseline.txt` (new), `src/frontend/src/api/items.ts` (new), `src/frontend/src/api/inventories.ts`, `src/frontend/src/hooks/useItemDetail.ts` (new), `src/frontend/src/hooks/useTermAttendees.ts`, `src/frontend/src/test/useItemDetail.test.tsx` (new)
**Estimated Steps:** 7

- [x] 5.0 Complete the data layer for the item page
  - [x] 5.1 BEFORE ANY FRONTEND EDIT: in `src/frontend` run `npx tsc -p tsconfig.app.json --noEmit > <task_path>/implementation/tsc-baseline.txt 2>&1` (exit code non-zero is expected if errors exist; record the error count at the top of the file). Also record the vitest baseline failing-test list given by the orchestrator (19 tests) in the same file for Group 8
  - [x] 5.2 Write 5 focused tests in `src/test/useItemDetail.test.tsx` (`renderHook` + `createQueryWrapper()`, `vi.mock("../api/items")`, `vi.mock("../api/inventories")`, `vi.mock("../api/products")`, UUID fixtures, `ApiError` failures)
    1. `useItemDetail` returns the item; `notFound` true for 404 and for 400 (malformed id)
    2. `useItemDetail` other failure → `error` = `extractProblemMessage` text, `item` null
    3. `useItemHistory` failure is isolated (`error` set, `data` is the stable `NO_HISTORY` fallback) while `useItemDetail` succeeds
    4. `useItemEditing.movePhoto(id, "down")` calls `reorderItemPhotos` with the swapped id list; `photoBusy` is true while the mock promise is unresolved and false after the details refetch settles (success and 409 error both)
    5. `useItemEditing.saveNameCategory` calls `resolveProduct({name, category_id})` then `updateInventoryItem(itemId, { product_id: resolved.id })`; a 403 rejects with `ACCESS_DENIED_MESSAGE`
  - [x] 5.3 `api/items.ts`: types `ItemStatusCode`, `ItemStatusResponse`, `InventoryItemPhotoResponse`, `ItemDetailsResponse`, `ItemHistoryEntryResponse` (all ids `string`, dates `string`); functions `getItemDetails(id)`, `getItemHistory(id)`, `addItemPhoto(id, url)`, `deleteItemPhoto(id, photoId)`, `reorderItemPhotos(id, photoIds)`, `updateItemDescription(id, description)` using the shared `api` client
  - [x] 5.4 `api/inventories.ts`: `updateInventoryItem(id: string, …)`; `UpdateInventoryItemRequest.product_id` typed `ProductResponse["id"]`. (The two remaining `PanelDataContext.tsx` callers are deleted by Group 7; any transient tsc error there is expected until Group 7 lands and is checked in Group 8)
  - [x] 5.5 `hooks/useTermAttendees.ts`: `export` the private `hasStatus` helper (no behaviour change)
  - [x] 5.6 `hooks/useItemDetail.ts`: `ITEM_DETAILS_KEY`, `ITEM_HISTORY_KEY` prefix constants; `useItemDetail(itemId)` → `{ item, notFound, error, loading, refetch }` (404/400 via imported `hasStatus`); `useItemHistory(itemId)` → `{ data, loading, error, refetch }` with module-level `NO_HISTORY`; `useItemEditing(itemId)` → `saveNameCategory`, `saveCondition`, `saveDescription`, `addPhoto`, `removePhoto`, `movePhoto`, `photoBusy`. Each mutation awaits `invalidateQueries({ queryKey: [ITEM_DETAILS_KEY] })` on success AND on error, then rethrows `new Error(serverMessageOr(err, <Polish fallback>))`. Follow `standards/frontend/data-fetching.md` and the `useTermAttendees` return shape
  - [x] 5.7 Ensure tests pass: `npx vitest run src/test/useItemDetail.test.tsx` only
  - [x] 5.8 **Rework for the product-module endpoints (after Group 3's contract):**
    - `api/products.ts`: add `ProductPhotoResponse {id: string; url: string; sort_order: number}` and `addProductPhoto(productId, url)` → `POST /products/{productId}/photos`, `deleteProductPhoto(productId, photoId)`, `reorderProductPhotos(productId, photoIds)` → `PUT …/photos/order` `{photo_ids}`, `updateProductDescription(productId, description)` → `PATCH …/description`. All ids are `string`.
    - `api/items.ts`: remove `InventoryItemPhotoResponse`, `addItemPhoto`, `deleteItemPhoto`, `reorderItemPhotos` and `updateItemDescription`; `ItemDetailsResponse.photos` becomes `ProductPhotoResponse[]`.
    - `hooks/useItemDetail.ts`: `useItemEditing(itemId, productId)`. The photo and description calls use `productId`; invalidation and the `photoBusy` behaviour are unchanged.
    - Update `src/test/useItemDetail.test.tsx` test 4 to expect `reorderProductPhotos(productId, swappedIds)` (mock `../api/products`). Run `npx vitest run src/test/useItemDetail.test.tsx`.

**Acceptance Criteria:**
- `tsc-baseline.txt` exists and was captured before any frontend file changed
- The 5 tests pass
- No `Number(`/`String(` coercion of ids; no `useState`+`useEffect` fetching

---

### Task Group 6: Frontend Item Page (view and edit)
**Dependencies:** 5
**Files to Modify:** (final layout after the two user-requested refactors: two standalone pages, no shared mode shell) `src/frontend/src/pages/product/ItemDetailPage.tsx` (new, `/product/:id`), `src/frontend/src/pages/product/ItemEditPage.tsx` (new, `/product/:id/edit`, owner/deleted guard), `src/frontend/src/pages/product/ItemLoadStates.tsx` (new), `src/frontend/src/pages/product/ItemBackButton.tsx` (new), `src/frontend/src/pages/product/ItemReadOnlyParts.tsx` (new: `ReadOnlyCards`, `DescriptionText`), `src/frontend/src/pages/product/itemPageShared.ts` (new: constants and types), `src/frontend/src/pages/product/ItemFieldEditors.tsx` (new: field editors), `src/frontend/src/pages/product/ItemGallery.tsx` (new: view), `src/frontend/src/pages/product/ItemGalleryEditor.tsx` (new: editor), `src/frontend/src/pages/product/ItemTimeline.tsx` (new), `src/frontend/src/router.tsx`, `src/frontend/src/test/ItemDetailPage.test.tsx` (new)
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:item-detail-view
  locator: "Mockup 1: Item page, view mode (owner)", lines 89-165; class patterns in "Identified Patterns", lines 72-83
  acceptance: PhoneFrame shell like TermAttendeesPage; order = back link "‹ Wróć" (BackIcon), gallery card, h2 name, meta line "{Kategoria} · Stan: {label}", Opis card (`whitespace-pre-line`, "Brak opisu" when empty), "Aktualny status" card, "Historia" card; owner-only "Edytuj" pill linking to `/product/:id/edit` shown only when `is_owner && !deleted_at`; back = `navigate(-1)` when `location.key !== "default"`, else `/panel/rzeczy`
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:item-detail-edit
  locator: "Mockup 5: Edit mode, idle (owner)", lines 246-282
  acceptance: standalone `ItemEditPage` at `/product/:id/edit` (not `?mode=edit`); h2 "Edycja rzeczy" + mint "Gotowe" button and back link "Wróć do podglądu", both to `/product/:id` with replace navigation, discarding drafts; field rows in order ZDJĘCIA (n/10), NAZWA I KATEGORIA, STAN, OPIS with pencils labelled "Edytuj zdjęcia", "Edytuj nazwę i kategorię", "Edytuj stan", "Edytuj opis"; status and history read-only below; one open editor at a time; focus to first input on open, back to pencil on close
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:item-detail-states
  locator: "Mockup 9: States", lines 359-406
  acceptance: body branch order notFound → error → loading → content; notFound (404/400) "Nie znaleziono tej rzeczy."; error "Nie udało się wczytać rzeczy — spróbuj ponownie" + `extractProblemMessage` text + "Spróbuj ponownie" button; loading skeleton + "Wczytywanie rzeczy…"; deleted `role="status"` banner "Rzecz usunięta" / "Ta rzecz została usunięta DD.MM.YYYY. Możesz przejrzeć jej historię.", gallery `opacity-70`, no edit controls for anyone; empty history dashed block "Brak zdarzeń w historii tej rzeczy."; history failure = inline error + retry inside the Historia card only
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: screen:item-detail-non-owner
  locator: "Mockup 10: Non-owner viewer", lines 407-426
  acceptance: no "Edytuj", no pencils, no "Dodaj zdjęcia w trybie edycji" hint, no owner line; `/edit` for a non-owner or a deleted item renders `<Navigate to="/product/{id}" replace />` once details loaded
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-gallery
  locator: "Mockup 2: Gallery variants (view)", lines 166-187
  acceptance: main image `w-full aspect-[4/3] object-cover rounded-2xl`, `loading="lazy"`, `referrerPolicy="no-referrer"`, `onError` → PhotoPlaceholder; `alt="{name} — zdjęcie n"`; counter pill "n / N" and `overflow-x-auto` thumbnail strip of `<button aria-pressed aria-label="Zdjęcie n z N">` only when ≥2 photos; fallback order photos → `product_photo_url` (no badge) → placeholder
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-status-card
  locator: "Mockup 3: Aktualny status variants", lines 188-212
  acceptance: copy per spec "UI copy" table for AVAILABLE, RESERVED, IN_TRANSIT, RETURNING, PROPOSED_SWAP ("Zaproponowana do zamiany — czeka na decyzję"), LENT ("Pożyczona do DD.MM.YYYY" / "Pożyczona"), DELETED ("Usunięta"); term date `DD.MM`; second line "Dla: {label}" / "U: {label}" omitted when label null; text-carried status (dot + label, `role="status"`); no term link
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-history-list
  locator: "Mockup 4: Historia timeline entries and privacy labels", lines 213-245
  acceptance: `<ol aria-label="Historia rzeczy">`, newest first as returned; 40px date tile with day `D` and month `MMM` via `utils/dayjs`; `<time dateTime>`; bold label from `MOVEMENT_LABELS` (Dodana, Podarowana, Pożyczona, Zwrócona, Zamieniona, Usunięta); server `description` verbatim; optional "na terminie DD.MM.YYYY" plain text; SWAP row same pattern, no counterpart item
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-edit-name-category
  locator: "Mockup 6: Inline edit, name + category", lines 283-306
  acceptance: input "Nazwa rzeczy", select "Typ rzeczy" from `useCategories`; hint "Ta zmiana podepnie rzecz pod inny produkt z katalogu — innych rzeczy nie zmienia." plus a rename hint that photos and the description belong to the product (in `ItemFieldEditors.tsx`); empty name → "Podaj nazwę rzeczy"; unchanged values close without a request; Zapisz/Anuluj, Enter saves, Escape cancels; markup/classes moved from RzeczyView's inline editor
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-edit-condition-description
  locator: "Mockup 7: Inline edit, condition and description", lines 307-325
  acceptance: select "Stan rzeczy" from `CONDITION_LABELS`; textarea "Opis rzeczy" `rows=4`, `maxLength=2000`, counter "n / 2000", hint "Opis jest wspólny dla wszystkich rzeczy tego produktu."; prefilled with the view value (including the `Product.description` fallback); in the textarea Enter inserts newline, Escape cancels
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:item-gallery-editor
  locator: "Mockup 8: Inline edit, gallery", lines 326-358
  acceptance: rows = 48px thumb, "n.", truncated URL with `title`=full URL; lucide `ChevronUp`/`ChevronDown` buttons disabled at the ends with `aria-label="Przesuń zdjęcie n w górę"`/`"…w dół"`; `TrashIcon` button `aria-label="Usuń zdjęcie n"` (no confirm); `type=url` input "Link do zdjęcia" + "+ Dodaj", Enter adds; invalid URL → "Podaj poprawny link zaczynający się od http:// lub https://" with no API call; at 10/10 input+button disabled and "Osiągnięto limit 10 zdjęć."; server errors inline; "Gotowe" closes; all controls disabled while `photoBusy`; hint "Zdjęcia są wspólne dla wszystkich rzeczy tego produktu" (11.5px ink-soft, like the description hint)
**Estimated Steps:** 8

- [x] 6.0 Complete the item page
  - [x] 6.1 Write 8 focused tests in `src/test/ItemDetailPage.test.tsx` (`vi.mock` `api/items`, `api/inventories`, `api/products`, `api/categories` as needed; `createQueryWrapper`; `MemoryRouter initialEntries` + `Routes` with both routes; UUID fixtures; `vi.resetAllMocks()` in `beforeEach`)
    1. view renders name, meta line, description, gallery, status and history for the owner, with "Edytuj" linking to `/product/{id}/edit`
    2. notFound for 404 and 400; error state shows message and "Spróbuj ponownie" triggers a refetch
    3. deleted item shows the "Rzecz usunięta" banner, no "Edytuj", and `/edit` falls back to the view
    4. non-owner on `/product/{id}/edit` is redirected to the view with no pencils
    5. owner condition save calls `updateInventoryItem(id, { condition })` and closes the editor
    6. name+category save calls `resolveProduct` then `updateInventoryItem(id, { product_id: resolved.id })`
    7. gallery editor: invalid URL shows the error with no `addProductPhoto` call; "Przesuń zdjęcie 1 w dół" calls `reorderProductPhotos(item.product_id, swappedIds)` (after step 6.9; originally `reorderItemPhotos`); while that promise is unresolved all gallery controls are disabled, re-enabled after refetch
    8. `PROPOSED_SWAP` status copy renders, and a history failure shows the inline Historia error while the rest of the page renders
  - [x] 6.2 `pages/product/ItemTimeline.tsx`: `MOVEMENT_LABELS`, `ItemStatusCard`, `ItemHistoryList` (dates via `utils/dayjs`)
  - [x] 6.3 `pages/product/ItemGallery.tsx`: `ItemGallery` (view); `pages/product/ItemGalleryEditor.tsx`: `ItemGalleryEditor` (uses `isValidImageUrl`, `useItemEditing` callbacks passed as props, `photoBusy`)
  - [x] 6.4 Two standalone pages, no shared mode shell:
    - `ItemDetailPage.tsx` is the view page with its private view content and `ItemBackButton` (`navigate(-1)`, falling back to `/panel/rzeczy`).
    - `ItemEditPage.tsx` holds the owner/deleted `Navigate replace` guard, its private `EditableField` (label row + pencil) and edit content with a single `openEditor` state. "Gotowe" and "Wróć do podglądu" use replace navigation.
    - Shared parts: `ItemLoadStates.tsx`, `ItemReadOnlyParts.tsx` (`ReadOnlyCards`, `DescriptionText`), `itemPageShared.ts` (`MAX_PRODUCT_PHOTOS`, `HistoryState`, class constants), `ItemFieldEditors.tsx` (name/category, condition and description editors).
  - [x] 6.5 Reuse: `PhoneFrame`, `PhotoPlaceholder`, `BackIcon`/`PencilIcon`/`TrashIcon` from `pages/panel/panelIcons.tsx` (import only, do not edit that file — Group 7 owns it), `CONDITION_LABELS`, `isValidImageUrl`, `useCategories`, `extractProblemMessage`; Tailwind tokens only (`standards/frontend/css.md`), Polish `aria-label`s, no horizontal scroll at 360px
  - [x] 6.6 `router.tsx`: add `/product/:id` → `<AuthGuard><ItemDetailPage /></AuthGuard>` and `/product/:id/edit` → `<AuthGuard><ItemEditPage /></AuthGuard>` as PublicLayout children next to `/panel/terminy/:termId`, with a one-line comment that `"product"` is in backend `RESERVED_SLUGS`
  - [x] 6.7 Self-check every `acceptance` line in this group's Visual References against the rendered markup
  - [x] 6.8 Ensure tests pass: `npx vitest run src/test/ItemDetailPage.test.tsx` only
  - [x] 6.9 **Rework after 5.8:**
    - `ItemDetailPage.tsx` calls `useItemEditing(item.id, item.product_id)`.
    - The gallery editor shows the hint "Zdjęcia są wspólne dla wszystkich rzeczy tego produktu".
    - In `src/test/ItemDetailPage.test.tsx`, move the photo and description mocks from `api/items` to `api/products` (`addProductPhoto`, `reorderProductPhotos`, `updateProductDescription`) and assert they receive the fixture's `product_id`.
    - Run `npx vitest run src/test/ItemDetailPage.test.tsx`.

**Acceptance Criteria:**
- The 8 tests pass
- Implementation matches each `acceptance` criterion declared above
- At most 2 parallel API calls on mount (details + history)

---

### Task Group 7: Frontend Entry Points and Panel Cleanup
**Dependencies:** 5
**Files to Modify:** `src/frontend/src/pages/panel/panelIcons.tsx`, `src/frontend/src/pages/panel/views/RzeczyView.tsx`, `src/frontend/src/pages/panel/views/WypozyczoneView.tsx`, `src/frontend/src/pages/panel/PanelDataContext.tsx`, `src/frontend/src/pages/krag/PublicTermView.tsx`, `src/frontend/src/api/notifications.ts`, `src/frontend/src/test/RzeczyViewCategory.test.tsx`, `src/frontend/src/test/PanelPage.test.tsx`, `src/frontend/src/test/TermPage.test.tsx`
**Visual References:**
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:rzeczy-card-item-links
  locator: "Mockup 11: Moje rzeczy card, new view + edit icons", lines 427-449
  acceptance: right rail `flex flex-col gap-1` with, top to bottom, view `<Link to="/product/{id}">` (new `EyeIcon`) `aria-label="Zobacz rzecz {name}"`, edit `<Link to="/product/{id}/edit">` (`PencilIcon`) `aria-label="Edytuj rzecz {name}"`, existing trash; 30px icon-button classes; inline name+category and condition pencils/editors removed
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:wypozyczone-row-view-link
  locator: "Mockup 12: Wypożyczone row, view icon", lines 450-472
  acceptance: `LoanRow` takes `itemId` and renders a 30px view `<Link to="/product/{itemId}">` `aria-label="Zobacz rzecz {productName}"` before `children`, on both tabs (`b.itemId` / `it.id`)
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:term-listing-title-link
  locator: "Mockup 13: Public term page, listing title as link", lines 473-498
  acceptance: in `PublicTermView.tsx` `toListingRow`, the title is `<Link to="/product/{item_id}">` wrapping the existing `<strong>` plus `aria-hidden` "›"; colour inherited, `underline decoration-[1.5px] underline-offset-2`, mint hover; needed-item rows stay plain
- mockup: analysis/design-context/ascii/ui-mockups.md
  element: component:notification-item-reserved
  locator: "Mockup 14: Notification bell, new ITEM_RESERVED_FOR_PICKUP entry", lines 499-521
  acceptance: no NotificationBell change; `NotificationKind` union gains `"ITEM_RESERVED_FOR_PICKUP"` so the entry renders with its server message and navigates to its `/product/{id}` `link_path`
**Estimated Steps:** 9

- [x] 7.0 Complete entry points and dead-state removal
  - [x] 7.1 Write/update 4 focused tests
    1. `RzeczyViewCategory.test.tsx`: card has "Zobacz rzecz {name}" → `/product/{id}` and "Edytuj rzecz {name}" → `/product/{id}/edit`, and no "Edytuj stan"/name-category pencil (replaces the obsolete "Typ rzeczy select" test)
    2. `RzeczyViewCategory.test.tsx`: the existing `describe("NotificationKind — frontend union matches backend enum")` block (~L459) adds `"ITEM_RESERVED_FOR_PICKUP"` and its count assertion/title becomes the new member count
    3. `PanelPage.test.tsx`: Wypożyczone shows a "Zobacz rzecz …" link to `/product/{itemId}` on both tabs
    4. `TermPage.test.tsx`: a listing title in the PublicTermView render is a link to `/product/{item_id}` (use the existing term page setup; the 5 pre-existing TermPage failures are baseline, not regressions)
  - [x] 7.2 `panelIcons.tsx`: add `EyeIcon` in the existing SVG style
  - [x] 7.3 `RzeczyView.tsx`: add the two links to the right rail; delete the inline name+category and condition editors/pencils and every context value they consumed; keep `categories` for the quick-add default
  - [x] 7.4 `WypozyczoneView.tsx`: `LoanRow` `itemId` prop + view link; pass `b.itemId` / `it.id`
  - [x] 7.5 `PanelDataContext.tsx`: delete `editingItemCondition`/`setEditingItemCondition`, `editingItemMeta`/`setEditingItemMeta`, `itemMetaError`, `saveItemCondition`, `startEditItemMeta`, `saveItemMeta`, the `updateInventoryItem` import, the `products`/`setProducts` state, `getProducts()` in `load()`'s `Promise.all`, the `setProducts` merge + comment in `handleAddItem`, the `products` export, and `getProducts`/`ProductResponse` imports if unused; keep `resolveProduct`, `itemError`, `categories`; rewrite the `PendingSwapAction` doc comment per spec (`TERM_LINK_PATH_RE`/`parseTermIdFromLinkPath` unchanged)
  - [x] 7.6 `PublicTermView.tsx`: `toListingRow` title link
  - [x] 7.7 `api/notifications.ts`: add `"ITEM_RESERVED_FOR_PICKUP"` to `NotificationKind`
  - [x] 7.8 Test cleanup: delete the obsolete `PanelPage.test.tsx` inline condition and name+category edit tests (~L2080-2140); remove `getProducts` mock setups that only fed the removed catalog (~L387, L407, L2082, L2090, L2181) and keep the `vi.mock` factory entry only while something imports it; remove `editingItemMeta`, `editingItemCondition`, `itemMetaError`, `startEditItemMeta`, `setEditingItemMeta`, `setEditingItemCondition`, `saveItemMeta`, `saveItemCondition`, `products` from `makeContextValue` and every per-test override in `RzeczyViewCategory.test.tsx` (~L207-284)
  - [x] 7.9 Ensure tests pass: `npx vitest run src/test/RzeczyViewCategory.test.tsx src/test/PanelPage.test.tsx src/test/TermPage.test.tsx`; compare failures to the baseline (PanelPage 8, TermPage 5) — no new ones; `npx tsc -p tsconfig.app.json --noEmit` shows no errors in the touched files

**Acceptance Criteria:**
- The 4 new/updated tests pass; no new failures in the three files beyond the baseline
- No remaining reference to the removed context members anywhere under `src/frontend/src` (grep)
- Implementation matches each `acceptance` criterion declared above

---

### Task Group 8: Test Review, Gap Analysis and Final Gates
**Dependencies:** 1, 2, 3, 4, 5, 6, 7
**Files to Modify:** `src/backend/tests/test_item_details.py`, `src/backend/tests/test_item_history.py`, `src/backend/tests/test_product_photos.py`, `src/backend/tests/test_product_description.py`, `src/frontend/src/test/ItemDetailPage.test.tsx`, `src/frontend/src/test/useItemDetail.test.tsx` (append-only, only if a gap is found)
**Estimated Steps:** 6

- [x] 8.0 Review and close critical gaps, then run every gate
  - [x] 8.1 Review the ~43 tests from Groups 1-7 against the spec's 16 requirements and Success Criteria
  - [x] 8.2 Analyse gaps for THIS feature only (candidates: domain `item_privacy` edge cases such as viewer `None` / missing display name → "inna rodzina"; RETURNING status; history entry for GIFT; gallery fallback to `product_photo_url`; back-link fallback to `/panel/rzeczy`)
  - [x] 8.3 Write up to 10 additional strategic tests in the files listed above
  - [x] 8.4 Backend gate: in `src/backend`, `uv run pytest` fully green; `uv run ruff check .`; confirm `uv run alembic current` on the local DB (with `.env` loaded) reports 0045
  - [x] 8.5 Frontend gates: in `src/frontend`, `npx vitest run` — failing set must be a subset of the 19 baseline failures (PanelPage hamburger promotion 6 + join-request 2, TermPage 5, auth 1, extension-points 2, foundation 1, ItemQuickAddForm 1, ItemQuickAddFormCategory 1); `npx tsc -p tsconfig.app.json --noEmit` compared with `implementation/tsc-baseline.txt` — no new errors
  - [x] 8.6 Final greps: no `Number(` on item ids in new/changed frontend files; no `app.groups` import under `app/circulation`; no user/inventory/reservation/transaction id fields in `ItemDetailsResponse`/`ItemHistoryEntryResponse`

**Acceptance Criteria:**
- All feature tests pass (~43-53 total)
- No more than 10 additional tests added
- All four gates satisfied (pytest green, migration 0045 applied locally, no new vitest failures, no new tsc errors)

---

## Fix iteration 1 (after verification)

This section is a note only; it adds no checkboxes. It records the behaviour that verification fix iteration 1 establishes, which the spec now describes as intended:
- **Backend**:
  - Product photo and description mutations require the caller to own at least one non-deleted item of the product (home-inventory owner rule), otherwise 403. This replaces "EDIT only, no owner check".
  - Clearing the description stores an explicit empty value; the reader falls back to `Product.description` only when the key is absent.
  - `delete_product` removes the product's photos in the same transaction.
  - Photo URLs must be http(s), have a host and contain no whitespace. `ReorderProductPhotosRequest.photo_ids` has `max_length=10`.
  - Details reads photos only through `product_service.list_product_photos`, ordered by `(sort_order, created_at)`; the duplicate circulation query is removed.
- **Frontend**:
  - stale `product_id` protection after a re-point;
  - "Gotowe" and "Wróć do podglądu" use replace navigation;
  - a rename hint says that photos and the description belong to the product;
  - `category_name: string | null`;
  - `MAX_PRODUCT_PHOTOS` (renamed from `MAX_ITEM_PHOTOS`).
- **Validation errors are 400** in the legacy envelope everywhere (including malformed UUIDs), never 422, and the frontend notFound covers 404 and 400.

## Execution Order

1. Group 1: Database Layer (5 steps) — wave 1
2. Group 4: Notifications, Links, RESERVED_SLUGS (7 steps) — wave 1, independent
3. Group 5: Frontend API + Hooks (7 steps, captures tsc baseline first) — wave 1, independent
4. Group 2: Backend Circulation Read (9 steps, depends on 1) — wave 2
5. Group 6: Frontend Item Page (8 steps, depends on 5) — wave 2
6. Group 7: Frontend Entry Points + Panel Cleanup (9 steps, depends on 5) — wave 2
7. Group 3: Backend product module: photos + description endpoints + matrix (7 steps, depends on 1, 2; shares `product/service.py` and `circulation/schemas.py` with 2) — wave 3, followed by rework steps 5.8 → 6.9
8. Group 8: Test Review + Final Gates (6 steps, depends on all) — wave 4

Shared-file serialization check:
- `product/service.py`, `circulation/schemas.py`: Group 2 → Group 3 (explicit dependency). Group 3 no longer touches `circulation/router.py`, `service.py`, `repository.py` or `item_details.py`
- `api/items.ts`, `api/products.ts`, `hooks/useItemDetail.ts`, `useItemDetail.test.tsx`: Group 5 → step 5.8; `pages/product/*`, `ItemDetailPage.test.tsx`: Group 6 → step 6.9 → the two user-requested refactors → fix iteration 1
- `tests/test_item_details.py`: Group 2 (written), Group 3 (run only), Group 8 (append) — serialized by dependencies
- `PanelDataContext.tsx`, `PanelPage.test.tsx`, `RzeczyViewCategory.test.tsx`, `TermPage.test.tsx`, `api/notifications.ts`: Group 7 only
- `api/inventories.ts`: Group 5 only; `router.tsx`: Group 6 only; `panelIcons.tsx`: Group 7 only (Group 6 imports from it without editing)

## Standards Compliance

Follow standards from `.maister/docs/standards/`:
- global/ — error-handling (typed exceptions, Polish messages), validation (server-side mirrored client-side: URL regex, 2000 chars, 10 photos), minimal-implementation (delete dead panel state; no speculative endpoints), coding-style, commenting, conventions
- backend/ — models.md (BaseEntity, business-key eq/hash, no cross-module relationship), migrations.md (one focused reversible migration, explicit constraint names), queries.md (single history query, needed columns only, `FOR UPDATE`, bound params), api.md (plural nouns, 201/204, limited nesting), security.md (`require_any` route dependencies; matrix row 17 extended by PATCH; item ownership in the circulation service; product photo/description mutations add the item-owner rule in the product service)
- frontend/ — data-fetching.md (hooks in `src/hooks`, prefix keys, awaited invalidation, module-level fallbacks, dayjs from `utils/dayjs.ts`), components.md, css.md (Tailwind tokens), accessibility.md (Polish aria-labels, `<ol>`/`<time>`, text-carried status), responsive.md (360px, no horizontal scroll)
- testing/ — backend-testing.md (integration-first, real Postgres), frontend-testing.md (Vitest, Testing Library, `createQueryWrapper`, `vi.mock` + `vi.resetAllMocks`, files in `src/test/`)

## Notes

- Test-Driven: each group starts with its 2-8 tests
- Run Incrementally: only the group's own tests after each group; full gates only in Group 8
- Mark Progress: check off steps as completed
- Reuse First: product router `ReadPrincipal`/`EditPrincipal`, `_validate_photo_url` style (stricter URL check), `resolve_owning_inventory`, `get_item_with_product_name` query shape, `movements_for_item` shape, `replace_plugin_data` pattern, `notifications_bridge.create_notification`, `TermAttendeesPage`/`useTermAttendees`, RzeczyView inline editor markup
- Known transient state: between Groups 5 and 7, `PanelDataContext.tsx` may show tsc errors at its two `updateInventoryItem` calls; Group 7 deletes those callers. Group 8 is the binding tsc check
- Do not touch pre-existing uncommitted user changes
